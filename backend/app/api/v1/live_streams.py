from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from time import monotonic
from typing import Any

import redis
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import (
    AlertReconcileReportOut,
    LiveStreamsStatusOut,
    LiveSubscriptionBulkIn,
    LiveSubscriptionCreateIn,
    LiveSubscriptionOut,
    LiveSubscriptionReplaceIn,
)
from app.services import alerts as alert_svc
from broker.core.redis_cache import _redis_client
from db.models import LiveSymbolSubscription, User
from db.session import SessionLocal, get_db

router = APIRouter()

PRICE_STREAM_BLOCK_MS = 1000
PRICE_STREAM_MAX_BATCH = 250
PRICE_SCOPE_REFRESH_SECONDS = 10.0


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


def _stream_name(user_id: str, account_id: str, broker_code: str) -> str:
    return f"live:ticks:{user_id}:{account_id}:{broker_code}"


def _price_scope(user_id: str) -> tuple[dict[str, set[str]], list[tuple[str, str, str, str]]]:
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
        ref = (user_id, str(account_id), str(broker_code), normalized_symbol)
        if ref in seen_refs:
            continue
        seen_refs.add(ref)
        quote_refs.append(ref)
        symbols_by_stream[_stream_name(user_id, str(account_id), str(broker_code))].add(normalized_symbol)
    return dict(symbols_by_stream), quote_refs


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
        return []
    for raw in raw_rows:
        payload = _loads_json(raw, {})
        if isinstance(payload, dict) and payload:
            rows.append(payload)
    return rows


def _xread_prices(client: redis.Redis, streams: dict[str, str]) -> list[tuple[str, list[tuple[str, dict]]]]:
    if not streams:
        return []
    return client.xread(streams, block=PRICE_STREAM_BLOCK_MS, count=PRICE_STREAM_MAX_BATCH)


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


@router.websocket("/prices/ws")
async def live_prices_websocket(websocket: WebSocket) -> None:
    user_id = (websocket.query_params.get("user_id") or "").strip() or "local-dev-user"
    await websocket.accept()

    client = _redis_client()
    if client is None:
        await websocket.send_json({"type": "error", "message": "Redis is not available for live prices."})
        await websocket.close(code=1011)
        return

    symbols_by_stream, quote_refs = await asyncio.to_thread(_price_scope, user_id)
    streams = {stream_name: "$" for stream_name in symbols_by_stream}
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
            if now - last_scope_refresh >= PRICE_SCOPE_REFRESH_SECONDS:
                next_symbols_by_stream, quote_refs = await asyncio.to_thread(_price_scope, user_id)
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

            if not streams:
                await asyncio.sleep(1.0)
                continue

            messages = await asyncio.to_thread(_xread_prices, client, streams)
            batch: list[dict[str, Any]] = []
            for stream_name_raw, stream_messages in messages:
                stream_name = stream_name_raw.decode() if isinstance(stream_name_raw, bytes) else str(stream_name_raw)
                allowed_symbols = symbols_by_stream.get(stream_name, set())
                for message_id_raw, fields in stream_messages:
                    message_id = message_id_raw.decode() if isinstance(message_id_raw, bytes) else str(message_id_raw)
                    streams[stream_name] = message_id
                    payload = _payload_from_stream_message(fields)
                    if not payload:
                        continue
                    symbol = _normal_symbol(payload.get("symbol"))
                    if symbol and symbol in allowed_symbols:
                        batch.append(payload)
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
    return alert_svc.ensure_symbol_subscription(db, user.id, body)


@router.post("/subscriptions/bulk", response_model=list[LiveSubscriptionOut])
def add_subscriptions_bulk(
    body: LiveSubscriptionBulkIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    return alert_svc.ensure_symbol_subscriptions(db, user.id, body.subscriptions)


@router.post("/subscriptions/demand", response_model=list[LiveSubscriptionOut])
def touch_demand_subscriptions(
    body: LiveSubscriptionBulkIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    return alert_svc.touch_ui_live_subscriptions(db, user.id, body.subscriptions)


@router.put("/subscriptions/replace", response_model=list[LiveSubscriptionOut])
def replace_subscriptions(
    body: LiveSubscriptionReplaceIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LiveSubscriptionOut]:
    return alert_svc.replace_subscriptions(db, user.id, body.subscriptions)


@router.delete("/subscriptions/{subscription_id}")
def remove_subscription(
    subscription_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    ok = alert_svc.remove_subscription(db, user.id, subscription_id)
    if not ok:
        raise HTTPException(status_code=404, detail="subscription not found")
    return {"ok": True}


@router.delete("/subscriptions")
def remove_subscriptions_bulk(
    subscription_ids: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    ids = [item.strip() for item in subscription_ids.split(",") if item.strip()]
    return {"deleted": alert_svc.remove_subscriptions(db, user.id, ids)}


@router.post("/subscriptions/reconcile")
def reconcile_subscriptions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertReconcileReportOut:
    return alert_svc.reconcile_subscriptions_for_user(db, user.id)
