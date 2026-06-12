from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from common.datetime_compat import UTC
import redis
from sqlalchemy import select

from app.config import get_settings
from app.services import alerts as alert_svc
from app.services.alert_feed_batch import (
    FeedAnalysisRequest,
    feed_case_from_workflow,
    run_feed_trigger_batches,
    run_followup_analysis_batches,
)
from app.services.alert_llm_analysis import run_workflow_llm_analysis
from app.services.alert_market_cap import (
    load_symbol_market_cap,
    market_cap_filter_enabled,
    market_cap_in_range,
)
from app.services.alerts_engine.reconcile import cleanup_expired_ui_subscriptions, reconcile_all_users
from app.services.alerts_engine.active_period import evaluate_active_period
from app.services.alerts_engine.ast import ensure_workflow_ast
from app.services.alerts_engine.rolling_state import (
    build_runtime_context,
    collect_rolling_fields,
    max_rolling_window_seconds,
    record_tick_samples,
)
from app.services import broker_data
from app.services.live_price_adapters import get_live_price_adapter
from broker.core.live_prices import LivePriceAdapter, is_access_forbidden_reason
from app.services.broker_sessions import (
    _create_notification_once_per_day,
    get_broker_session_status,
    mark_session_healthy,
    process_account_maintenance,
)
from app.services.alerts_engine.universes import resolve_universe
from app.services.alerts_engine.ast import AlertUniverseNode
from db.models import (
    AlphaWebSocketEvent,
    AlertWorkflow,
    AlertWorkflowRun,
    BrokerAccount,
    BrokerInstrument,
    LiveSymbolSubscription,
    UserWatchlist,
    UserWatchlistSymbol,
)
from db.session import SessionLocal

logger = logging.getLogger(__name__)
STREAM_BLOCK_MS = 1000
STREAM_MAX_BATCH = 200
WORKFLOW_TICK_TTL_SECONDS = 24 * 60 * 60
RECONCILE_INTERVAL_SECONDS = 5 * 60
BACKGROUND_RESTART_DELAY_SECONDS = 5.0
ACTION_REQUIRED_RETRY_SECONDS = 15 * 60
TRANSIENT_RETRY_SECONDS = 60
_ACCOUNT_RETRY_NOT_BEFORE: dict[str, datetime] = {}


def _redis() -> redis.Redis | None:
    from broker.core.redis_cache import _redis_client

    return _redis_client()


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


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _stream_name(user_id: str, account_id: str, broker_code: str) -> str:
    return f"live:ticks:{user_id}:{account_id}:{broker_code}"


def _workflow_tick_key(workflow_id: str) -> str:
    return f"alert:workflow:last-tick:{workflow_id}"


def _first_depth(raw: dict[str, Any], side: str) -> dict[str, Any]:
    depth = raw.get("depth") if isinstance(raw, dict) else {}
    rows = depth.get(side) if isinstance(depth, dict) else []
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return rows[0]
    return {}


def _computed_quote_fields(raw: dict[str, Any], ltp: Any, ohlc: dict[str, Any]) -> dict[str, Any]:
    open_price = ohlc.get("open")
    close_price = ohlc.get("close")
    reference_price = close_price or open_price
    change_pct = raw.get("day_change_perc")
    abs_change = None
    gap_pct = None
    volume_ratio = None
    try:
        if ltp not in (None, "") and reference_price not in (None, "", 0, "0"):
            abs_change = round(float(ltp) - float(reference_price), 2)
            if change_pct in (None, ""):
                change_pct = round(((float(ltp) - float(reference_price)) / float(reference_price)) * 100, 2)
    except Exception:
        pass
    try:
        if open_price not in (None, "") and close_price not in (None, "", 0, "0"):
            gap_pct = round(((float(open_price) - float(close_price)) / float(close_price)) * 100, 2)
    except Exception:
        pass
    try:
        avg_volume = raw.get("avg_volume")
        if raw.get("volume") not in (None, "") and avg_volume not in (None, "", 0, "0"):
            volume_ratio = round(float(raw["volume"]) / float(avg_volume), 2)
    except Exception:
        pass
    return {
        "reference_price": reference_price,
        "change_pct": change_pct,
        "abs_change": abs_change,
        "gap_pct": gap_pct,
        "volume_ratio": volume_ratio,
    }


def _quote_raw(payload: dict[str, Any]) -> dict[str, Any]:
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else {}
    raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else {}
    return raw


def _quote_has_change_context(payload: dict[str, Any]) -> bool:
    raw = _quote_raw(payload)
    ohlc = raw.get("ohlc") if isinstance(raw.get("ohlc"), dict) else {}
    return any(
        value not in (None, "")
        for value in (
            raw.get("day_change"),
            raw.get("day_change_perc"),
            raw.get("day_change_percentage"),
            ohlc.get("close"),
            payload.get("day_change"),
            payload.get("day_change_perc"),
        )
    )


def _merge_existing_quote_context(new_payload: dict[str, Any], existing_json: str | None) -> dict[str, Any]:
    if _quote_has_change_context(new_payload) or not existing_json:
        return new_payload
    try:
        existing_payload = json.loads(existing_json)
    except (TypeError, json.JSONDecodeError):
        return new_payload
    if not isinstance(existing_payload, dict) or not _quote_has_change_context(existing_payload):
        return new_payload

    merged = dict(new_payload)
    merged_detail = dict(merged.get("detail") if isinstance(merged.get("detail"), dict) else {})
    merged_raw = dict(merged_detail.get("raw") if isinstance(merged_detail.get("raw"), dict) else {})
    existing_raw = _quote_raw(existing_payload)
    existing_ohlc = existing_raw.get("ohlc") if isinstance(existing_raw.get("ohlc"), dict) else {}
    merged_ohlc = dict(merged_raw.get("ohlc") if isinstance(merged_raw.get("ohlc"), dict) else {})
    for key in (
        "day_change",
        "day_change_perc",
        "day_change_percentage",
        "volume",
        "upper_circuit_limit",
        "lower_circuit_limit",
        "week_52_high",
        "week_52_low",
        "depth",
    ):
        if merged_raw.get(key) in (None, "") and existing_raw.get(key) not in (None, ""):
            merged_raw[key] = existing_raw.get(key)
    for key in ("open", "high", "low", "close"):
        if merged_ohlc.get(key) in (None, "") and existing_ohlc.get(key) not in (None, ""):
            merged_ohlc[key] = existing_ohlc.get(key)
    if merged_ohlc:
        merged_raw["ohlc"] = merged_ohlc
    merged_detail["raw"] = merged_raw
    merged["detail"] = merged_detail
    return merged


def _instrument_scope_for_tick(db, workflow, tick: dict[str, Any]) -> dict[str, Any]:
    exchange = str(tick.get("exchange") or workflow.exchange or "").strip().upper()
    scope: dict[str, Any] = {
        "symbol": str(tick.get("symbol") or workflow.symbol or "").strip().upper(),
        "exchange": exchange,
        "exchange_type": exchange,
    }
    try:
        target = alert_svc.workflow_target_entry_for_tick(workflow, tick)  # type: ignore[attr-defined]
        metadata = target.metadata if target else {}
        if isinstance(metadata, dict):
            scope.update(
                {
                    "exchange_type": str(metadata.get("exchange_type") or scope["exchange_type"]).strip().upper(),
                    "segment": str(metadata.get("segment") or "").strip().upper(),
                    "instrument_type": str(metadata.get("instrument_type") or "").strip().upper(),
                }
            )
    except Exception:
        pass
    if scope.get("segment") or scope.get("instrument_type"):
        return scope
    row = db.scalars(
        select(BrokerInstrument)
        .where(
            BrokerInstrument.broker_code == str(tick.get("broker_code") or workflow.broker_code or ""),
            BrokerInstrument.symbol == scope["symbol"],
            BrokerInstrument.exchange == exchange,
        )
        .limit(1)
    ).first()
    if row:
        scope["segment"] = str(row.segment or "").strip().upper()
        scope["instrument_type"] = str(row.instrument_type or "").strip().upper()
    return scope


def _workflow_active_for_tick(db, workflow, tick: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    if workflow.workflow_dsl.workflow_type != "market_data":
        return True, {"active": True, "reason": "not a broker market-data workflow"}
    result = evaluate_active_period(
        workflow.workflow_dsl.active_period,
        _instrument_scope_for_tick(db, workflow, tick),
        now=_utc_now().replace(tzinfo=UTC),
    )
    return result.active, {"active": result.active, "reason": result.reason, **result.details}


def _workflow_active_for_feed(workflow) -> tuple[bool, dict[str, Any]]:
    if workflow.workflow_dsl.workflow_type != "alpha_feed":
        return True, {"active": True, "reason": "not an alpha feed workflow"}
    result = evaluate_active_period(
        workflow.workflow_dsl.active_period,
        {},
        now=_utc_now().replace(tzinfo=UTC),
    )
    return result.active, {"active": result.active, "reason": result.reason, **result.details}


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
    ohlc = raw.get("ohlc") if isinstance(raw, dict) and isinstance(raw.get("ohlc"), dict) else {}
    buy_top = _first_depth(raw, "buy") if isinstance(raw, dict) else {}
    sell_top = _first_depth(raw, "sell") if isinstance(raw, dict) else {}
    ltp = quote_payload.get("ltp")
    computed = _computed_quote_fields(raw if isinstance(raw, dict) else {}, ltp, ohlc if isinstance(ohlc, dict) else {})
    return {
        "user_id": user_id,
        "account_id": account_id,
        "broker_code": broker_code,
        "symbol": row.symbol,
        "exchange": row.exchange,
        "instrument_key": row.symbol,
        "ltp": ltp,
        "last_price": raw.get("last_price") if isinstance(raw, dict) else None,
        "open": ohlc.get("open"),
        "high": ohlc.get("high"),
        "low": ohlc.get("low"),
        "close": ohlc.get("close"),
        "average_price": raw.get("average_price") if isinstance(raw, dict) else None,
        "volume": raw.get("volume"),
        "avg_volume": raw.get("avg_volume") if isinstance(raw, dict) else None,
        "open_interest": raw.get("open_interest"),
        "previous_open_interest": raw.get("previous_open_interest") if isinstance(raw, dict) else None,
        "oi_day_change": raw.get("oi_day_change") if isinstance(raw, dict) else None,
        "oi_day_change_percentage": raw.get("oi_day_change_percentage") if isinstance(raw, dict) else None,
        "day_change": raw.get("day_change"),
        "day_change_perc": raw.get("day_change_perc"),
        "last_trade_quantity": raw.get("last_trade_quantity") if isinstance(raw, dict) else None,
        "last_trade_time": raw.get("last_trade_time"),
        "total_buy_quantity": raw.get("total_buy_quantity") if isinstance(raw, dict) else None,
        "total_sell_quantity": raw.get("total_sell_quantity") if isinstance(raw, dict) else None,
        "best_bid_price": buy_top.get("price"),
        "best_bid_quantity": buy_top.get("quantity"),
        "best_bid_orders": buy_top.get("orderCount"),
        "best_ask_price": sell_top.get("price"),
        "best_ask_quantity": sell_top.get("quantity"),
        "best_ask_orders": sell_top.get("orderCount"),
        "bid_price": raw.get("bid_price") if isinstance(raw, dict) else None,
        "bid_quantity": raw.get("bid_quantity") if isinstance(raw, dict) else None,
        "offer_price": raw.get("offer_price") if isinstance(raw, dict) else None,
        "offer_quantity": raw.get("offer_quantity") if isinstance(raw, dict) else None,
        "upper_circuit_limit": raw.get("upper_circuit_limit") if isinstance(raw, dict) else None,
        "lower_circuit_limit": raw.get("lower_circuit_limit") if isinstance(raw, dict) else None,
        "week_52_high": raw.get("week_52_high") if isinstance(raw, dict) else None,
        "week_52_low": raw.get("week_52_low") if isinstance(raw, dict) else None,
        "high_trade_range": raw.get("high_trade_range") if isinstance(raw, dict) else None,
        "low_trade_range": raw.get("low_trade_range") if isinstance(raw, dict) else None,
        "implied_volatility": raw.get("implied_volatility") if isinstance(raw, dict) else None,
        "market_cap": raw.get("market_cap") if isinstance(raw, dict) else None,
        **computed,
        "received_at": _utc_now().isoformat(),
        "raw": quote_payload,
        "adapter": "polling",
        "symbols": symbols,
        "connection_id": f"{broker_code}:{account_id}:{connection_index}",
        "connection_index": connection_index,
        "symbol_count": len(chunk_rows),
        "capacity": 1000,
    }


def _quote_live_price(payload: dict[str, Any]) -> float | None:
    candidates = [payload.get("ltp")]
    detail = payload.get("detail")
    raw = detail.get("raw") if isinstance(detail, dict) else None
    if isinstance(raw, dict):
        candidates.append(raw.get("last_price"))
    for value in candidates:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if numeric > 0:
            return numeric
    return None


def _quote_error_message(payload: dict[str, Any]) -> str:
    detail = payload.get("detail")
    raw = detail.get("raw") if isinstance(detail, dict) else None
    if not isinstance(raw, dict):
        return "Broker did not return a live price for this symbol."
    error = raw.get("error")
    if isinstance(error, dict):
        code = str(error.get("code") or "").strip()
        message = str(error.get("message") or "").strip()
        if code or message:
            return f"{code}: {message}".strip(": ")
    status = str(raw.get("status") or "").strip()
    return f"Broker quote status: {status}" if status else "Broker did not return a live price for this symbol."


def _is_rate_limit_reason(reason: str) -> bool:
    normalized = reason.lower()
    return "429" in reason or "rate limit" in normalized or "rate_limit" in normalized


def _is_access_forbidden_reason(reason: str) -> bool:
    return is_access_forbidden_reason(reason)


def _quote_failure_status(*, row_rate_limited: bool, row_access_forbidden: bool) -> str:
    if row_rate_limited:
        return "rate_limited"
    if row_access_forbidden:
        return "action_required"
    return "unavailable"


def _quote_debug_sample(rows: list[dict[str, Any]], *, limit: int = 12) -> list[dict[str, Any]]:
    return rows[:limit]


def _subscription_priority(row: LiveSymbolSubscription) -> tuple[int, float, str, str]:
    source_priority = {
        "ui": 0,
        "workflow": 1,
        "watchlist": 2,
        "background_workflow": 3,
        "manual": 4,
    }.get(row.source_kind or "", 5)
    updated_at = row.updated_at.timestamp() if row.updated_at else 0.0
    return (source_priority, -updated_at, row.exchange or "", row.symbol)


def _subscription_ref(row: LiveSymbolSubscription) -> dict[str, Any]:
    try:
        payload = json.loads(row.instrument_ref_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    return payload if isinstance(payload, dict) else {}


def _order_duplicate_group(rows: list[LiveSymbolSubscription]) -> list[LiveSymbolSubscription]:
    return sorted(
        rows,
        key=lambda row: (
            _subscription_priority(row),
            -len(row.instrument_ref_json or "{}"),
        ),
    )


def _instrument_for_group(rows: list[LiveSymbolSubscription]) -> dict[str, Any]:
    representative = rows[0]
    merged: dict[str, Any] = {}
    for row in sorted(rows, key=lambda item: len(item.instrument_ref_json or "{}"), reverse=True):
        for key, value in _subscription_ref(row).items():
            if value not in (None, "") and key not in merged:
                merged[key] = value
    merged["symbol"] = representative.symbol
    merged["exchange"] = representative.exchange
    return merged


def _publish_tick(redis_client: redis.Redis | None, tick: dict[str, Any]) -> None:
    if redis_client is None:
        return
    live_price = _quote_live_price(tick)
    if live_price is None:
        return
    try:
        key = f"live:quote:{tick['user_id']}:{tick['account_id']}:{tick['broker_code']}:{tick['symbol']}"
        market_key = f"live:quote:market:{tick['broker_code']}:{tick['symbol']}"
        ttl = max(int(get_settings().redis_live_price_ttl_seconds), 60)
        redis_client.setex(key, ttl, json.dumps(tick, default=str))
        redis_client.setex(market_key, ttl, json.dumps(tick, default=str))
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


def _publish_live_session(
    redis_client: redis.Redis | None,
    *,
    user_id: str,
    account_id: str,
    broker_code: str,
    adapter: str,
    symbols: list[str],
    connection_index: int,
    capacity: int = 1000,
) -> None:
    if redis_client is None:
        return
    try:
        redis_client.setex(
            f"alert-live:session:{user_id}:{account_id}:{broker_code}:{connection_index}",
            120,
            json.dumps(
                {
                    "user_id": user_id,
                    "account_id": account_id,
                    "broker_code": broker_code,
                    "adapter": adapter,
                    "connected": True,
                    "symbols": symbols,
                    "connection_id": f"{broker_code}:{account_id}:{connection_index}",
                    "connection_index": connection_index,
                    "symbol_count": len(symbols),
                    "capacity": capacity,
                    "last_seen_at": _utc_now().isoformat(),
                },
                default=str,
            ),
        )
    except redis.RedisError as exc:
        logger.warning("live session publish failed: %s", exc)


async def _apply_live_feed_results(
    db,
    redis_client: redis.Redis | None,
    *,
    adapter: LivePriceAdapter,
    acc: BrokerAccount,
    user_id: str,
    account_id: str,
    broker_code: str,
    chunk_rows: list[LiveSymbolSubscription],
    chunk_groups: list[list[LiveSymbolSubscription]],
    instruments: list[dict[str, Any]],
    connection_index: int,
) -> str | None:
    if connection_index > 1:
        _mark_subscription_health(
            [row for group in chunk_groups for row in group],
            status="capacity_wait",
            reason=adapter.capacity_wait_reason(),
        )
        return "ok"
    disabled_reason = adapter.disabled_reason(account_id)
    if disabled_reason:
        _mark_subscription_health(
            [row for group in chunk_groups for row in group],
            status="action_required",
            reason=disabled_reason,
        )
        return "fallback"
    hydrated = broker_data.hydrate_instruments(db, acc, instruments)
    feed_instruments: list[dict[str, str]] = []
    feed_rows: list[LiveSymbolSubscription] = []
    feed_groups: list[list[LiveSymbolSubscription]] = []
    for row, duplicate_rows, hydrated_row in zip(chunk_rows, chunk_groups, hydrated, strict=False):
        feed_instrument = adapter.feed_instrument(row, hydrated_row)
        if feed_instrument is None:
            for subscription_row in duplicate_rows:
                subscription_row.health_status = "pending"
                subscription_row.health_reason = "Waiting for broker live-feed identifiers from the instrument cache."
                db.add(subscription_row)
            continue
        feed_instruments.append(feed_instrument)
        feed_rows.append(row)
        feed_groups.append(duplicate_rows)
    if not feed_instruments:
        return None
    fetch_result = await adapter.fetch_payload(acc, feed_instruments)
    if fetch_result.status in {"fallback", "failed"}:
        status = "action_required" if fetch_result.status == "fallback" else "error"
        health_reason = fetch_result.reason or "Broker live feed is unavailable."
        _mark_subscription_health([row for group in feed_groups for row in group], status=status, reason=health_reason)
        if status == "action_required":
            _record_action_required_failure(db, acc, [row for group in feed_groups for row in group], health_reason)
        return fetch_result.status
    if fetch_result.status == "unsupported":
        return None
    payload = fetch_result.payload

    now = _utc_now()
    symbols = [row.symbol for row in feed_rows]
    _publish_live_session(
        redis_client,
        user_id=user_id,
        account_id=account_id,
        broker_code=broker_code,
        adapter=adapter.adapter_name,
        symbols=symbols,
        connection_index=connection_index,
        capacity=adapter.capacity,
    )
    any_feed_price = False
    for row, duplicate_rows, feed_instrument in zip(feed_rows, feed_groups, feed_instruments, strict=False):
        value = adapter.payload_value(payload, feed_instrument)
        if not value:
            for subscription_row in duplicate_rows:
                if subscription_row.health_status not in {"action_required", "rate_limited", "error"}:
                    subscription_row.health_status = "pending"
                    subscription_row.health_reason = "Subscribed to broker live feed; waiting for the first live tick."
                    db.add(subscription_row)
            continue
        ltp = value.get("ltp")
        if ltp in (None, "", 0, "0"):
            continue
        any_feed_price = True
        quote_payload = {
            "symbol": row.symbol,
            "ltp": float(ltp),
            "broker_code": broker_code,
            "account_id": account_id,
            "detail": {
                "exchange": row.exchange,
                "raw": {
                    "last_price": float(ltp),
                    "source": adapter.adapter_name,
                    "tsInMillis": value.get("tsInMillis"),
                    "exchange_token": feed_instrument["exchange_token"],
                },
            },
        }
        for subscription_row in duplicate_rows:
            subscription_row.last_quote_json = json.dumps(quote_payload, default=str)
            subscription_row.last_received_at = now
            subscription_row.health_status = "ok"
            subscription_row.health_reason = ""
            db.add(subscription_row)
        _publish_tick(
            redis_client,
            _normalize_tick_payload(
                user_id=user_id,
                account_id=account_id,
                broker_code=broker_code,
                symbols=symbols,
                connection_index=connection_index,
                chunk_rows=feed_rows,
                quote_payload=quote_payload,
                row=row,
            ),
        )
    return "ok" if any_feed_price else "fallback"


def _apply_quote_results(
    db,
    redis_client: redis.Redis | None,
    *,
    user_id: str,
    account_id: str,
    broker_code: str,
    chunk_rows: list[LiveSymbolSubscription],
    chunk_groups: list[list[LiveSymbolSubscription]],
    quotes: list[Any],
    connection_index: int,
) -> bool:
    symbols = [sub.symbol for sub in chunk_rows]
    any_valid_price = False
    any_rate_limited = False
    valid_count = 0
    unavailable_count = 0
    rate_limited_count = 0
    failed_samples: list[dict[str, Any]] = []
    for row, duplicate_rows, quote in zip(chunk_rows, chunk_groups, quotes, strict=False):
        if not quote:
            unavailable_count += 1
            failed_samples.append(
                {
                    "symbol": row.symbol,
                    "exchange": row.exchange,
                    "status": "missing_quote_payload",
                    "duplicate_rows": len(duplicate_rows),
                }
            )
            continue
        payload = quote.model_dump(mode="json")
        received_at = _utc_now()
        live_price = _quote_live_price(payload)
        if live_price is None:
            reason = _quote_error_message(payload)
            row_rate_limited = _is_rate_limit_reason(reason)
            row_access_forbidden = _is_access_forbidden_reason(reason)
            any_rate_limited = any_rate_limited or row_rate_limited
            if row_rate_limited:
                rate_limited_count += 1
            else:
                unavailable_count += 1
            failed_samples.append(
                {
                    "symbol": row.symbol,
                    "exchange": row.exchange,
                    "status": _quote_failure_status(
                        row_rate_limited=row_rate_limited,
                        row_access_forbidden=row_access_forbidden,
                    ),
                    "reason": reason[:500],
                    "duplicate_rows": len(duplicate_rows),
                }
            )
            for subscription_row in duplicate_rows:
                subscription_row.health_status = _quote_failure_status(
                    row_rate_limited=row_rate_limited,
                    row_access_forbidden=row_access_forbidden,
                )
                subscription_row.health_reason = reason
                subscription_row.updated_at = received_at
                db.add(subscription_row)
            continue
        any_valid_price = True
        valid_count += 1
        publish_payload = payload
        for index, subscription_row in enumerate(duplicate_rows):
            row_payload = _merge_existing_quote_context(payload, subscription_row.last_quote_json)
            if index == 0:
                publish_payload = row_payload
            subscription_row.last_quote_json = json.dumps(row_payload, default=str)
            subscription_row.last_received_at = received_at
            subscription_row.health_status = "ok"
            subscription_row.health_reason = ""
            db.add(subscription_row)
        _publish_tick(redis_client, _normalize_tick_payload(
            user_id=user_id,
            account_id=account_id,
            broker_code=broker_code,
            symbols=symbols,
            connection_index=connection_index,
            chunk_rows=chunk_rows,
            quote_payload=publish_payload,
            row=row,
        ))
    if rate_limited_count:
        logger.warning(
            "quote batch rate limited user=%s account=%s broker=%s connection=%s valid=%s rate_limited=%s unavailable=%s symbols=%s sample=%s",
            user_id,
            account_id,
            broker_code,
            connection_index,
            valid_count,
            rate_limited_count,
            unavailable_count,
            len(chunk_rows),
            _quote_debug_sample(failed_samples),
        )
    elif unavailable_count:
        logger.debug(
            "quote batch had unavailable rows user=%s account=%s broker=%s connection=%s valid=%s unavailable=%s symbols=%s sample=%s",
            user_id,
            account_id,
            broker_code,
            connection_index,
            valid_count,
            unavailable_count,
            len(chunk_rows),
            _quote_debug_sample(failed_samples),
        )
    else:
        logger.debug(
            "quote batch applied user=%s account=%s broker=%s connection=%s valid=%s symbols=%s",
            user_id,
            account_id,
            broker_code,
            connection_index,
            valid_count,
            len(chunk_rows),
        )
    return any_valid_price or not any_rate_limited


def _retry_not_before(account_id: str) -> datetime | None:
    return _ACCOUNT_RETRY_NOT_BEFORE.get(account_id)


def _should_skip_account_until_retry(account_id: str) -> bool:
    retry_at = _retry_not_before(account_id)
    return bool(retry_at and retry_at > _utc_now())


def _schedule_account_retry(account_id: str, delay_seconds: int) -> None:
    retry_at = _utc_now() + timedelta(seconds=delay_seconds)
    _ACCOUNT_RETRY_NOT_BEFORE[account_id] = retry_at
    logger.debug("scheduled live quote retry account=%s retry_at=%s delay_seconds=%s", account_id, retry_at.isoformat(), delay_seconds)


def _clear_account_retry(account_id: str) -> None:
    _ACCOUNT_RETRY_NOT_BEFORE.pop(account_id, None)


def _is_action_required_broker_error(message: str) -> bool:
    normalized = message.lower()
    markers = (
        "token is expired",
        "token is missing",
        "access token is expired",
        "access token is missing",
        "session token is expired",
        "session token is missing",
        "session bundle is missing",
        "session is expired",
        "log in again",
        "login required",
        "complete the",
        "refresh the session",
        "refresh it manually",
        "broker portal token",
    )
    return any(marker in normalized for marker in markers)


def _mark_subscription_health(
    rows: list[LiveSymbolSubscription],
    *,
    status: str,
    reason: str,
) -> None:
    for row in rows:
        row.health_status = status
        row.health_reason = reason[:2000]


def _broker_notification_title(acc: BrokerAccount) -> str:
    return f"{acc.label}: broker session action required"


def _record_action_required_failure(
    db,
    acc: BrokerAccount,
    subscriptions: list[LiveSymbolSubscription],
    message: str,
) -> None:
    acc.session_status = "action_required"
    acc.last_error = message[:2000]
    db.add(acc)
    _mark_subscription_health(subscriptions, status="action_required", reason=message)
    _create_notification_once_per_day(
        db,
        user_id=acc.user_id,
        account_id=acc.id,
        broker_code=acc.broker_code,
        kind="session_action_required",
        title=_broker_notification_title(acc),
        message=message,
        level="warning",
    )


def _record_transient_failure(
    subscriptions: list[LiveSymbolSubscription],
    message: str,
) -> None:
    _mark_subscription_health(subscriptions, status="error", reason=message)


def _session_active(acc: BrokerAccount) -> bool:
    try:
        return get_broker_session_status(acc).session_active
    except Exception:
        return False


def _try_refresh_action_required_session(db, acc: BrokerAccount) -> bool:
    try:
        process_account_maintenance(db, acc)
        db.refresh(acc)
    except Exception as exc:
        logger.info("broker session refresh attempt failed for %s: %s", acc.id, exc)
        return False
    return _session_active(acc)


def _record_market_data_success(db, acc: BrokerAccount) -> None:
    if acc.last_error or acc.session_status in {"pending", "action_required", "automation_ready"}:
        mark_session_healthy(db, acc, verified_at=acc.last_verified_at)
    else:
        acc.last_error = None
    db.add(acc)


async def run_live_market_data_worker(stop_event: asyncio.Event, poll_interval_seconds: float = 2.0) -> None:
    redis_client = _redis()
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            cleanup_expired_ui_subscriptions(db, commit=False)
            rows = db.scalars(
                select(LiveSymbolSubscription).where(LiveSymbolSubscription.status == "active")
            ).all()
            grouped: dict[tuple[str, str, str], list[LiveSymbolSubscription]] = {}
            for row in rows:
                if not row.account_id or not row.broker_code:
                    continue
                grouped.setdefault((row.user_id, row.account_id, row.broker_code), []).append(row)
            for (user_id, account_id, _broker_code), subscriptions in grouped.items():
                if _should_skip_account_until_retry(account_id):
                    continue
                acc = db.get(BrokerAccount, account_id)
                if not acc:
                    continue
                unique_subscriptions: dict[tuple[str, str | None], list[LiveSymbolSubscription]] = {}
                for subscription in subscriptions:
                    unique_key = (
                        subscription.symbol,
                        subscription.exchange,
                    )
                    unique_subscriptions.setdefault(unique_key, []).append(subscription)
                unique_subscriptions = {
                    key: _order_duplicate_group(duplicate_rows)
                    for key, duplicate_rows in unique_subscriptions.items()
                }
                ordered_subscription_groups = sorted(
                    unique_subscriptions.values(),
                    key=lambda items: _subscription_priority(items[0]),
                )
                account_failed = False
                for chunk_index, start in enumerate(range(0, len(ordered_subscription_groups), 1000), start=1):
                    used_feed_fallback = False
                    chunk_groups = ordered_subscription_groups[start : start + 1000]
                    chunk_rows = [items[0] for items in chunk_groups]
                    instruments = [_instrument_for_group(items) for items in chunk_groups]
                    live_adapter = get_live_price_adapter(acc.broker_code)
                    if live_adapter:
                        feed_result = await _apply_live_feed_results(
                            db,
                            redis_client,
                            adapter=live_adapter,
                            acc=acc,
                            user_id=user_id,
                            account_id=account_id,
                            broker_code=acc.broker_code,
                            chunk_rows=chunk_rows,
                            chunk_groups=chunk_groups,
                            instruments=instruments,
                            connection_index=chunk_index,
                        )
                        if feed_result == "ok":
                            _clear_account_retry(account_id)
                            _record_market_data_success(db, acc)
                            continue
                        if feed_result == "fallback":
                            used_feed_fallback = True
                            if not live_adapter.rest_fallback_allowed(account_id):
                                continue
                            live_adapter.schedule_rest_fallback(account_id)
                            if len(chunk_rows) > live_adapter.fallback_symbol_limit:
                                deferred_rows = [
                                    subscription_row
                                    for duplicate_rows in chunk_groups[live_adapter.fallback_symbol_limit:]
                                    for subscription_row in duplicate_rows
                                ]
                                _mark_subscription_health(
                                    deferred_rows,
                                    status="action_required",
                                    reason=(
                                        "Broker live feed access is unavailable, so REST fallback is throttled to "
                                        f"{live_adapter.fallback_symbol_limit} higher-priority symbols per pass to avoid broker rate limits."
                                    ),
                                )
                            chunk_groups = chunk_groups[:live_adapter.fallback_symbol_limit]
                            chunk_rows = [items[0] for items in chunk_groups]
                            instruments = instruments[:live_adapter.fallback_symbol_limit]
                        if feed_result == "failed":
                            _schedule_account_retry(account_id, TRANSIENT_RETRY_SECONDS)
                            account_failed = True
                            break
                    try:
                        quotes = await asyncio.to_thread(broker_data.fetch_quotes, db, acc, instruments)
                    except Exception as exc:
                        message = str(exc)
                        if _is_action_required_broker_error(message):
                            if _try_refresh_action_required_session(db, acc):
                                try:
                                    quotes = await asyncio.to_thread(
                                        broker_data.fetch_quotes,
                                        db,
                                        acc,
                                        instruments,
                                    )
                                except Exception as retry_exc:
                                    message = str(retry_exc)
                                else:
                                    _clear_account_retry(account_id)
                                    if not used_feed_fallback:
                                        _record_market_data_success(db, acc)
                                    ok = _apply_quote_results(
                                        db,
                                        redis_client,
                                        user_id=user_id,
                                        account_id=account_id,
                                        broker_code=acc.broker_code,
                                        chunk_rows=chunk_rows,
                                        chunk_groups=chunk_groups,
                                        quotes=quotes,
                                        connection_index=chunk_index,
                                    )
                                    if not ok:
                                        _schedule_account_retry(account_id, TRANSIENT_RETRY_SECONDS)
                                    continue
                            _record_action_required_failure(db, acc, subscriptions, message)
                            _schedule_account_retry(account_id, ACTION_REQUIRED_RETRY_SECONDS)
                            logger.info("live market data paused for %s: %s", account_id, message)
                        else:
                            _record_transient_failure(subscriptions, message)
                            _schedule_account_retry(account_id, TRANSIENT_RETRY_SECONDS)
                            logger.warning("quote poll failed for %s: %s", account_id, exc)
                        account_failed = True
                        break
                    _clear_account_retry(account_id)
                    if not used_feed_fallback:
                        _record_market_data_success(db, acc)
                    ok = _apply_quote_results(
                        db,
                        redis_client,
                        user_id=user_id,
                        account_id=account_id,
                        broker_code=acc.broker_code,
                        chunk_rows=chunk_rows,
                        chunk_groups=chunk_groups,
                        quotes=quotes,
                        connection_index=chunk_index,
                    )
                    if not ok:
                        _schedule_account_retry(account_id, TRANSIENT_RETRY_SECONDS)
                        logger.warning("quote poll returned only unavailable/rate-limited rows for %s", account_id)
                        account_failed = True
                        break
                if account_failed:
                    continue
            db.commit()
        except Exception as exc:
            logger.warning("live market data loop failed: %s", exc)
            db.rollback()
        finally:
            db.close()
        if not await _wait_for_stop(stop_event, poll_interval_seconds):
            continue


def backfill_live_prices_for_user(user_id: str, *, source_kind: str | None = None, limit: int = 250) -> int:
    redis_client = _redis()
    db = SessionLocal()
    published = 0
    try:
        stmt = select(LiveSymbolSubscription).where(
            LiveSymbolSubscription.user_id == user_id,
            LiveSymbolSubscription.status == "active",
            LiveSymbolSubscription.account_id.is_not(None),
            LiveSymbolSubscription.broker_code.is_not(None),
        )
        if source_kind:
            stmt = stmt.where(LiveSymbolSubscription.source_kind == source_kind)
        rows = db.scalars(stmt.order_by(LiveSymbolSubscription.updated_at.desc()).limit(limit)).all()
        grouped: dict[tuple[str, str, str], list[LiveSymbolSubscription]] = {}
        for row in rows:
            if row.account_id and row.broker_code:
                grouped.setdefault((row.user_id, row.account_id, row.broker_code), []).append(row)
        for grouped_user_id, account_id, _broker_code in grouped:
            if _should_skip_account_until_retry(account_id):
                continue
            acc = db.get(BrokerAccount, account_id)
            if not acc:
                continue
            subscriptions = grouped[(grouped_user_id, account_id, _broker_code)]
            unique_subscriptions: dict[tuple[str, str | None], list[LiveSymbolSubscription]] = {}
            for subscription in subscriptions:
                unique_subscriptions.setdefault((subscription.symbol, subscription.exchange), []).append(subscription)
            unique_subscriptions = {
                key: _order_duplicate_group(duplicate_rows)
                for key, duplicate_rows in unique_subscriptions.items()
            }
            ordered_groups = sorted(unique_subscriptions.values(), key=lambda items: _subscription_priority(items[0]))
            chunk_groups = ordered_groups[:1000]
            chunk_rows = [items[0] for items in chunk_groups]
            instruments = [_instrument_for_group(items) for items in chunk_groups]
            try:
                quotes = broker_data.fetch_quotes(db, acc, instruments)
            except Exception as exc:
                message = str(exc)
                _record_transient_failure(subscriptions, message)
                _schedule_account_retry(account_id, TRANSIENT_RETRY_SECONDS)
                continue
            _clear_account_retry(account_id)
            ok = _apply_quote_results(
                db,
                redis_client,
                user_id=grouped_user_id,
                account_id=account_id,
                broker_code=acc.broker_code,
                chunk_rows=chunk_rows,
                chunk_groups=chunk_groups,
                quotes=quotes,
                connection_index=1,
            )
            published += len(quotes)
            if not ok:
                _schedule_account_retry(account_id, TRANSIENT_RETRY_SECONDS)
        db.commit()
        return published
    except Exception as exc:
        logger.warning("live price backfill failed for %s: %s", user_id, exc)
        db.rollback()
        return published
    finally:
        db.close()


def _initial_stream_offset(redis_client: redis.Redis, stream_name: str) -> str:
    try:
        latest = redis_client.xrevrange(stream_name, count=1)
    except redis.RedisError:
        return "0-0"
    if not latest:
        return "0-0"
    message_id = latest[0][0]
    return message_id.decode() if isinstance(message_id, bytes) else str(message_id)


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


def _first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _tick_ohlc_fields(tick: dict[str, Any]) -> dict[str, Any]:
    raw = tick.get("raw")
    if isinstance(raw, dict):
        detail = raw.get("detail")
        if isinstance(detail, dict) and isinstance(detail.get("raw"), dict):
            raw = detail["raw"]
    raw_ohlc = raw.get("ohlc") if isinstance(raw, dict) and isinstance(raw.get("ohlc"), dict) else {}
    return {
        "open": _first_present(tick.get("open"), raw_ohlc.get("open"), raw_ohlc.get("open_price")),
        "high": _first_present(tick.get("high"), raw_ohlc.get("high"), raw_ohlc.get("high_price")),
        "low": _first_present(tick.get("low"), raw_ohlc.get("low"), raw_ohlc.get("low_price")),
        "close": _first_present(tick.get("close"), raw_ohlc.get("close"), raw_ohlc.get("close_price")),
    }


def _enrich_tick_for_match(db, workflow: AlertWorkflow, tick: dict[str, Any]) -> dict[str, Any]:
    existing_ohlc = _tick_ohlc_fields(tick)
    tick = {
        **tick,
        **{key: value for key, value in existing_ohlc.items() if value not in (None, "")},
    }
    if not workflow.account_id:
        return tick
    account = db.get(BrokerAccount, workflow.account_id)
    if not account:
        return tick
    workflow_out = alert_svc._workflow_to_out(workflow)  # type: ignore[attr-defined]
    matched_target = alert_svc.workflow_target_entry_for_tick(workflow_out, tick)
    tick_symbol = str(tick.get("symbol") or "").strip().upper()
    if matched_target and matched_target.symbol != tick_symbol:
        matched_target = None
    instrument_ref = (
        matched_target.instrument_ref.model_dump(exclude_none=True)
        if matched_target
        else {}
    )
    instrument = {
        "symbol": (matched_target.symbol if matched_target else None) or tick.get("symbol") or workflow.symbol,
        "exchange": (matched_target.exchange if matched_target else None) or tick.get("exchange") or workflow.exchange,
        **instrument_ref,
    }
    try:
        ohlc_rows = broker_data.fetch_ohlc(db, account, [instrument])
    except Exception as exc:
        logger.debug("ohlc enrichment failed for workflow %s: %s", workflow.id, exc)
        return tick
    if not ohlc_rows:
        return tick
    first_row = ohlc_rows[0]
    ohlc = first_row.model_dump(mode="json") if hasattr(first_row, "model_dump") else dict(first_row)
    return {
        **tick,
        "open": _first_present(ohlc.get("open"), tick.get("open")),
        "high": _first_present(ohlc.get("high"), tick.get("high")),
        "low": _first_present(ohlc.get("low"), tick.get("low")),
        "close": _first_present(ohlc.get("close"), tick.get("close")),
        "ohlc": ohlc,
    }


def _market_data_market_cap_passes(
    db,
    workflow,
    tick: dict[str, Any],
    *,
    cache: dict[str, tuple[float | None, str, str | None]] | None = None,
) -> tuple[bool, dict[str, Any]]:
    config = workflow.workflow_dsl.market_cap_filter
    if not market_cap_filter_enabled(config):
        return True, {"skipped": True, "reason": "all market caps allowed"}
    symbol = str(tick.get("symbol") or workflow.symbol or "").strip().upper()
    market_cap, source, error = load_symbol_market_cap(
        db,
        workflow.user_id,
        symbol,
        tick_market_cap=tick.get("market_cap"),
        cache=cache,
    )
    matched = market_cap_in_range(market_cap, config)
    return matched, {
        "symbol": symbol,
        "market_cap": market_cap,
        "source": source,
        "error": error,
        "min_value": config.min_value,
        "max_value": config.max_value,
        "matched": matched,
    }


def _alpha_feed_market_cap_passes(
    db,
    workflow,
    event_symbols: set[str],
    *,
    cache: dict[str, tuple[float | None, str, str | None]],
) -> tuple[bool, dict[str, Any]]:
    config = workflow.workflow_dsl.market_cap_filter
    if not market_cap_filter_enabled(config):
        return True, {"skipped": True, "reason": "all market caps allowed"}
    normalized_symbols = sorted({str(item or "").strip().upper() for item in event_symbols if str(item or "").strip()})
    if not normalized_symbols:
        return False, {
            "matched": False,
            "symbols": [],
            "reason": "No event symbol was available for market cap filtering.",
            "min_value": config.min_value,
            "max_value": config.max_value,
        }
    checks: list[dict[str, Any]] = []
    for symbol in normalized_symbols:
        market_cap, source, error = load_symbol_market_cap(db, workflow.user_id, symbol, cache=cache)
        matched = market_cap_in_range(market_cap, config)
        checks.append(
            {
                "symbol": symbol,
                "market_cap": market_cap,
                "source": source,
                "error": error,
                "matched": matched,
            }
        )
        if matched:
            return True, {
                "matched": True,
                "symbols": checks,
                "min_value": config.min_value,
                "max_value": config.max_value,
            }
    return False, {
        "matched": False,
        "symbols": checks,
        "min_value": config.min_value,
        "max_value": config.max_value,
    }


def _process_tick_event(db, redis_client: redis.Redis | None, tick: dict[str, Any]) -> None:
    if not tick.get("user_id") or not tick.get("account_id") or not tick.get("broker_code") or not tick.get("symbol"):
        return
    sub_stmt = select(LiveSymbolSubscription.workflow_id).where(
        LiveSymbolSubscription.user_id == tick["user_id"],
        LiveSymbolSubscription.account_id == tick["account_id"],
        LiveSymbolSubscription.broker_code == tick["broker_code"],
        LiveSymbolSubscription.symbol == tick["symbol"],
        LiveSymbolSubscription.status == "active",
        LiveSymbolSubscription.workflow_id.is_not(None),
    )
    exchange = tick.get("exchange")
    if exchange:
        sub_stmt = sub_stmt.where((LiveSymbolSubscription.exchange == exchange) | (LiveSymbolSubscription.exchange.is_(None)))
    workflow_ids = [item for item in db.scalars(sub_stmt).all() if item]
    if not workflow_ids:
        return
    stmt = select(AlertWorkflow).where(
        AlertWorkflow.user_id == tick["user_id"],
        AlertWorkflow.account_id == tick["account_id"],
        AlertWorkflow.broker_code == tick["broker_code"],
        AlertWorkflow.status == "active",
        AlertWorkflow.id.in_(workflow_ids),
    )
    workflows = db.scalars(stmt).all()
    workflow_asts: dict[str, Any] = {}
    rolling_fields: set[str] = set()
    retention_seconds = 0
    for row in workflows:
        try:
            workflow = alert_svc._workflow_to_out(row)  # type: ignore[attr-defined]
            ast = ensure_workflow_ast(workflow.workflow_dsl)
            workflow_asts[row.id] = ast
            rolling_fields.update(collect_rolling_fields(ast.logic))
            retention_seconds = max(retention_seconds, max_rolling_window_seconds(ast.logic))
        except Exception as exc:
            logger.debug("rolling state planning skipped for workflow %s: %s", row.id, exc)
    if rolling_fields:
        try:
            record_tick_samples(
                redis_client,
                tick,
                fields=rolling_fields,
                retention_seconds=max(retention_seconds, 60),
            )
        except redis.RedisError as exc:
            logger.warning("rolling tick sample cache failed for %s: %s", tick.get("symbol"), exc)
    market_cap_cache: dict[str, tuple[float | None, str, str | None]] = {}
    for row in workflows:
        try:
            workflow = alert_svc._workflow_to_out(row)  # type: ignore[attr-defined]
            active, active_period_details = _workflow_active_for_tick(db, workflow, tick)
            if not active:
                continue
            previous_tick = _previous_tick_for_workflow(db, redis_client, workflow.id)
            ast = workflow_asts.get(row.id) or ensure_workflow_ast(workflow.workflow_dsl)
            runtime_context = build_runtime_context(redis_client, tick, ast.logic, workflow_id=workflow.id)
            evaluation = alert_svc.evaluate_workflow_payload_detail(
                workflow,
                {**tick, "workflow_id": workflow.id},
                previous_tick,
                runtime_context=runtime_context,
            )
            matched, reason = evaluation.matched, evaluation.reason
            evaluation_tick = tick
            notification_id = None
            should_record_run = False
            llm_analysis: dict[str, Any] = {"enabled": False, "status": "disabled", "output": ""}
            market_cap_details: dict[str, Any] = {"skipped": True, "reason": "condition did not match"}
            if matched:
                market_cap_match, market_cap_details = _market_data_market_cap_passes(
                    db,
                    workflow,
                    tick,
                    cache=market_cap_cache,
                )
                if not market_cap_match:
                    _store_previous_tick_for_workflow(redis_client, workflow.id, tick)
                    continue
                cooldown = workflow.workflow_dsl.cooldown_seconds
                can_trigger = True
                if row.last_triggered_at:
                    can_trigger = (_utc_now() - row.last_triggered_at).total_seconds() >= cooldown
                if can_trigger:
                    evaluation_tick = _enrich_tick_for_match(db, row, tick)
                    llm_analysis = run_workflow_llm_analysis(
                        db,
                        workflow=workflow,
                        tick=evaluation_tick,
                        previous_tick=previous_tick,
                        reason=reason,
                        evaluation_details=evaluation.details,
                    )
                    render_context = alert_svc._notification_context(  # type: ignore[attr-defined]
                        workflow,
                        evaluation_tick,
                        previous_tick,
                        llm_analysis,
                        reason=reason,
                        evaluation_details=evaluation.details,
                    )
                    title = alert_svc._render_message(  # type: ignore[attr-defined]
                        workflow.workflow_dsl.notification.title_template,
                        render_context,
                    )
                    message = alert_svc._render_message(  # type: ignore[attr-defined]
                        workflow.workflow_dsl.notification.message_template,
                        render_context,
                    )
                    if llm_analysis.get("output") and "{llm_analysis}" not in workflow.workflow_dsl.notification.message_template:
                        message = f"{message}\n\nLLM Analysis: {llm_analysis['output']}"
                    notification = alert_svc.create_alert_notification(
                        db,
                        user_id=workflow.user_id,
                        workflow=workflow,
                        title=title,
                        message=message,
                        level=workflow.workflow_dsl.notification.level,
                        channels=_workflow_channels(db, workflow.user_id, workflow),
                        payload={**evaluation_tick, "llm_analysis": llm_analysis},
                        dedupe_key=f"{workflow.id}:{str(render_context.get('symbol') or '')}:{reason}",
                    )
                    notification_id = notification.id
                    row.last_triggered_at = _utc_now()
                    db.add(row)
                    should_record_run = True
                else:
                    reason = f"{reason}; cooldown active"
                    should_record_run = False
            if should_record_run:
                render_context = alert_svc._notification_context(  # type: ignore[attr-defined]
                    workflow,
                    evaluation_tick,
                    previous_tick,
                    llm_analysis,
                    reason=reason,
                    evaluation_details=evaluation.details,
                )
                title = alert_svc._render_message(  # type: ignore[attr-defined]
                    workflow.workflow_dsl.notification.title_template,
                    render_context,
                )
                message = alert_svc._render_message(  # type: ignore[attr-defined]
                    workflow.workflow_dsl.notification.message_template,
                    render_context,
                )
                if llm_analysis.get("output") and "{llm_analysis}" not in workflow.workflow_dsl.notification.message_template:
                    message = f"{message}\n\nLLM Analysis: {llm_analysis['output']}"
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
                        evaluation_payload_json=json.dumps(
                            {
                                "previous_tick": previous_tick,
                                "event_driven": True,
                                "active_period": active_period_details,
                                "market_cap_filter": market_cap_details,
                                "evaluation_details": evaluation.details,
                                "llm_analysis": llm_analysis,
                            },
                            default=str,
                        ),
                    )
                )
            _store_previous_tick_for_workflow(redis_client, workflow.id, tick)
        except Exception as exc:
            logger.warning("workflow evaluation failed for %s: %s", row.id, exc)
    db.commit()


def _collect_event_symbols(value: Any, symbols: set[str]) -> None:
    if isinstance(value, dict):
        for key in ("symbol", "symbols", "nse"):
            raw = value.get(key)
            if isinstance(raw, str):
                for part in raw.replace(",", ":").split(":"):
                    symbol = part.strip().upper()
                    if symbol:
                        symbols.add(symbol)
            elif isinstance(raw, list):
                for item in raw:
                    _collect_event_symbols(item, symbols)
        for key in ("payload", "data"):
            if key in value:
                _collect_event_symbols(value[key], symbols)
    elif isinstance(value, list):
        for item in value:
            _collect_event_symbols(item, symbols)


def _normalize_category_label(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _collect_event_categories(value: Any, categories: set[str], related_categories: set[str]) -> None:
    if isinstance(value, dict):
        category = _normalize_category_label(value.get("category"))
        if category:
            categories.add(category)
        raw_related = value.get("related_categories")
        if isinstance(raw_related, list):
            for item in raw_related:
                normalized = _normalize_category_label(item)
                if normalized:
                    related_categories.add(normalized)
        elif isinstance(raw_related, str):
            for part in raw_related.split(","):
                normalized = _normalize_category_label(part)
                if normalized:
                    related_categories.add(normalized)
        if "metadata" in value:
            _collect_event_categories(value.get("metadata"), categories, related_categories)
        for key in ("payload", "data"):
            if key in value:
                _collect_event_categories(value[key], categories, related_categories)
    elif isinstance(value, list):
        for item in value:
            _collect_event_categories(item, categories, related_categories)


def _normalized_category_set(values: list[str]) -> set[str]:
    return {
        value.strip().casefold()
        for value in values
        if isinstance(value, str) and value.strip()
    }


def _event_matches_category_filter(event: AlphaWebSocketEvent, trigger, payload: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    if event.product != "announcements":
        return True, {"selected_categories": [], "matched_categories": [], "related_categories_considered": False}
    selected = _normalized_category_set(trigger.announcement_categories)
    if not selected:
        return True, {"selected_categories": [], "matched_categories": [], "related_categories_considered": False}

    primary_categories: set[str] = set()
    related_categories: set[str] = set()
    _collect_event_categories(payload, primary_categories, related_categories)

    matched_primary = {item for item in primary_categories if item.casefold() in selected}
    matched_related = {item for item in related_categories if item.casefold() in selected}
    matched = set(matched_primary)
    if trigger.include_related_categories:
        matched.update(matched_related)

    details = {
        "selected_categories": sorted(selected),
        "event_categories": sorted(primary_categories),
        "event_related_categories": sorted(related_categories),
        "matched_categories": sorted(matched),
        "related_categories_considered": bool(trigger.include_related_categories),
    }
    if matched:
        return True, details
    if event.product in {"announcements", "earnings"} or primary_categories or related_categories:
        return False, details
    return True, {**details, "skipped_reason": "event carried no category metadata"}


def _workflow_symbol_filter(db, workflow, trigger) -> set[str] | None:
    if trigger.source_scope == "full_market":
        return None
    if trigger.source_scope == "current_alpha_subscription":
        rows = db.scalars(
            select(LiveSymbolSubscription.symbol).where(
                LiveSymbolSubscription.user_id == workflow.user_id,
                LiveSymbolSubscription.status == "active",
            )
        ).all()
        return {str(item).strip().upper() for item in rows if str(item).strip()}
    if trigger.source_scope == "watchlists":
        stmt = (
            select(UserWatchlistSymbol.symbol)
            .join(UserWatchlist, UserWatchlist.id == UserWatchlistSymbol.watchlist_id)
            .where(UserWatchlist.user_id == workflow.user_id)
        )
        if not trigger.include_all_watchlists:
            if not trigger.watchlist_ids:
                return set()
            stmt = stmt.where(UserWatchlist.id.in_(trigger.watchlist_ids))
        rows = db.scalars(stmt).all()
        return {str(item).strip().upper() for item in rows if str(item).strip()}
    symbols: set[str] = set()
    for preset_id in trigger.preset_ids:
        for item in resolve_universe(db, workflow.user_id, AlertUniverseNode(kind="curated_preset", preset_id=preset_id)):
            symbol = str(getattr(item, "symbol", "")).strip().upper()
            if symbol:
                symbols.add(symbol)
    return symbols


def _deterministic_feed_trigger_result(
    event: AlphaWebSocketEvent,
    category_details: dict[str, Any],
) -> dict[str, Any]:
    matched_categories = category_details.get("matched_categories") or []
    if matched_categories:
        reason = f"Feed item matched category filter: {', '.join(str(item) for item in matched_categories)}"
    else:
        reason = f"Feed item matched configured {event.product} scope"
    return {
        "matches": True,
        "status": "matched_without_llm",
        "reason": reason,
        "confidence": None,
        "matched_terms": list(matched_categories),
        "batch": {"alpha_event_id": event.id, "event_key": event.event_key, "llm_used": False},
    }


def _process_alpha_feed_event(db, event: AlphaWebSocketEvent) -> None:
    payload = json.loads(event.payload_json or "{}")
    event_symbols: set[str] = set()
    _collect_event_symbols(payload, event_symbols)
    if event.symbol:
        event_symbols.add(str(event.symbol).strip().upper())
    rows = db.scalars(
        select(AlertWorkflow).where(
            AlertWorkflow.user_id == event.user_id,
            AlertWorkflow.status == "active",
        )
    ).all()
    eligible: list[dict[str, Any]] = []
    cases = []
    market_cap_cache: dict[str, tuple[float | None, str, str | None]] = {}
    for row in rows:
        workflow = alert_svc._workflow_to_out(row)  # type: ignore[attr-defined]
        if workflow.workflow_dsl.workflow_type != "alpha_feed":
            continue
        trigger = workflow.workflow_dsl.feed_trigger
        if not trigger.enabled or event.product not in trigger.products:
            continue
        active, _active_period_details = _workflow_active_for_feed(workflow)
        if not active:
            continue
        market_cap_match, market_cap_details = _alpha_feed_market_cap_passes(
            db,
            workflow,
            event_symbols,
            cache=market_cap_cache,
        )
        if not market_cap_match:
            continue
        category_match, category_details = _event_matches_category_filter(event, trigger, payload)
        if not category_match:
            continue
        allowed_symbols = _workflow_symbol_filter(db, workflow, trigger)
        if allowed_symbols is not None and event_symbols and not event_symbols.intersection(allowed_symbols):
            continue
        if allowed_symbols is not None and not event_symbols and trigger.source_scope != "current_alpha_subscription":
            continue
        cooldown = workflow.workflow_dsl.cooldown_seconds
        if row.last_triggered_at and (_utc_now() - row.last_triggered_at).total_seconds() < cooldown:
            continue
        trigger_uses_llm = bool(trigger.condition_prompt.strip() or trigger.provider or trigger.model_id)
        if not trigger_uses_llm:
            tick = {
                **payload,
                "symbol": event.symbol or next(iter(event_symbols), ""),
                "alpha_product": event.product,
                "alpha_event_id": event.id,
                "received_at": event.received_at.isoformat() if event.received_at else None,
                "alpha_category_filter": category_details,
                "market_cap_filter": market_cap_details,
            }
            trigger_result = _deterministic_feed_trigger_result(event, category_details)
            eligible.append(
                {
                    "row": row,
                    "workflow": workflow,
                    "category_details": category_details,
                    "market_cap_details": market_cap_details,
                    "case": None,
                    "trigger_result": trigger_result,
                    "reason": str(trigger_result.get("reason") or "Feed item matched configured filters"),
                    "tick": tick,
                }
            )
            continue
        case_index = len(cases)
        try:
            case = feed_case_from_workflow(
                workflow,
                batch_index=case_index,
                metadata={"category_filter": category_details, "market_cap_filter": market_cap_details},
            )
        except Exception as exc:
            db.add(
                AlertWorkflowRun(
                    id=str(uuid4()),
                    workflow_id=workflow.id,
                    notification_id=None,
                    matched=False,
                    reason=f"Feed trigger configuration failed: {exc}",
                    rendered_title="",
                    rendered_message="",
                    channels_json=json.dumps([]),
                    tick_json=json.dumps(payload, default=str),
                    evaluation_payload_json=json.dumps(
                        {"alpha_event_id": event.id, "event_key": event.event_key, "error": str(exc)},
                        default=str,
                    ),
                )
            )
            continue
        cases.append(case)
        eligible.append(
            {
                "row": row,
                "workflow": workflow,
                "category_details": category_details,
                "market_cap_details": market_cap_details,
                "case": case,
            }
        )

    trigger_results = run_feed_trigger_batches(
        db,
        user_id=event.user_id,
        event_id=event.id,
        event_key=event.event_key,
        product=event.product,
        payload=payload,
        cases=cases,
    )
    matched_items: list[dict[str, Any]] = []
    for item in eligible:
        row = item["row"]
        workflow = item["workflow"]
        category_details = item["category_details"]
        market_cap_details = item.get("market_cap_details") or {}
        if item.get("case") is None:
            matched_items.append(item)
            continue
        trigger_result = trigger_results.get(workflow.id) or {
            "matches": False,
            "status": "error",
            "error": "Feed trigger batch did not return this workflow",
            "batch": {"alpha_event_id": event.id, "event_key": event.event_key},
        }
        if trigger_result.get("status") == "error":
            error = str(trigger_result.get("error") or "Feed trigger LLM failed")
            db.add(
                AlertWorkflowRun(
                    id=str(uuid4()),
                    workflow_id=workflow.id,
                    notification_id=None,
                    matched=False,
                    reason=f"Feed trigger LLM failed: {error}",
                    rendered_title="",
                    rendered_message="",
                    channels_json=json.dumps([]),
                    tick_json=json.dumps(payload, default=str),
                    evaluation_payload_json=json.dumps(
                        {
                            "alpha_event_id": event.id,
                            "event_key": event.event_key,
                            "feed_trigger": trigger_result,
                            "category_filter": category_details,
                            "market_cap_filter": market_cap_details,
                            "batch": trigger_result.get("batch") or {},
                            "error": error,
                        },
                        default=str,
                    ),
                )
            )
            continue
        if not trigger_result.get("matches"):
            continue
        reason = str(trigger_result.get("reason") or "Feed trigger matched")
        tick = {
            **payload,
            "symbol": event.symbol or next(iter(event_symbols), ""),
            "alpha_product": event.product,
            "alpha_event_id": event.id,
            "received_at": event.received_at.isoformat() if event.received_at else None,
            "alpha_category_filter": category_details,
            "market_cap_filter": market_cap_details,
        }
        matched_items.append(
            {
                "row": row,
                "workflow": workflow,
                "category_details": category_details,
                "market_cap_details": market_cap_details,
                "trigger_result": trigger_result,
                "reason": reason,
                "tick": tick,
            }
        )

    analysis_results = run_followup_analysis_batches(
        db,
        user_id=event.user_id,
        event_id=event.id,
        event_key=event.event_key,
        product=event.product,
        requests=[
            FeedAnalysisRequest(
                workflow=item["workflow"],
                tick=item["tick"],
                reason=item["reason"],
                evaluation_details={
                    "feed_trigger": item["trigger_result"],
                    "category_filter": item["category_details"],
                    "market_cap_filter": item.get("market_cap_details") or {},
                },
            )
            for item in matched_items
        ],
    )
    for item in matched_items:
        row = item["row"]
        workflow = item["workflow"]
        category_details = item["category_details"]
        market_cap_details = item.get("market_cap_details") or {}
        trigger_result = item["trigger_result"]
        reason = item["reason"]
        tick = item["tick"]
        llm_analysis = analysis_results.get(workflow.id) or run_workflow_llm_analysis(
            db,
            workflow=workflow,
            tick=tick,
            previous_tick={},
            reason=reason,
            evaluation_details={
                "feed_trigger": trigger_result,
                "category_filter": category_details,
                "market_cap_filter": market_cap_details,
            },
            request_kind="workflow_followup_analysis",
        )
        render_context = alert_svc._notification_context(workflow, tick, None, llm_analysis)  # type: ignore[attr-defined]
        render_context["alpha_product"] = event.product
        render_context["feed_trigger_reason"] = reason
        title = alert_svc._render_message(workflow.workflow_dsl.notification.title_template, render_context)  # type: ignore[attr-defined]
        message = alert_svc._render_message(workflow.workflow_dsl.notification.message_template, render_context)  # type: ignore[attr-defined]
        if llm_analysis.get("output") and "{llm_analysis}" not in workflow.workflow_dsl.notification.message_template:
            message = f"{message}\n\nLLM Analysis: {llm_analysis['output']}"
        notification = alert_svc.create_alert_notification(
            db,
            user_id=workflow.user_id,
            workflow=workflow,
            title=title,
            message=message,
            level=workflow.workflow_dsl.notification.level,
            channels=_workflow_channels(db, workflow.user_id, workflow),
            payload={**tick, "feed_trigger": trigger_result, "llm_analysis": llm_analysis},
            dedupe_key=f"{workflow.id}:{event.event_key}",
        )
        row.last_triggered_at = _utc_now()
        db.add(row)
        db.add(
            AlertWorkflowRun(
                id=str(uuid4()),
                workflow_id=workflow.id,
                notification_id=notification.id,
                matched=True,
                reason=reason,
                rendered_title=title,
                rendered_message=message,
                channels_json=json.dumps(_workflow_channels(db, workflow.user_id, workflow)),
                tick_json=json.dumps(tick, default=str),
                evaluation_payload_json=json.dumps(
                    {
                        "alpha_event_id": event.id,
                        "event_key": event.event_key,
                        "feed_trigger": trigger_result,
                        "category_filter": category_details,
                        "market_cap_filter": market_cap_details,
                        "llm_analysis": llm_analysis,
                        "batch": trigger_result.get("batch") or {},
                    },
                    default=str,
                ),
            )
        )
    event.processed_at = _utc_now()
    db.add(event)
    db.commit()


async def run_alpha_feed_alert_worker(stop_event: asyncio.Event, poll_interval_seconds: float = 2.0) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            events = db.scalars(
                select(AlphaWebSocketEvent)
                .where(AlphaWebSocketEvent.processed_at.is_(None))
                .order_by(AlphaWebSocketEvent.received_at.asc())
                .limit(100)
            ).all()
            for event in events:
                _process_alpha_feed_event(db, event)
        except Exception as exc:
            logger.warning("alpha feed alert loop failed: %s", exc)
            db.rollback()
        finally:
            db.close()
        if not await _wait_for_stop(stop_event, poll_interval_seconds):
            continue


async def run_alert_evaluator_worker(stop_event: asyncio.Event, poll_interval_seconds: float = 2.0) -> None:
    redis_client = _redis()
    stream_offsets: dict[str, str] = {}
    while not stop_event.is_set():
        if redis_client is None:
            if not await _wait_for_stop(stop_event, poll_interval_seconds):
                redis_client = _redis()
                continue
            break
        db = SessionLocal()
        try:
            streams = _active_streams(db)
        finally:
            db.close()
        if not streams:
            if not await _wait_for_stop(stop_event, poll_interval_seconds):
                continue
            break
        for name in streams:
            stream_offsets.setdefault(name, _initial_stream_offset(redis_client, name))
        stream_query = {name: stream_offsets.get(name, "$") for name in streams}
        try:
            events = await asyncio.to_thread(
                redis_client.xread,
                stream_query,
                count=STREAM_MAX_BATCH,
                block=STREAM_BLOCK_MS,
            )
        except redis.RedisError as exc:
            logger.warning("alert evaluator stream read failed: %s", exc)
            if not await _wait_for_stop(stop_event, poll_interval_seconds):
                redis_client = _redis()
                continue
            break
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
            await asyncio.to_thread(alert_svc.deliver_pending_notifications, db)
        except Exception as exc:
            logger.warning("alert delivery loop failed: %s", exc)
        finally:
            db.close()
        if not await _wait_for_stop(stop_event, poll_interval_seconds):
            continue


async def run_subscription_reconciler_worker(stop_event: asyncio.Event, interval_seconds: float = RECONCILE_INTERVAL_SECONDS) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            await asyncio.to_thread(reconcile_all_users, db)
        except Exception as exc:
            logger.warning("alert subscription reconcile loop failed: %s", exc)
        finally:
            db.close()
        if not await _wait_for_stop(stop_event, interval_seconds):
            continue


def _workflow_channels(db, user_id: str, workflow) -> list[str]:
    _ = user_id
    return alert_svc.resolve_workflow_channels(db, workflow)


class BackgroundAsyncService:
    def __init__(self, name: str, target) -> None:
        self.name = name
        self._target = target
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop_event: asyncio.Event | None = None
        self._ready = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        logger.info("%s starting", self.name)

        def runner() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            stop_event = asyncio.Event()
            self._loop = loop
            self._stop_event = stop_event
            self._ready.set()
            logger.info("%s started", self.name)
            try:
                while not stop_event.is_set():
                    try:
                        loop.run_until_complete(self._target(stop_event))
                        break
                    except asyncio.CancelledError:
                        if stop_event.is_set():
                            break
                        raise
                    except Exception:
                        logger.exception("%s crashed; restarting in %.1fs", self.name, BACKGROUND_RESTART_DELAY_SECONDS)
                        if stop_event.is_set():
                            break
                        if not loop.run_until_complete(_wait_for_stop(stop_event, BACKGROUND_RESTART_DELAY_SECONDS)):
                            continue
                        break
            finally:
                pending = asyncio.all_tasks(loop)
                for task in pending:
                    task.cancel()
                if pending:
                    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                loop.close()
                logger.info("%s stopped", self.name)

        self._ready.clear()
        self._thread = threading.Thread(target=runner, name=self.name, daemon=True)
        self._thread.start()
        self._ready.wait(timeout=2)

    def stop(self, timeout: float = 0.5) -> None:
        logger.info("%s stopping", self.name)
        if self._loop and self._stop_event:
            try:
                self._loop.call_soon_threadsafe(self._stop_event.set)
            except RuntimeError:
                pass
        if self._thread:
            self._thread.join(timeout=timeout)
        self._thread = None
        self._loop = None
        self._stop_event = None


class CompositeBackgroundService:
    def __init__(self, services: list[BackgroundAsyncService]) -> None:
        self.services = services

    def start(self) -> None:
        for service in self.services:
            service.start()

    def stop(self) -> None:
        for service in reversed(self.services):
            service.stop()


def create_alert_worker_service() -> CompositeBackgroundService:
    return CompositeBackgroundService(
        [
            BackgroundAsyncService("alert-live-worker", run_live_market_data_worker),
            BackgroundAsyncService("alert-evaluator-worker", run_alert_evaluator_worker),
            BackgroundAsyncService("alpha-feed-alert-worker", run_alpha_feed_alert_worker),
            BackgroundAsyncService("alert-delivery-worker", run_alert_delivery_worker),
            BackgroundAsyncService("alert-reconciler-worker", run_subscription_reconciler_worker),
        ]
    )
