from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import redis
from sqlalchemy import select

from app.services import alerts as alert_svc
from app.services import broker_data
from db.models import (
    AlertWorkflow,
    AlertWorkflowRun,
    BrokerAccount,
    LiveSymbolSubscription,
)
from db.session import SessionLocal

logger = logging.getLogger(__name__)
STREAM_BLOCK_MS = 5000
STREAM_MAX_BATCH = 200
WORKFLOW_TICK_TTL_SECONDS = 24 * 60 * 60


def _redis() -> redis.Redis | None:
    from broker.core.redis_cache import _redis_client

    return _redis_client()


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _stream_name(user_id: str, account_id: str, broker_code: str) -> str:
    return f"live:ticks:{user_id}:{account_id}:{broker_code}"


def _workflow_tick_key(workflow_id: str) -> str:
    return f"alert:workflow:last-tick:{workflow_id}"


def _normalize_tick_payload(
    *,
    user_id: str,
    account_id: str,
    broker_code: str,
    symbols: list[str],
    connection_index: int,
    chunk_rows: list[LiveSymbolSubscription],
    quote_payload: dict[str, Any],
    row: LiveSymbolSubscription,
) -> dict[str, Any]:
    detail = quote_payload.get("detail") or {}
    raw = detail.get("raw") if isinstance(detail, dict) else {}
    ohlc = raw.get("ohlc") if isinstance(raw, dict) else {}
    return {
        "user_id": user_id,
        "account_id": account_id,
        "broker_code": broker_code,
        "symbol": row.symbol,
        "exchange": row.exchange,
        "instrument_key": row.symbol,
        "ltp": quote_payload.get("ltp"),
        "open": ohlc.get("open"),
        "high": ohlc.get("high"),
        "low": ohlc.get("low"),
        "close": ohlc.get("close"),
        "volume": raw.get("volume"),
        "open_interest": raw.get("open_interest"),
        "day_change": raw.get("day_change"),
        "day_change_perc": raw.get("day_change_perc"),
        "last_trade_time": raw.get("last_trade_time"),
        "received_at": _utc_now().isoformat(),
        "raw": quote_payload,
        "adapter": "polling",
        "symbols": symbols,
        "connection_id": f"{broker_code}:{account_id}:{connection_index}",
        "connection_index": connection_index,
        "symbol_count": len(chunk_rows),
        "capacity": 1000,
    }


def _publish_tick(redis_client: redis.Redis | None, tick: dict[str, Any]) -> None:
    if redis_client is None:
        return
    try:
        key = f"live:quote:{tick['user_id']}:{tick['account_id']}:{tick['broker_code']}:{tick['symbol']}"
        redis_client.setex(key, 120, json.dumps(tick, default=str))
        redis_client.xadd(
            f"live:ticks:{tick['user_id']}:{tick['account_id']}:{tick['broker_code']}",
            {"payload": json.dumps(tick, default=str)},
            maxlen=2000,
            approximate=True,
        )
        redis_client.setex(
            f"alert-live:session:{tick['user_id']}:{tick['account_id']}:{tick['broker_code']}:{tick.get('connection_index', 1)}",
            120,
            json.dumps(
                {
                    "user_id": tick["user_id"],
                    "account_id": tick["account_id"],
                    "broker_code": tick["broker_code"],
                    "adapter": tick.get("adapter", "polling"),
                    "connected": True,
                    "symbols": tick.get("symbols", []),
                    "connection_id": tick.get("connection_id"),
                    "connection_index": tick.get("connection_index", 1),
                    "symbol_count": tick.get("symbol_count", len(tick.get("symbols", []))),
                    "capacity": tick.get("capacity", 1000),
                    "last_seen_at": _utc_now().isoformat(),
                }
            ),
        )
    except redis.RedisError as exc:
        logger.warning("tick publish failed: %s", exc)


async def run_live_market_data_worker(stop_event: asyncio.Event, poll_interval_seconds: float = 2.0) -> None:
    redis_client = _redis()
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            rows = db.scalars(
                select(LiveSymbolSubscription).where(LiveSymbolSubscription.status == "active")
            ).all()
            grouped: dict[tuple[str, str, str], list[LiveSymbolSubscription]] = {}
            for row in rows:
                if not row.account_id or not row.broker_code:
                    continue
                grouped.setdefault((row.user_id, row.account_id, row.broker_code), []).append(row)
            for (user_id, account_id, _broker_code), subscriptions in grouped.items():
                acc = db.get(BrokerAccount, account_id)
                if not acc:
                    continue
                ordered_subscriptions = sorted(subscriptions, key=lambda item: (item.exchange or "", item.symbol))
                for chunk_index, start in enumerate(range(0, len(ordered_subscriptions), 1000), start=1):
                    chunk_rows = ordered_subscriptions[start : start + 1000]
                    instruments = [
                        {
                            "symbol": row.symbol,
                            "exchange": row.exchange,
                            **json.loads(row.instrument_ref_json or "{}"),
                        }
                        for row in chunk_rows
                    ]
                    try:
                        quotes = broker_data.fetch_quotes(db, acc, instruments)
                    except Exception as exc:
                        logger.warning("quote poll failed for %s: %s", account_id, exc)
                        continue
                    quote_index = {str(item.symbol or ""): item for item in quotes}
                    for row in chunk_rows:
                        quote = quote_index.get(row.symbol)
                        if not quote:
                            continue
                        payload = quote.model_dump(mode="json")
                        row.last_quote_json = json.dumps(payload, default=str)
                        row.last_received_at = _utc_now()
                        db.add(row)
                        _publish_tick(redis_client, _normalize_tick_payload(
                            user_id=user_id,
                            account_id=account_id,
                            broker_code=acc.broker_code,
                            symbols=[sub.symbol for sub in chunk_rows],
                            connection_index=chunk_index,
                            chunk_rows=chunk_rows,
                            quote_payload=payload,
                            row=row,
                        ))
            db.commit()
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
        except TimeoutError:
            continue

def _active_streams(db) -> list[str]:
    rows = db.execute(
        select(
            LiveSymbolSubscription.user_id,
            LiveSymbolSubscription.account_id,
            LiveSymbolSubscription.broker_code,
        )
        .where(LiveSymbolSubscription.status == "active")
        .distinct()
    ).all()
    return [
        _stream_name(user_id, account_id, broker_code)
        for user_id, account_id, broker_code in rows
        if user_id and account_id and broker_code
    ]


def _previous_tick_for_workflow(
    db,
    redis_client: redis.Redis | None,
    workflow_id: str,
) -> dict[str, Any]:
    if redis_client is not None:
        try:
            cached = redis_client.get(_workflow_tick_key(workflow_id))
        except redis.RedisError:
            cached = None
        if cached:
            return json.loads(cached)
    last_run = db.scalars(
        select(AlertWorkflowRun)
        .where(AlertWorkflowRun.workflow_id == workflow_id)
        .order_by(AlertWorkflowRun.created_at.desc())
        .limit(1)
    ).first()
    return json.loads(last_run.tick_json) if last_run and last_run.tick_json else {}


def _store_previous_tick_for_workflow(
    redis_client: redis.Redis | None,
    workflow_id: str,
    tick: dict[str, Any],
) -> None:
    if redis_client is None:
        return
    try:
        redis_client.setex(_workflow_tick_key(workflow_id), WORKFLOW_TICK_TTL_SECONDS, json.dumps(tick, default=str))
    except redis.RedisError as exc:
        logger.warning("workflow tick cache failed for %s: %s", workflow_id, exc)


def _enrich_tick_for_match(db, workflow: AlertWorkflow, tick: dict[str, Any]) -> dict[str, Any]:
    if not workflow.account_id:
        return tick
    account = db.get(BrokerAccount, workflow.account_id)
    if not account:
        return tick
    instrument = {
        "symbol": workflow.symbol or tick.get("symbol"),
        "exchange": workflow.exchange or tick.get("exchange"),
        **json.loads(workflow.instrument_ref_json or "{}"),
    }
    try:
        ohlc_rows = broker_data.fetch_ohlc(db, account, [instrument])
    except Exception as exc:
        logger.debug("ohlc enrichment failed for workflow %s: %s", workflow.id, exc)
        return tick
    if not ohlc_rows:
        return tick
    ohlc = ohlc_rows[0].model_dump(mode="json")
    return {
        **tick,
        "open": ohlc.get("open", tick.get("open")),
        "high": ohlc.get("high", tick.get("high")),
        "low": ohlc.get("low", tick.get("low")),
        "close": ohlc.get("close", tick.get("close")),
        "ohlc": ohlc,
    }


def _process_tick_event(db, redis_client: redis.Redis | None, tick: dict[str, Any]) -> None:
    if not tick.get("user_id") or not tick.get("account_id") or not tick.get("broker_code") or not tick.get("symbol"):
        return
    stmt = select(AlertWorkflow).where(
        AlertWorkflow.user_id == tick["user_id"],
        AlertWorkflow.account_id == tick["account_id"],
        AlertWorkflow.broker_code == tick["broker_code"],
        AlertWorkflow.symbol == tick["symbol"],
        AlertWorkflow.status == "active",
    )
    exchange = tick.get("exchange")
    if exchange:
        stmt = stmt.where((AlertWorkflow.exchange == exchange) | (AlertWorkflow.exchange.is_(None)))
    workflows = db.scalars(stmt).all()
    for row in workflows:
        workflow = alert_svc._workflow_to_out(row)  # type: ignore[attr-defined]
        previous_tick = _previous_tick_for_workflow(db, redis_client, workflow.id)
        matched, reason = alert_svc.evaluate_workflow_payload(workflow, tick, previous_tick)
        evaluation_tick = tick
        notification_id = None
        should_record_run = False
        if matched:
            cooldown = workflow.workflow_dsl.cooldown_seconds
            can_trigger = True
            if row.last_triggered_at:
                can_trigger = (_utc_now() - row.last_triggered_at).total_seconds() >= cooldown
            if can_trigger:
                evaluation_tick = _enrich_tick_for_match(db, row, tick)
                title = alert_svc._render_message(  # type: ignore[attr-defined]
                    workflow.workflow_dsl.notification.title_template,
                    {**evaluation_tick, "symbol": workflow.symbol},
                )
                message = alert_svc._render_message(  # type: ignore[attr-defined]
                    workflow.workflow_dsl.notification.message_template,
                    {**evaluation_tick, "symbol": workflow.symbol},
                )
                notification = alert_svc.create_alert_notification(
                    db,
                    user_id=workflow.user_id,
                    workflow=workflow,
                    title=title,
                    message=message,
                    level=workflow.workflow_dsl.notification.level,
                    channels=_workflow_channels(db, workflow.user_id, workflow),
                    payload=evaluation_tick,
                    dedupe_key=f"{workflow.id}:{workflow.symbol}:{reason}",
                )
                notification_id = notification.id
                row.last_triggered_at = _utc_now()
                db.add(row)
                should_record_run = True
            else:
                reason = f"{reason}; cooldown active"
                should_record_run = True
        if should_record_run:
            title = alert_svc._render_message(  # type: ignore[attr-defined]
                workflow.workflow_dsl.notification.title_template,
                {**evaluation_tick, "symbol": workflow.symbol},
            )
            message = alert_svc._render_message(  # type: ignore[attr-defined]
                workflow.workflow_dsl.notification.message_template,
                {**evaluation_tick, "symbol": workflow.symbol},
            )
            db.add(
                AlertWorkflowRun(
                    id=str(uuid4()),
                    workflow_id=workflow.id,
                    notification_id=notification_id,
                    matched=matched,
                    reason=reason,
                    rendered_title=title,
                    rendered_message=message,
                    channels_json=json.dumps(_workflow_channels(db, workflow.user_id, workflow)),
                    tick_json=json.dumps(evaluation_tick, default=str),
                    evaluation_payload_json=json.dumps({"previous_tick": previous_tick, "event_driven": True}, default=str),
                )
            )
        _store_previous_tick_for_workflow(redis_client, workflow.id, tick)
    db.commit()


async def run_alert_evaluator_worker(stop_event: asyncio.Event, poll_interval_seconds: float = 2.0) -> None:
    redis_client = _redis()
    stream_offsets: dict[str, str] = {}
    while not stop_event.is_set():
        if redis_client is None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
            except TimeoutError:
                redis_client = _redis()
            continue
        db = SessionLocal()
        try:
            streams = _active_streams(db)
        finally:
            db.close()
        if not streams:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
            except TimeoutError:
                continue
            continue
        stream_query = {name: stream_offsets.get(name, "$") for name in streams}
        try:
            events = redis_client.xread(stream_query, count=STREAM_MAX_BATCH, block=STREAM_BLOCK_MS)
        except redis.RedisError as exc:
            logger.warning("alert evaluator stream read failed: %s", exc)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
            except TimeoutError:
                redis_client = _redis()
            continue
        if not events:
            continue
        db = SessionLocal()
        try:
            for stream_name, messages in events:
                stream_key = stream_name.decode() if isinstance(stream_name, bytes) else str(stream_name)
                for message_id, fields in messages:
                    stream_offsets[stream_key] = (
                        message_id.decode() if isinstance(message_id, bytes) else str(message_id)
                    )
                    raw_payload = fields.get(b"payload") if isinstance(next(iter(fields.keys())), bytes) else fields.get("payload")
                    if raw_payload is None:
                        continue
                    payload_text = raw_payload.decode() if isinstance(raw_payload, bytes) else str(raw_payload)
                    tick = json.loads(payload_text)
                    _process_tick_event(db, redis_client, tick)
        except Exception as exc:
            logger.warning("alert evaluator event loop failed: %s", exc)
            db.rollback()
        finally:
            db.close()


async def run_alert_delivery_worker(stop_event: asyncio.Event, poll_interval_seconds: float = 5.0) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            alert_svc.deliver_pending_notifications(db)
        except Exception as exc:
            logger.warning("alert delivery loop failed: %s", exc)
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
        except TimeoutError:
            continue


def _workflow_channels(db, user_id: str, workflow) -> list[str]:
    _ = user_id
    return alert_svc.resolve_workflow_channels(db, workflow)


async def run_all_alert_workers(stop_event: asyncio.Event) -> None:
    tasks = [
        asyncio.create_task(run_live_market_data_worker(stop_event)),
        asyncio.create_task(run_alert_evaluator_worker(stop_event)),
        asyncio.create_task(run_alert_delivery_worker(stop_event)),
    ]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
