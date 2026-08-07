from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from time import monotonic
from typing import Any

import redis
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import (
    AlertReconcileReportOut,
    LiveStreamsStatusOut,
    LiveSubscriptionBulkIn,
    LiveSubscriptionCreateIn,
    LiveSubscriptionDemandIn,
    LiveSubscriptionOut,
    LiveSubscriptionReplaceIn,
)
from app.schemas.live_heatmap import HeatmapResponseOut
from app.services import alerts as alert_svc
from app.services import live_heatmap
from app.services.live_price_scope import publish_scope_change, scope_stream_name
from broker.core.redis_cache import _redis_client
from db.models import LiveSymbolSubscription, User
from db.session import SessionLocal, get_db

router = APIRouter()

PRICE_STREAM_BLOCK_MS = 1000
PRICE_STREAM_MAX_BATCH = 250
PRICE_SCOPE_SAFETY_REFRESH_SECONDS = 60.0


def _loads_json(raw: Any, fallback: Any) -> Any:
    if raw is None:
        return fallback
    if isinstance(raw, bytes):
        raw = raw.decode()
    try:
        return json.loads(str(raw))
    except (TypeError, json.JSONDecodeError):
        return fallback


def _normal_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _quote_key(user_id: str, account_id: str, broker_code: str, symbol: str) -> str:
    return f"live:quote:{user_id}:{account_id}:{broker_code}:{symbol}"


def _market_quote_key(broker_code: str, symbol: str) -> str:
    return f"live:quote:market:{broker_code}:{symbol}"


def _payload_has_live_price(payload: dict[str, Any]) -> bool:
    candidates = [payload.get("ltp"), payload.get("last_price")]
    raw = payload.get("raw")
    if isinstance(raw, dict):
        candidates.append(raw.get("last_price"))
        candidates.append(raw.get("ltp"))
    detail = payload.get("detail")
    if isinstance(detail, dict):
        detail_raw = detail.get("raw")
        if isinstance(detail_raw, dict):
            candidates.append(detail_raw.get("last_price"))
            candidates.append(detail_raw.get("ltp"))
    for value in candidates:
        try:
            if float(value) > 0:
                return True
        except (TypeError, ValueError):
            continue
    return False


def _quote_raw_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else {}
    raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else {}
    if raw:
        return raw
    nested = payload.get("raw")
    return nested if isinstance(nested, dict) else {}


def _stale_tick_from_quote_payload(
    *,
    user_id: str,
    account_id: str,
    broker_code: str,
    symbol: str,
    payload: dict[str, Any],
    received_at: Any = None,
) -> dict[str, Any] | None:
    if not _payload_has_live_price(payload):
        return None
    raw = _quote_raw_from_payload(payload)
    ohlc = raw.get("ohlc") if isinstance(raw.get("ohlc"), dict) else {}
    ltp = payload.get("ltp")
    if ltp in (None, "", 0, "0"):
        ltp = payload.get("last_price")
    if ltp in (None, "", 0, "0"):
        ltp = raw.get("last_price") or raw.get("ltp")
    try:
        ltp_value = float(ltp)
    except (TypeError, ValueError):
        return None
    if ltp_value <= 0:
        return None

    open_price = payload.get("open") if payload.get("open") not in (None, "") else ohlc.get("open")
    high_price = payload.get("high") if payload.get("high") not in (None, "") else ohlc.get("high")
    low_price = payload.get("low") if payload.get("low") not in (None, "") else ohlc.get("low")
    close_price = payload.get("close") if payload.get("close") not in (None, "") else ohlc.get("close")
    change_pct = payload.get("change_pct")
    if change_pct in (None, ""):
        change_pct = payload.get("day_change_perc")
    if change_pct in (None, ""):
        change_pct = raw.get("day_change_perc") or raw.get("day_change_percentage")
    if change_pct in (None, "") and close_price not in (None, "", 0, "0"):
        try:
            reference = float(close_price)
            if reference:
                change_pct = round(((ltp_value - reference) / reference) * 100, 2)
        except (TypeError, ValueError):
            pass

    return {
        "user_id": user_id,
        "account_id": account_id,
        "broker_code": broker_code,
        "symbol": symbol,
        "exchange": (
            payload.get("exchange")
            or (payload.get("detail").get("exchange") if isinstance(payload.get("detail"), dict) else None)
        ),
        "ltp": ltp_value,
        "last_price": raw.get("last_price") if raw.get("last_price") not in (None, "") else ltp_value,
        "open": open_price,
        "high": high_price,
        "low": low_price,
        "close": close_price,
        "volume": payload.get("volume") if payload.get("volume") not in (None, "") else raw.get("volume"),
        "day_change": payload.get("day_change") if payload.get("day_change") not in (None, "") else raw.get("day_change"),
        "day_change_perc": change_pct,
        "change_pct": change_pct,
        "best_bid_price": payload.get("best_bid_price"),
        "best_ask_price": payload.get("best_ask_price"),
        "received_at": received_at or payload.get("received_at"),
        "stale": True,
        "status": "stale",
    }


def _read_db_quote_fallbacks(
    quote_refs: list[tuple[str, str, str, str]],
) -> list[dict[str, Any]]:
    if not quote_refs:
        return []
    by_user: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for user_id, account_id, broker_code, symbol in quote_refs:
        by_user[user_id].append((account_id, broker_code, symbol))

    rows: list[dict[str, Any]] = []
    db = SessionLocal()
    try:
        for user_id, refs in by_user.items():
            account_ids = {account_id for account_id, _, _ in refs}
            broker_codes = {broker_code for _, broker_code, _ in refs}
            symbols = {symbol for _, _, symbol in refs}
            subscriptions = db.execute(
                select(
                    LiveSymbolSubscription.account_id,
                    LiveSymbolSubscription.broker_code,
                    LiveSymbolSubscription.symbol,
                    LiveSymbolSubscription.last_quote_json,
                    LiveSymbolSubscription.last_received_at,
                ).where(
                    LiveSymbolSubscription.user_id == user_id,
                    LiveSymbolSubscription.account_id.in_(account_ids),
                    LiveSymbolSubscription.broker_code.in_(broker_codes),
                    LiveSymbolSubscription.symbol.in_(symbols),
                    LiveSymbolSubscription.last_quote_json.is_not(None),
                )
            ).all()
            wanted = {(account_id, broker_code, symbol) for account_id, broker_code, symbol in refs}
            seen: set[tuple[str, str, str]] = set()
            for account_id, broker_code, symbol, last_quote_json, last_received_at in subscriptions:
                key = (str(account_id), str(broker_code), _normal_symbol(symbol))
                if key not in wanted or key in seen:
                    continue
                payload = _loads_json(last_quote_json, {})
                if not isinstance(payload, dict):
                    continue
                tick = _stale_tick_from_quote_payload(
                    user_id=user_id,
                    account_id=key[0],
                    broker_code=key[1],
                    symbol=key[2],
                    payload=payload,
                    received_at=last_received_at.isoformat() if last_received_at else None,
                )
                if tick is None:
                    continue
                seen.add(key)
                rows.append(tick)
    finally:
        db.close()
    return rows


def _read_quote_snapshots(
    client: redis.Redis,
    quote_refs: list[tuple[str, str, str, str]],
) -> list[dict[str, Any]]:
    if not quote_refs:
        return []
    pipe = client.pipeline()
    for user_id, account_id, broker_code, symbol in quote_refs:
        pipe.get(_quote_key(user_id, account_id, broker_code, symbol))
    rows: list[dict[str, Any]] = []
    try:
        raw_rows = pipe.execute()
    except redis.RedisError:
        raw_rows = [None] * len(quote_refs)
    missing_refs: list[tuple[str, str, str, str]] = []
    for index, raw in enumerate(raw_rows):
        payload = _loads_json(raw, {})
        ref = quote_refs[index] if index < len(quote_refs) else None
        if isinstance(payload, dict) and payload and _payload_has_live_price(payload):
            rows.append(payload)
        elif ref:
            missing_refs.append(ref)
    still_missing: list[tuple[str, str, str, str]] = []
    if missing_refs:
        pipe = client.pipeline()
        for _, _, broker_code, symbol in missing_refs:
            pipe.get(_market_quote_key(broker_code, symbol))
        try:
            market_rows = pipe.execute()
        except redis.RedisError:
            market_rows = [None] * len(missing_refs)
        for index, raw in enumerate(market_rows):
            payload = _loads_json(raw, {})
            if isinstance(payload, dict) and payload and _payload_has_live_price(payload):
                rows.append(payload)
            elif index < len(missing_refs):
                still_missing.append(missing_refs[index])
    if still_missing:
        rows.extend(_read_db_quote_fallbacks(still_missing))
    return rows


def _stream_name(user_id: str, account_id: str, broker_code: str) -> str:
    return f"live:ticks:{user_id}:{account_id}:{broker_code}"


def _stream_label(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


def _parse_price_ref(value: str) -> tuple[str, str, str] | None:
    account_id, separator, rest = value.partition("|")
    if not separator:
        return None
    broker_code, separator, symbol = rest.partition("|")
    if not separator:
        return None
    normalized = (account_id.strip(), broker_code.strip(), _normal_symbol(symbol))
    return normalized if all(normalized) else None


def _price_scope(
    user_id: str,
    requested_refs: set[tuple[str, str, str]] | None = None,
) -> tuple[dict[str, set[str]], list[tuple[str, str, str, str]]]:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(
                LiveSymbolSubscription.account_id,
                LiveSymbolSubscription.broker_code,
                LiveSymbolSubscription.symbol,
            ).where(
                LiveSymbolSubscription.user_id == user_id,
                LiveSymbolSubscription.status == "active",
                LiveSymbolSubscription.account_id.is_not(None),
                LiveSymbolSubscription.broker_code.is_not(None),
            )
        ).all()
    finally:
        db.close()

    symbols_by_stream: dict[str, set[str]] = defaultdict(set)
    quote_refs: list[tuple[str, str, str, str]] = []
    seen_refs: set[tuple[str, str, str, str]] = set()
    for account_id, broker_code, symbol in rows:
        normalized_symbol = _normal_symbol(symbol)
        if not account_id or not broker_code or not normalized_symbol:
            continue
        requested_ref = (str(account_id), str(broker_code), normalized_symbol)
        if requested_refs is not None and requested_ref not in requested_refs:
            continue
        ref = (user_id, str(account_id), str(broker_code), normalized_symbol)
        if ref in seen_refs:
            continue
        seen_refs.add(ref)
        quote_refs.append(ref)
        symbols_by_stream[_stream_name(user_id, str(account_id), str(broker_code))].add(normalized_symbol)
    return dict(symbols_by_stream), quote_refs


def _xread_prices(client: redis.Redis, streams: dict[str, str]) -> list[tuple[str, list[tuple[str, dict]]]]:
    if not streams:
        return []
    return client.xread(streams, block=PRICE_STREAM_BLOCK_MS, count=PRICE_STREAM_MAX_BATCH)


def _stream_query(price_streams: dict[str, str], scope_stream: str, scope_offset: str) -> dict[str, str]:
    return {**price_streams, scope_stream: scope_offset}


def _payload_from_stream_message(fields: dict[Any, Any]) -> dict[str, Any] | None:
    raw = fields.get(b"payload") or fields.get("payload")
    payload = _loads_json(raw, {})
    return payload if isinstance(payload, dict) else None


@router.get("/status", response_model=LiveStreamsStatusOut)
def live_status(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiveStreamsStatusOut:
    return alert_svc.live_stream_status(db, user.id)


@router.get("/heatmap", response_model=HeatmapResponseOut)
def get_live_heatmap(
    limit: int = Query(default=100, ge=1, le=1000),
    days: int | None = Query(default=None, ge=1, le=3650),
    scope: str = Query(default="tracked"),
    watchlist_id: str | None = Query(default=None),
    account_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HeatmapResponseOut:
    return live_heatmap.get_live_heatmap(
        db,
        user_id=user.id,
        limit=limit,
        days=days,
        scope=scope,
        watchlist_id=watchlist_id,
        account_id=account_id,
    )


@router.websocket("/prices/ws")
async def live_prices_websocket(websocket: WebSocket) -> None:
    user_id = (websocket.query_params.get("user_id") or "").strip() or "local-dev-user"
    requested_refs = {
        parsed
        for raw_ref in websocket.query_params.getlist("ref")
        if (parsed := _parse_price_ref(raw_ref))
    }
    client_scoped = (websocket.query_params.get("scope") or "").strip().lower() == "client"
    await websocket.accept()
    if client_scoped:
        try:
            message = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
            raw_refs = message.get("refs") if isinstance(message, dict) and message.get("type") == "subscribe" else None
            if not isinstance(raw_refs, list):
                raise ValueError("missing subscription refs")
            requested_refs = {
                parsed
                for raw_ref in raw_refs
                if isinstance(raw_ref, str) and (parsed := _parse_price_ref(raw_ref))
            }
            if not requested_refs:
                raise ValueError("empty subscription refs")
        except WebSocketDisconnect:
            return
        except (asyncio.TimeoutError, ValueError):
            await websocket.send_json({"type": "error", "message": "A valid live-price subscription scope is required."})
            await websocket.close(code=1008)
            return

    client = _redis_client()
    if client is None:
        await websocket.send_json({"type": "error", "message": "Redis is not available for live prices."})
        await websocket.close(code=1011)
        return

    symbols_by_stream, quote_refs = await asyncio.to_thread(_price_scope, user_id, requested_refs or None)
    streams = {stream_name: "$" for stream_name in symbols_by_stream}
    scope_stream = scope_stream_name(user_id)
    scope_offset = "$"
    last_scope_refresh = monotonic()

    await websocket.send_json(
        {
            "type": "connected",
            "stream_count": len(streams),
            "symbol_count": sum(len(symbols) for symbols in symbols_by_stream.values()),
        }
    )
    try:
        snapshots = await asyncio.to_thread(_read_quote_snapshots, client, quote_refs)
        if snapshots:
            await websocket.send_json({"type": "snapshot", "rows": snapshots})

        while True:
            now = monotonic()
            if now - last_scope_refresh >= PRICE_SCOPE_SAFETY_REFRESH_SECONDS:
                next_symbols_by_stream, quote_refs = await asyncio.to_thread(_price_scope, user_id, requested_refs or None)
                added_streams = set(next_symbols_by_stream) - set(streams)
                removed_streams = set(streams) - set(next_symbols_by_stream)
                for stream_name in removed_streams:
                    streams.pop(stream_name, None)
                for stream_name in added_streams:
                    streams[stream_name] = "$"
                symbols_by_stream = next_symbols_by_stream
                last_scope_refresh = now
                await websocket.send_json(
                    {
                        "type": "scope",
                        "stream_count": len(streams),
                        "symbol_count": sum(len(symbols) for symbols in symbols_by_stream.values()),
                    }
                )
                snapshots = await asyncio.to_thread(_read_quote_snapshots, client, quote_refs)
                if snapshots:
                    await websocket.send_json({"type": "snapshot", "rows": snapshots})

            messages = await asyncio.to_thread(_xread_prices, client, _stream_query(streams, scope_stream, scope_offset))
            batch: list[dict[str, Any]] = []
            scope_changed = False
            for stream_name_raw, stream_messages in messages:
                stream_name = _stream_label(stream_name_raw)
                if stream_name == scope_stream:
                    for message_id_raw, _fields in stream_messages:
                        scope_offset = _stream_label(message_id_raw)
                    scope_changed = True
                    continue
                allowed_symbols = symbols_by_stream.get(stream_name, set())
                for message_id_raw, fields in stream_messages:
                    message_id = _stream_label(message_id_raw)
                    streams[stream_name] = message_id
                    payload = _payload_from_stream_message(fields)
                    if not payload:
                        continue
                    symbol = _normal_symbol(payload.get("symbol"))
                    if symbol and symbol in allowed_symbols:
                        batch.append(payload)
            if scope_changed:
                next_symbols_by_stream, quote_refs = await asyncio.to_thread(_price_scope, user_id, requested_refs or None)
                added_streams = set(next_symbols_by_stream) - set(streams)
                removed_streams = set(streams) - set(next_symbols_by_stream)
                for stream_name in removed_streams:
                    streams.pop(stream_name, None)
                for stream_name in added_streams:
                    streams[stream_name] = "$"
                symbols_by_stream = next_symbols_by_stream
                last_scope_refresh = monotonic()
                await websocket.send_json(
                    {
                        "type": "scope",
                        "stream_count": len(streams),
                        "symbol_count": sum(len(symbols) for symbols in symbols_by_stream.values()),
                    }
                )
                snapshots = await asyncio.to_thread(_read_quote_snapshots, client, quote_refs)
                if snapshots:
                    await websocket.send_json({"type": "snapshot", "rows": snapshots})
            if batch:
                await websocket.send_json({"type": "prices", "rows": batch})
    except WebSocketDisconnect:
        return
    except redis.RedisError as exc:
        await websocket.send_json({"type": "error", "message": f"Redis live price stream failed: {exc}"})
        await websocket.close(code=1011)


@router.get("/subscriptions", response_model=list[LiveSubscriptionOut])
def list_subscriptions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    return alert_svc.list_subscriptions(db, user.id)


@router.post("/subscriptions", response_model=LiveSubscriptionOut)
def add_subscription(
    body: LiveSubscriptionCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LiveSubscriptionOut:
    row = alert_svc.ensure_symbol_subscription(db, user.id, body)
    publish_scope_change(user.id, reason="subscription_added")
    return row


@router.post("/subscriptions/bulk", response_model=list[LiveSubscriptionOut])
def add_subscriptions_bulk(
    body: LiveSubscriptionBulkIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    rows = alert_svc.ensure_symbol_subscriptions(db, user.id, body.subscriptions)
    publish_scope_change(user.id, reason="subscriptions_added")
    return rows


@router.post("/subscriptions/demand", response_model=list[LiveSubscriptionOut])
def touch_demand_subscriptions(
    body: LiveSubscriptionDemandIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    rows, scope_changed = alert_svc.touch_ui_live_subscriptions(
        db,
        user.id,
        body.subscriptions,
        scopes=[(scope.source_type, scope.source_id) for scope in body.scopes],
    )
    if scope_changed:
        publish_scope_change(user.id, reason="ui_demand")
    return rows


@router.put("/subscriptions/replace", response_model=list[LiveSubscriptionOut])
def replace_subscriptions(
    body: LiveSubscriptionReplaceIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    rows = alert_svc.replace_subscriptions(db, user.id, body.subscriptions)
    publish_scope_change(user.id, reason="subscriptions_replaced")
    return rows


@router.delete("/subscriptions/{subscription_id}")
def remove_subscription(
    subscription_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    ok = alert_svc.remove_subscription(db, user.id, subscription_id)
    if not ok:
        raise HTTPException(status_code=404, detail="subscription not found")
    publish_scope_change(user.id, reason="subscription_removed")
    return {"ok": True}


@router.delete("/subscriptions")
def remove_subscriptions_bulk(
    subscription_ids: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    ids = [item.strip() for item in subscription_ids.split(",") if item.strip()]
    deleted = alert_svc.remove_subscriptions(db, user.id, ids)
    if deleted:
        publish_scope_change(user.id, reason="subscriptions_removed")
    return {"deleted": deleted}


@router.post("/subscriptions/reconcile")
def reconcile_subscriptions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertReconcileReportOut:
    report = alert_svc.reconcile_subscriptions_for_user(db, user.id)
    if any(int(report.get(key) or 0) for key in ("created", "restored", "deactivated", "orphaned")):
        publish_scope_change(user.id, reason="subscriptions_reconciled")
    return report
