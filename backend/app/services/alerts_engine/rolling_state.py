from __future__ import annotations

import json
import os
import time
from typing import Any

import redis

from app.services.alerts_engine.ast import AlertLogicNode
from app.services.alerts_engine.conditions import (
    ConditionRuntimeContext,
    iter_rolling_conditions,
    rolling_reference_key,
    rolling_window_seconds,
)


ROLLING_STATE_PREFIX = os.getenv("ALERT_ROLLING_STATE_PREFIX", "alert:rolling")
ROLLING_STATE_DEFAULT_TTL_SECONDS = int(os.getenv("ALERT_ROLLING_STATE_TTL_SECONDS", str(6 * 60 * 60)))
ROLLING_STATE_MIN_COVERAGE_RATIO = float(os.getenv("ALERT_ROLLING_STATE_MIN_COVERAGE_RATIO", "0.8"))
ROLLING_STATE_FIELDS = (
    "ltp",
    "last_price",
    "open",
    "high",
    "low",
    "close",
    "average_price",
    "volume",
    "open_interest",
    "last_trade_quantity",
    "total_buy_quantity",
    "total_sell_quantity",
    "best_bid_price",
    "best_bid_quantity",
    "best_ask_price",
    "best_ask_quantity",
    "bid_price",
    "bid_quantity",
    "offer_price",
    "offer_quantity",
    "implied_volatility",
)


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _safe_part(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return "_"
    return "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in text)


def _tick_epoch_ms(tick: dict[str, Any], now: float | None = None) -> int:
    _ = tick
    return int(float(now if now is not None else time.time()) * 1000)


def rolling_field_key(tick: dict[str, Any], field: str) -> str:
    return ":".join(
        [
            ROLLING_STATE_PREFIX,
            _safe_part(tick.get("user_id")),
            _safe_part(tick.get("account_id")),
            _safe_part(tick.get("broker_code")),
            _safe_part(tick.get("exchange")),
            _safe_part(tick.get("symbol")),
            _safe_part(field),
        ]
    )


def collect_rolling_fields(logic: AlertLogicNode) -> set[str]:
    fields: set[str] = set()
    for node in iter_rolling_conditions(logic):
        if node.field:
            fields.add(str(node.field))
    return fields


def max_rolling_window_seconds(logic: AlertLogicNode) -> int:
    windows = [rolling_window_seconds(node) for node in iter_rolling_conditions(logic)]
    return max(windows, default=0)


def record_tick_samples(
    redis_client: redis.Redis | None,
    tick: dict[str, Any],
    *,
    fields: set[str] | None = None,
    retention_seconds: int | None = None,
    now: float | None = None,
) -> None:
    if redis_client is None:
        return
    requested_fields = set(fields or ROLLING_STATE_FIELDS)
    if not requested_fields:
        return
    timestamp_ms = _tick_epoch_ms(tick, now)
    retention_ms = int(max(retention_seconds or ROLLING_STATE_DEFAULT_TTL_SECONDS, 60) * 1000)
    expire_seconds = max(ROLLING_STATE_DEFAULT_TTL_SECONDS, int((retention_ms / 1000) * 2))
    cutoff_ms = timestamp_ms - retention_ms
    pipe = redis_client.pipeline()
    added = 0
    for field in requested_fields:
        value = _as_float(tick.get(field))
        if value is None:
            continue
        key = rolling_field_key(tick, field)
        member = json.dumps({"ts": timestamp_ms, "v": value}, separators=(",", ":"))
        pipe.zadd(key, {member: timestamp_ms})
        pipe.zremrangebyscore(key, 0, cutoff_ms)
        pipe.expire(key, expire_seconds)
        added += 1
    if added:
        pipe.execute()


def build_runtime_context(
    redis_client: redis.Redis | None,
    tick: dict[str, Any],
    logic: AlertLogicNode,
    *,
    now: float | None = None,
) -> ConditionRuntimeContext:
    if redis_client is None:
        return ConditionRuntimeContext(rolling_references={})
    timestamp_ms = _tick_epoch_ms(tick, now)
    references: dict[str, dict[str, Any]] = {}
    for node in iter_rolling_conditions(logic):
        field = str(node.field or "")
        if not field:
            continue
        window_seconds = rolling_window_seconds(node)
        key = rolling_field_key(tick, field)
        try:
            rows = redis_client.zrange(key, 0, 0, withscores=True)
        except redis.RedisError:
            rows = []
        payload: dict[str, Any] = {
            "field": field,
            "window_seconds": window_seconds,
            "redis_key": key,
            "status": "missing",
        }
        if rows:
            raw_member, score = rows[0]
            if isinstance(raw_member, bytes):
                raw_member = raw_member.decode("utf-8", errors="replace")
            value = None
            sample_ts = int(score)
            try:
                decoded = json.loads(str(raw_member))
                value = _as_float(decoded.get("v"))
                sample_ts = int(decoded.get("ts") or score)
            except Exception:
                parts = str(raw_member).split(":")
                value = _as_float(parts[-1]) if parts else None
            age_seconds = max(0.0, (timestamp_ms - sample_ts) / 1000)
            min_age_seconds = window_seconds * ROLLING_STATE_MIN_COVERAGE_RATIO
            payload.update(
                {
                    "reference": value,
                    "sample_ts": sample_ts,
                    "age_seconds": age_seconds,
                    "min_age_seconds": min_age_seconds,
                    "status": "ready" if value is not None and age_seconds >= min_age_seconds else "warming_up",
                }
            )
            if payload["status"] != "ready":
                payload["reference"] = None
        references[rolling_reference_key(node)] = payload
    return ConditionRuntimeContext(rolling_references=references)
