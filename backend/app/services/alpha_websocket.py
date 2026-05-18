from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from common.datetime_compat import UTC
import httpx
import redis
import websockets
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from broker.core.redis_cache import _redis_client
from broker.crypto import decrypt_value
from db.models import (
    AlphaWebSocketEvent,
    LiveSymbolSubscription,
    SystemWatchlistPresetSymbol,
    UserAlphaApiCredential,
    UserAlphaWebSocketConfig,
    UserWatchlist,
    UserWatchlistSymbol,
)
from db.session import SessionLocal

logger = logging.getLogger(__name__)

ALPHA_WS_PRODUCTS = ["news", "announcements", "earnings", "concalls", "alerts"]
ACCOUNT_REFRESH_SECONDS = 15 * 60
SUPERVISOR_INTERVAL_SECONDS = 5
STREAM_MAXLEN = 2000
WS_CONNECT_TIMEOUT_SECONDS = 20
WS_PING_INTERVAL_SECONDS = 20
WS_PING_TIMEOUT_SECONDS = 20
WS_RECV_TIMEOUT_SECONDS = 45
WS_INITIAL_RETRY_DELAY_SECONDS = 2
WS_MAX_RETRY_DELAY_SECONDS = 60


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


async def _wait_for_stop(stop_event: asyncio.Event, timeout: float) -> bool:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        return False
    except asyncio.CancelledError:
        if stop_event.is_set():
            return True
        raise


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def _normalize_symbol(value: str | None) -> str | None:
    symbol = (value or "").strip().upper()
    return symbol or None


def _collect_symbols(value: Any, symbols: set[str]) -> None:
    if isinstance(value, dict):
        for key in ("symbol", "symbols", "nse"):
            raw = value.get(key)
            if isinstance(raw, str):
                for part in raw.replace(",", ":").split(":"):
                    symbol = _normalize_symbol(part)
                    if symbol:
                        symbols.add(symbol)
            elif isinstance(raw, list):
                for item in raw:
                    _collect_symbols(item, symbols)
        for key in ("payload", "data"):
            if key in value:
                _collect_symbols(value[key], symbols)
    elif isinstance(value, list):
        for item in value:
            _collect_symbols(item, symbols)


def _event_key(product: str, payload: dict[str, Any]) -> str:
    for key in ("id", "_id", "event_id", "announcement_id", "news_id"):
        value = payload.get(key)
        if value not in (None, ""):
            return f"{product}:{value}"
    parts = [
        product,
        str(payload.get("symbol") or payload.get("nse") or ""),
        str(payload.get("timestamp") or payload.get("date") or payload.get("created_at") or ""),
        str(payload.get("title") or payload.get("headline") or payload.get("type") or ""),
    ]
    raw = ":".join(parts) or _json_dumps(payload)[:500]
    return hashlib.sha256(raw.encode()).hexdigest()


def _account_data(row: UserAlphaApiCredential | None) -> dict[str, Any]:
    payload = _json_loads(row.account_json if row else None, {})
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        return payload["data"]
    return payload if isinstance(payload, dict) else {}


def enabled_addons_from_account(account: dict[str, Any]) -> dict[str, dict[str, Any]]:
    addons: dict[str, dict[str, Any]] = {}
    for item in account.get("websocket_addons") or []:
        if not isinstance(item, dict):
            continue
        product = str(item.get("product") or "").strip()
        if not product:
            continue
        addons[product] = item
    return addons


def _plan_symbol_limit(plan_id: str | None) -> int | None:
    if plan_id == "sandbox":
        return 0
    if plan_id == "pro":
        return 500
    if plan_id == "scale":
        return 1000
    if plan_id == "full_market":
        return None
    return None


def _plan_monthly_unique_limit(plan_id: str | None) -> int | None:
    if plan_id == "sandbox":
        return 0
    if plan_id == "pro":
        return 1500
    if plan_id == "scale":
        return 3000
    if plan_id == "full_market":
        return None
    return None


def _tier_symbol_limit(tier: str | None) -> int | None:
    if tier in {"sandbox"}:
        return 0
    if tier in {"pro_500", "basic_500"}:
        return 500
    if tier in {"scale_1000", "pro_1000"}:
        return 1000
    if tier == "full_market":
        return None
    return None


def _tier_monthly_unique_limit(tier: str | None) -> int | None:
    if tier in {"sandbox"}:
        return 0
    if tier in {"pro_500", "basic_500"}:
        return 1500
    if tier in {"scale_1000", "pro_1000"}:
        return 3000
    if tier == "full_market":
        return None
    return None


def _best_numeric_limit(*values: Any) -> int | None:
    limits = [limit for limit in (_int_or_none(value) for value in values) if limit is not None]
    return max(limits) if limits else None


def live_entitlement_from_account(account: dict[str, Any]) -> dict[str, Any]:
    metadata = account.get("metadata") if isinstance(account.get("metadata"), dict) else {}
    value = account.get("live_entitlement")
    entitlement = dict(value) if isinstance(value, dict) else {}
    addons = enabled_addons_from_account(account)

    plan_id = str(entitlement.get("plan_id") or metadata.get("subscription_plan_id") or "") or None
    plan_name = entitlement.get("plan_name") or metadata.get("subscription_plan_name")

    enabled_tiers = [
        str(item.get("tier") or "")
        for item in addons.values()
        if bool(item.get("enabled", True))
    ]
    tier_symbol_limits = [
        limit for limit in (_tier_symbol_limit(tier) for tier in enabled_tiers) if limit is not None
    ]
    tier_monthly_limits = [
        limit for limit in (_tier_monthly_unique_limit(tier) for tier in enabled_tiers) if limit is not None
    ]
    full_market_products: list[str] = []
    for item in entitlement.get("full_market_products", []):
        product = str(item)
        if product in ALPHA_WS_PRODUCTS and product not in full_market_products:
            full_market_products.append(product)
    if not full_market_products:
        for product, item in addons.items():
            if (
                product in ALPHA_WS_PRODUCTS
                and product not in full_market_products
                and bool(item.get("enabled", True))
                and item.get("tier") == "full_market"
            ):
                full_market_products.append(product)

    metadata_symbol_limit = metadata.get("live_active_symbol_limit")
    metadata_monthly_limit = metadata.get("live_monthly_unique_symbol_limit")
    active_symbol_limit = _best_numeric_limit(
        entitlement.get("active_symbol_limit"),
        metadata_symbol_limit,
        max(tier_symbol_limits) if tier_symbol_limits else None,
        _plan_symbol_limit(plan_id),
    )
    monthly_unique_symbol_limit = _best_numeric_limit(
        entitlement.get("monthly_unique_symbol_limit"),
        metadata_monthly_limit,
        max(tier_monthly_limits) if tier_monthly_limits else None,
        _plan_monthly_unique_limit(plan_id),
    )
    if full_market_products or plan_id == "full_market":
        active_symbol_limit = None
        monthly_unique_symbol_limit = None

    return {
        **entitlement,
        "plan_id": plan_id,
        "plan_name": plan_name,
        "active_symbol_limit": active_symbol_limit,
        "monthly_unique_symbol_limit": monthly_unique_symbol_limit,
        "full_market_products": full_market_products,
    }


def _int_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def fetch_alpha_account(api_key: str) -> dict[str, Any]:
    settings = get_settings()
    url = f"{settings.alpha_api_base_url.rstrip('/')}/v1/account"
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url, headers={"X-API-Key": api_key})
        response.raise_for_status()
        payload = response.json()
    data = payload.get("data") if isinstance(payload, dict) else None
    return data if isinstance(data, dict) else {}


async def refresh_account_for_user(user_id: str) -> dict[str, Any]:
    db = SessionLocal()
    try:
        row = db.get(UserAlphaApiCredential, user_id)
        if row is None or not row.api_key_cipher:
            raise ValueError("Manasija Alpha API key is not configured.")
        account = await fetch_alpha_account(decrypt_value(row.api_key_cipher))
        row.account_json = _json_dumps(account)
        row.account_checked_at = _utc_now()
        row.account_error = None
        db.add(row)
        db.commit()
        return account
    except Exception as exc:
        row = db.get(UserAlphaApiCredential, user_id)
        if row is not None:
            row.account_checked_at = _utc_now()
            row.account_error = str(exc)
            db.add(row)
            db.commit()
        raise
    finally:
        db.close()


def _default_config(user_id: str) -> UserAlphaWebSocketConfig:
    return UserAlphaWebSocketConfig(
        user_id=user_id,
        is_enabled=True,
        products_json="[]",
        scope_mode="alert_subscriptions",
        watchlist_ids_json="[]",
        include_all_watchlists=False,
        full_market=False,
        last_status="unknown",
    )


def _entitled_products(account: dict[str, Any]) -> list[str]:
    addons = enabled_addons_from_account(account)
    entitlement = live_entitlement_from_account(account)
    active_limit = _int_or_none(entitlement.get("active_symbol_limit"))
    full_market_products = {
        str(item)
        for item in entitlement.get("full_market_products", [])
        if str(item) in ALPHA_WS_PRODUCTS
    }
    return [
        product
        for product in ALPHA_WS_PRODUCTS
        if bool(addons.get(product, {}).get("enabled"))
        and (active_limit is None or active_limit > 0 or product in full_market_products)
    ]


def _symbols_from_alert_subscriptions(db: Session, user_id: str) -> list[str]:
    rows = db.scalars(
        select(LiveSymbolSubscription.symbol).where(
            LiveSymbolSubscription.user_id == user_id,
            LiveSymbolSubscription.status == "active",
        )
    ).all()
    return [symbol for symbol in (_normalize_symbol(row) for row in rows) if symbol]


def _symbols_from_watchlists(
    db: Session,
    user_id: str,
    *,
    watchlist_ids: list[str],
    include_all: bool,
) -> list[str]:
    stmt = select(UserWatchlist).where(UserWatchlist.user_id == user_id)
    if not include_all:
        if not watchlist_ids:
            return []
        stmt = stmt.where(UserWatchlist.id.in_(watchlist_ids))
    watchlists = db.scalars(stmt).all()
    symbols: list[str] = []
    for watchlist in watchlists:
        if watchlist.kind == "preset" and watchlist.system_preset_id:
            rows = db.scalars(
                select(SystemWatchlistPresetSymbol.symbol).where(
                    SystemWatchlistPresetSymbol.preset_id == watchlist.system_preset_id
                )
            ).all()
        else:
            rows = db.scalars(
                select(UserWatchlistSymbol.symbol).where(UserWatchlistSymbol.watchlist_id == watchlist.id)
            ).all()
        symbols.extend(symbol for symbol in (_normalize_symbol(row) for row in rows) if symbol)
    return symbols


@dataclass(frozen=True)
class EffectiveAlphaSubscription:
    user_id: str
    api_key: str
    enabled: bool
    products: list[str]
    symbols: list[str]
    full_feed_products: list[str]
    account: dict[str, Any]
    config_hash: str


def effective_subscription_for_user(db: Session, user_id: str) -> EffectiveAlphaSubscription | None:
    credential = db.get(UserAlphaApiCredential, user_id)
    if credential is None or not credential.is_enabled or not credential.api_key_cipher:
        return None
    config = db.get(UserAlphaWebSocketConfig, user_id) or _default_config(user_id)
    account = _account_data(credential)
    entitled_products = _entitled_products(account)
    configured_products = [
        str(item).strip()
        for item in _json_loads(config.products_json, [])
        if str(item).strip() in ALPHA_WS_PRODUCTS
    ]
    products = configured_products or entitled_products
    products = [product for product in products if product in entitled_products]

    symbols: list[str] = []
    if config.scope_mode in {"alert_subscriptions", "alerts_and_watchlists"}:
        symbols.extend(_symbols_from_alert_subscriptions(db, user_id))
    if config.scope_mode == "alerts_and_watchlists":
        symbols.extend(
            _symbols_from_watchlists(
                db,
                user_id,
                watchlist_ids=[str(item) for item in _json_loads(config.watchlist_ids_json, [])],
                include_all=bool(config.include_all_watchlists),
            )
        )
    seen: set[str] = set()
    symbols = [symbol for symbol in symbols if not (symbol in seen or seen.add(symbol))]

    addons = enabled_addons_from_account(account)
    entitlement = live_entitlement_from_account(account)
    live_symbol_limit = _int_or_none(entitlement.get("active_symbol_limit"))
    if live_symbol_limit is None:
        capped_limits = [
            _tier_symbol_limit(str(addons.get(product, {}).get("tier") or ""))
            for product in products
        ]
        capped_limits = [limit for limit in capped_limits if limit is not None]
        live_symbol_limit = max(capped_limits) if capped_limits else None
    if live_symbol_limit is not None:
        if live_symbol_limit <= 0:
            products = []
            symbols = []
        elif len(symbols) > live_symbol_limit:
            symbols = symbols[:live_symbol_limit]
    entitlement_full_market_products = {
        str(item)
        for item in entitlement.get("full_market_products", [])
        if str(item) in ALPHA_WS_PRODUCTS
    }
    full_feed_products = [
        product
        for product in products
        if config.full_market
        and config.scope_mode == "full_market"
        and (
            product in entitlement_full_market_products
            or addons.get(product, {}).get("tier") == "full_market"
        )
    ]
    if config.scope_mode == "full_market":
        products = full_feed_products
        symbols = []
    elif not symbols:
        products = []

    hash_payload = {
        "enabled": bool(config.is_enabled),
        "products": products,
        "symbols": symbols,
        "full_feed_products": full_feed_products,
        "account_updated": credential.account_checked_at.isoformat() if credential.account_checked_at else None,
    }
    return EffectiveAlphaSubscription(
        user_id=user_id,
        api_key=decrypt_value(credential.api_key_cipher),
        enabled=bool(config.is_enabled),
        products=products,
        symbols=symbols,
        full_feed_products=full_feed_products,
        account=account,
        config_hash=hashlib.sha256(_json_dumps(hash_payload).encode()).hexdigest(),
    )


def alpha_ws_config_out(db: Session, user_id: str) -> dict[str, Any]:
    credential = db.get(UserAlphaApiCredential, user_id)
    config = db.get(UserAlphaWebSocketConfig, user_id) or _default_config(user_id)
    account = _account_data(credential)
    entitlement = live_entitlement_from_account(account)
    addons = enabled_addons_from_account(account)
    effective = effective_subscription_for_user(db, user_id)
    configured_products = _json_loads(config.products_json, [])
    visible_products = configured_products or _entitled_products(account)
    entitled_addons = [
        {
            "product": product,
            "enabled": bool(addons.get(product, {}).get("enabled")),
            "tier": addons.get(product, {}).get("tier"),
        }
        for product in ALPHA_WS_PRODUCTS
    ]
    full_market_products = [
        str(item)
        for item in entitlement.get("full_market_products", [])
        if str(item) in ALPHA_WS_PRODUCTS
    ]
    if not full_market_products:
        full_market_products = [
            item["product"]
            for item in entitled_addons
            if item["enabled"] and item["tier"] == "full_market"
        ]
    full_market_allowed = bool(full_market_products)
    live_symbol_limit = _int_or_none(entitlement.get("active_symbol_limit"))
    if live_symbol_limit is None and entitled_addons:
        limits = [_tier_symbol_limit(item["tier"]) for item in entitled_addons if item["enabled"]]
        limits = [limit for limit in limits if limit is not None]
        live_symbol_limit = max(limits) if limits else None
    return {
        "is_enabled": bool(config.is_enabled),
        "products": visible_products,
        "scope_mode": config.scope_mode,
        "watchlist_ids": _json_loads(config.watchlist_ids_json, []),
        "include_all_watchlists": bool(config.include_all_watchlists),
        "full_market": bool(config.full_market),
        "entitled_addons": entitled_addons,
        "effective_products": effective.products if effective else [],
        "effective_symbols": effective.symbols if effective else [],
        "plan_id": entitlement.get("plan_id"),
        "plan_name": entitlement.get("plan_name") or (account.get("metadata") or {}).get("subscription_plan_name"),
        "live_symbol_limit": live_symbol_limit,
        "monthly_unique_symbol_limit": _int_or_none(entitlement.get("monthly_unique_symbol_limit")),
        "effective_symbol_count": len(effective.symbols) if effective else 0,
        "full_market_products": full_market_products,
        "full_market_allowed": full_market_allowed,
        "status": config.last_status or "unknown",
        "last_error": config.last_error,
        "last_connected_at": config.last_connected_at,
        "last_event_at": config.last_event_at,
    }


def update_alpha_ws_config(db: Session, user_id: str, payload: Any) -> dict[str, Any]:
    config = db.get(UserAlphaWebSocketConfig, user_id)
    if config is None:
        config = _default_config(user_id)
    credential = db.get(UserAlphaApiCredential, user_id)
    account = _account_data(credential)
    entitlement = live_entitlement_from_account(account)
    addons = enabled_addons_from_account(account)
    full_market_products = {
        str(item)
        for item in entitlement.get("full_market_products", [])
        if str(item) in ALPHA_WS_PRODUCTS
    }
    full_market_products.update(
        product
        for product, item in addons.items()
        if bool(item.get("enabled", True)) and item.get("tier") == "full_market"
    )
    if payload.scope_mode == "full_market" and not full_market_products:
        raise ValueError("Full market feed is not enabled for the current Market Stack plan.")
    live_symbol_limit = _int_or_none(entitlement.get("active_symbol_limit"))
    if payload.scope_mode != "full_market" and live_symbol_limit is not None:
        scoped_symbols: list[str] = []
        if payload.scope_mode in {"alert_subscriptions", "alerts_and_watchlists"}:
            scoped_symbols.extend(_symbols_from_alert_subscriptions(db, user_id))
        if payload.scope_mode == "alerts_and_watchlists":
            scoped_symbols.extend(
                _symbols_from_watchlists(
                    db,
                    user_id,
                    watchlist_ids=[str(item) for item in payload.watchlist_ids],
                    include_all=bool(payload.include_all_watchlists),
                )
            )
        scoped_symbol_count = len(set(scoped_symbols))
        if scoped_symbol_count > live_symbol_limit:
            raise ValueError(
                f"This Market Stack plan allows {live_symbol_limit} live symbols. "
                f"The selected scope resolves to {scoped_symbol_count}."
            )
    products = [
        product
        for product in payload.products
        if product in ALPHA_WS_PRODUCTS
    ]
    config.is_enabled = payload.is_enabled
    config.products_json = _json_dumps(products)
    config.scope_mode = payload.scope_mode
    config.watchlist_ids_json = _json_dumps([str(item) for item in payload.watchlist_ids])
    config.include_all_watchlists = payload.include_all_watchlists
    config.full_market = payload.full_market
    db.add(config)
    db.commit()
    return alpha_ws_config_out(db, user_id)


def _publish_event(client: redis.Redis | None, user_id: str, product: str, payload: dict[str, Any]) -> None:
    if client is None:
        return
    envelope = {"channel": product, "data": payload}
    stream = f"alpha:ws:{user_id}:{product}"
    body = _json_dumps(envelope)
    try:
        client.xadd(stream, {"payload": body}, maxlen=STREAM_MAXLEN, approximate=True)
        client.publish(stream, body)
    except redis.RedisError as exc:
        logger.warning("Alpha websocket publish failed for %s/%s: %s", user_id, product, exc)


def _store_event(user_id: str, product: str, payload: dict[str, Any]) -> AlphaWebSocketEvent:
    db = SessionLocal()
    try:
        symbols: set[str] = set()
        _collect_symbols(payload, symbols)
        row = AlphaWebSocketEvent(
            id=str(uuid.uuid4()),
            user_id=user_id,
            product=product,
            symbol=next(iter(sorted(symbols)), None),
            event_key=_event_key(product, payload),
            payload_json=_json_dumps(payload),
            received_at=_utc_now(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def _mark_config(user_id: str, **patch: Any) -> None:
    db = SessionLocal()
    try:
        row = db.get(UserAlphaWebSocketConfig, user_id)
        if row is None:
            row = _default_config(user_id)
        for key, value in patch.items():
            setattr(row, key, value)
        db.add(row)
        db.commit()
    finally:
        db.close()


async def _send_subscriptions(
    websocket,
    subscription: EffectiveAlphaSubscription,
) -> None:
    for product in subscription.products:
        symbols = [] if product in subscription.full_feed_products else subscription.symbols
        await websocket.send(_json_dumps({"op": "subscribe", "product": product, "symbols": symbols}))


async def _await_message(websocket) -> str | None:
    try:
        return await asyncio.wait_for(websocket.recv(), timeout=WS_RECV_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        pong_waiter = await websocket.ping()
        await asyncio.wait_for(pong_waiter, timeout=WS_PING_TIMEOUT_SECONDS)
        return None


def _next_retry_delay(current_delay: int | float) -> int | float:
    return min(max(current_delay * 2, WS_INITIAL_RETRY_DELAY_SECONDS), WS_MAX_RETRY_DELAY_SECONDS)


async def _run_user_subscription(subscription: EffectiveAlphaSubscription, stop_event: asyncio.Event) -> None:
    settings = get_settings()
    ws_base = settings.alpha_api_base_url.rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
    url = f"{ws_base}/v1/ws"
    redis_client = _redis_client()
    retry_delay: int | float = WS_INITIAL_RETRY_DELAY_SECONDS
    while not stop_event.is_set():
        try:
            _mark_config(subscription.user_id, last_status="connecting", last_error=None)
            async with websockets.connect(
                url,
                additional_headers={"X-API-Key": subscription.api_key},
                open_timeout=WS_CONNECT_TIMEOUT_SECONDS,
                ping_interval=WS_PING_INTERVAL_SECONDS,
                ping_timeout=WS_PING_TIMEOUT_SECONDS,
                close_timeout=10,
                max_queue=1000,
            ) as websocket:
                _mark_config(subscription.user_id, last_status="connected", last_error=None, last_connected_at=_utc_now())
                retry_delay = WS_INITIAL_RETRY_DELAY_SECONDS
                await _send_subscriptions(websocket, subscription)
                while not stop_event.is_set():
                    raw = await _await_message(websocket)
                    if raw is None:
                        continue
                    try:
                        parsed = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    product = str(parsed.get("channel") or parsed.get("product") or "")
                    if not product or product not in subscription.products:
                        continue
                    if parsed.get("status") == "subscribed":
                        continue
                    data = parsed.get("data") if isinstance(parsed, dict) else parsed
                    event_payload = data if isinstance(data, dict) else {"raw": data}
                    _store_event(subscription.user_id, product, event_payload)
                    _publish_event(redis_client, subscription.user_id, product, event_payload)
                    _mark_config(subscription.user_id, last_status="connected", last_error=None, last_event_at=_utc_now())
        except (asyncio.CancelledError, KeyboardInterrupt):
            raise
        except Exception as exc:
            logger.warning(
                "Alpha websocket loop failed for %s: %s; retrying in %.1fs",
                subscription.user_id,
                exc,
                retry_delay,
            )
            _mark_config(subscription.user_id, last_status="reconnecting", last_error=str(exc))
            if not await _wait_for_stop(stop_event, retry_delay):
                retry_delay = _next_retry_delay(retry_delay)
                continue
            break
    _mark_config(subscription.user_id, last_status="stopped")


async def run_alpha_websocket_worker(stop_event: asyncio.Event) -> None:
    tasks: dict[str, tuple[str, asyncio.Task[None]]] = {}
    while not stop_event.is_set():
        try:
            db = SessionLocal()
            try:
                rows = db.scalars(
                    select(UserAlphaApiCredential).where(
                        UserAlphaApiCredential.is_enabled.is_(True),
                        UserAlphaApiCredential.api_key_cipher != "",
                    )
                ).all()
                subscriptions: dict[str, EffectiveAlphaSubscription] = {}
                for row in rows:
                    if (
                        row.account_checked_at is None
                        or row.account_checked_at < _utc_now() - timedelta(seconds=ACCOUNT_REFRESH_SECONDS)
                    ):
                        try:
                            await refresh_account_for_user(row.user_id)
                        except Exception as exc:
                            logger.warning("Alpha account refresh failed for %s: %s", row.user_id, exc)
                    subscription = effective_subscription_for_user(db, row.user_id)
                    if subscription and subscription.enabled and subscription.products:
                        subscriptions[row.user_id] = subscription
                for user_id, (config_hash, task) in list(tasks.items()):
                    current = subscriptions.get(user_id)
                    if task.done():
                        try:
                            task.result()
                        except asyncio.CancelledError:
                            pass
                        except Exception as exc:
                            logger.warning("alpha websocket task crashed for %s: %s", user_id, exc)
                        tasks.pop(user_id, None)
                        continue
                    if current is None or current.config_hash != config_hash:
                        task.cancel()
                        tasks.pop(user_id, None)
                        _mark_config(user_id, last_status="reconfiguring")
                for user_id, subscription in subscriptions.items():
                    if user_id not in tasks:
                        tasks[user_id] = (
                            subscription.config_hash,
                            asyncio.create_task(_run_user_subscription(subscription, stop_event)),
                        )
                inactive_user_ids = {row.user_id for row in rows if row.user_id not in subscriptions}
                for user_id in inactive_user_ids:
                    _mark_config(user_id, last_status="inactive")
            finally:
                db.close()
        except Exception as exc:
            logger.warning("alpha websocket supervisor loop failed: %s", exc)
        if not await _wait_for_stop(stop_event, SUPERVISOR_INTERVAL_SECONDS):
            continue
        break
    for _, task in tasks.values():
        task.cancel()
    if tasks:
        await asyncio.gather(*(task for _, task in tasks.values()), return_exceptions=True)
