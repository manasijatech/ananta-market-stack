from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

import redis
from sqlalchemy import desc, select

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


def _redis() -> redis.Redis | None:
    from broker.core.redis_cache import _redis_client

    return _redis_client()


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


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
                        _publish_tick(
                            redis_client,
                            {
                                "user_id": user_id,
                                "account_id": account_id,
                                "broker_code": acc.broker_code,
                                "symbol": row.symbol,
                                "exchange": row.exchange,
                                "instrument_key": row.symbol,
                                "ltp": payload.get("ltp"),
                                "received_at": row.last_received_at.isoformat(),
                                "raw": payload.get("detail", {}),
                                "adapter": "polling",
                                "symbols": [sub.symbol for sub in chunk_rows],
                                "connection_id": f"{acc.broker_code}:{account_id}:{chunk_index}",
                                "connection_index": chunk_index,
                                "symbol_count": len(chunk_rows),
                                "capacity": 1000,
                            },
                        )
            db.commit()
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
        except TimeoutError:
            continue

async def run_alert_evaluator_worker(stop_event: asyncio.Event, poll_interval_seconds: float = 2.0) -> None:
    redis_client = _redis()
    seen: dict[str, str] = {}
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            workflows = [
                alert_svc._workflow_to_out(row)  # type: ignore[attr-defined]
                for row in db.scalars(select(AlertWorkflow).where(AlertWorkflow.status == "active")).all()
            ]
            for workflow in workflows:
                if not workflow.account_id or not workflow.symbol:
                    continue
                if redis_client is None:
                    continue
                key = f"live:quote:{workflow.user_id}:{workflow.account_id}:{workflow.broker_code}:{workflow.symbol}"
                raw = redis_client.get(key)
                if not raw:
                    continue
                if seen.get(workflow.id) == raw:
                    continue
                tick = json.loads(raw)
                seen[workflow.id] = raw
                last_run = db.scalars(
                    select(AlertWorkflowRun)
                    .where(AlertWorkflowRun.workflow_id == workflow.id)
                    .order_by(desc(AlertWorkflowRun.created_at))
                    .limit(1)
                ).first()
                previous_tick = json.loads(last_run.tick_json) if last_run and last_run.tick_json else {}
                matched, reason = alert_svc.evaluate_workflow_payload(workflow, tick, previous_tick)
                notification_id = None
                title = alert_svc._render_message(workflow.workflow_dsl.notification.title_template, {**tick, "symbol": workflow.symbol})  # type: ignore[attr-defined]
                message = alert_svc._render_message(workflow.workflow_dsl.notification.message_template, {**tick, "symbol": workflow.symbol})  # type: ignore[attr-defined]
                if matched:
                    cooldown = workflow.workflow_dsl.cooldown_seconds
                    can_trigger = True
                    if last_run and last_run.matched and last_run.created_at:
                        can_trigger = (_utc_now() - last_run.created_at).total_seconds() >= cooldown
                    if can_trigger:
                        notification = alert_svc.create_alert_notification(
                            db,
                            user_id=workflow.user_id,
                            workflow=workflow,
                            title=title,
                            message=message,
                            level=workflow.workflow_dsl.notification.level,
                            channels=_workflow_channels(db, workflow.user_id, workflow),
                            payload=tick,
                            dedupe_key=f"{workflow.id}:{workflow.symbol}:{reason}",
                        )
                        notification_id = notification.id
                        row = db.get(AlertWorkflow, workflow.id)
                        if row:
                            row.last_triggered_at = _utc_now()
                            db.add(row)
                            db.commit()
                db.add(
                    AlertWorkflowRun(
                        id=str(__import__("uuid").uuid4()),
                        workflow_id=workflow.id,
                        notification_id=notification_id,
                        matched=matched,
                        reason=reason,
                        rendered_title=title,
                        rendered_message=message,
                        channels_json=json.dumps(_workflow_channels(db, workflow.user_id, workflow)),
                        tick_json=json.dumps(tick, default=str),
                        evaluation_payload_json=json.dumps({"previous_tick": previous_tick}, default=str),
                    )
                )
                db.commit()
        except Exception as exc:
            logger.warning("alert evaluator loop failed: %s", exc)
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
        except TimeoutError:
            continue


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
