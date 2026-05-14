from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

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
    return [
        product
        for product in ALPHA_WS_PRODUCTS
        if bool(addons.get(product, {}).get("enabled"))
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
    stmt = (
        select(UserWatchlistSymbol.symbol)
        .join(UserWatchlist, UserWatchlist.id == UserWatchlistSymbol.watchlist_id)
        .where(UserWatchlist.user_id == user_id)
    )
    if not include_all:
        if not watchlist_ids:
            return []
        stmt = stmt.where(UserWatchlist.id.in_(watchlist_ids))
    rows = db.scalars(stmt).all()
    return [symbol for symbol in (_normalize_symbol(row) for row in rows) if symbol]


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
    full_feed_products = [
        product
        for product in products
        if config.full_market
        and config.scope_mode == "full_market"
        and addons.get(product, {}).get("tier") == "full_market"
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
    full_market_allowed = any(item["enabled"] and item["tier"] == "full_market" for item in entitled_addons)
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
    except TimeoutError:
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
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=retry_delay)
            except TimeoutError:
                retry_delay = _next_retry_delay(retry_delay)
                continue
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
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=SUPERVISOR_INTERVAL_SECONDS)
        except TimeoutError:
            continue
    for _, task in tasks.values():
        task.cancel()
    if tasks:
        await asyncio.gather(*(task for _, task in tasks.values()), return_exceptions=True)
