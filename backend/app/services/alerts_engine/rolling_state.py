from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
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
    "avg_volume",
    "open_interest",
    "previous_open_interest",
    "oi_day_change",
    "oi_day_change_percentage",
    "last_trade_quantity",
    "total_buy_quantity",
    "total_sell_quantity",
    "best_bid_price",
    "best_bid_quantity",
    "best_bid_orders",
    "best_ask_price",
    "best_ask_quantity",
    "best_ask_orders",
    "bid_price",
    "bid_quantity",
    "offer_price",
    "offer_quantity",
    "upper_circuit_limit",
    "lower_circuit_limit",
    "week_52_high",
    "week_52_low",
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


def _config_value(node: AlertLogicNode, key: str, default: Any = None) -> Any:
    config = node.config or {}
    if key in config and config[key] not in (None, ""):
        return config[key]
    if key == "window_seconds":
        return node.window_seconds if node.window_seconds not in (None, "") else default
    if key == "hold_seconds":
        return node.hold_seconds if node.hold_seconds not in (None, "") else default
    if key == "occurrences":
        return node.occurrences if node.occurrences not in (None, "") else default
    if key == "occurrence_window_seconds":
        return node.occurrence_window_seconds if node.occurrence_window_seconds not in (None, "") else default
    if key == "trigger_mode":
        return node.trigger_mode if node.trigger_mode not in (None, "") else default
    return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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


def _state_base_key(tick: dict[str, Any], workflow_id: str | None, state_key: str, suffix: str) -> str:
    return ":".join(
        [
            ROLLING_STATE_PREFIX,
            "state",
            _safe_part(workflow_id or tick.get("workflow_id")),
            _safe_part(tick.get("user_id")),
            _safe_part(tick.get("account_id")),
            _safe_part(tick.get("broker_code")),
            _safe_part(tick.get("exchange")),
            _safe_part(tick.get("symbol")),
            _safe_part(state_key),
            suffix,
        ]
    )


@dataclass
class RuntimeStateManager:
    redis_client: redis.Redis | None
    workflow_id: str | None = None
    now: float | None = None

    def _now_ms(self) -> int:
        return int(float(self.now if self.now is not None else time.time()) * 1000)

    def apply(self, node: AlertLogicNode, tick: dict[str, Any], result: Any, *, state_key: str) -> Any:
        if self.redis_client is None:
            return result
        next_result = self._apply_hold(node, tick, result, state_key)
        next_result = self._apply_occurrences(node, tick, next_result, state_key)
        next_result = self._apply_trigger_mode(node, tick, next_result, state_key)
        return next_result

    def _replace_result(self, result: Any, matched: bool, reason: str, extra: dict[str, Any]) -> Any:
        details = {**getattr(result, "details", {}), **extra}
        return result.__class__(matched, reason, details)

    def _apply_hold(self, node: AlertLogicNode, tick: dict[str, Any], result: Any, state_key: str) -> Any:
        hold_seconds = _as_int(_config_value(node, "hold_seconds"), 0)
        if hold_seconds <= 0:
            return result
        key = _state_base_key(tick, self.workflow_id, state_key, "hold")
        now_ms = self._now_ms()
        if not result.matched:
            try:
                self.redis_client.delete(key)
            except redis.RedisError:
                pass
            return result
        try:
            first_seen_raw = self.redis_client.get(key)
            if first_seen_raw is None:
                self.redis_client.setex(key, max(hold_seconds * 3, hold_seconds + 60), str(now_ms))
                elapsed = 0.0
            else:
                first_seen = int(first_seen_raw.decode("utf-8") if isinstance(first_seen_raw, bytes) else first_seen_raw)
                elapsed = max(0.0, (now_ms - first_seen) / 1000)
                self.redis_client.expire(key, max(hold_seconds * 3, hold_seconds + 60))
        except (redis.RedisError, ValueError):
            elapsed = 0.0
        matched = elapsed >= hold_seconds
        return self._replace_result(
            result,
            matched,
            result.reason if matched else f"{result.reason}; holding {elapsed:.1f}/{hold_seconds}s",
            {"hold_seconds": hold_seconds, "hold_elapsed_seconds": elapsed, "hold_status": "ready" if matched else "warming_up"},
        )

    def _apply_occurrences(self, node: AlertLogicNode, tick: dict[str, Any], result: Any, state_key: str) -> Any:
        occurrences = _as_int(_config_value(node, "occurrences"), 0)
        if occurrences <= 0:
            return result
        window_seconds = max(_as_int(_config_value(node, "occurrence_window_seconds"), 300), 1)
        key = _state_base_key(tick, self.workflow_id, state_key, "occ")
        now_ms = self._now_ms()
        cutoff_ms = now_ms - window_seconds * 1000
        count = 0
        if result.matched:
            member = json.dumps({"ts": now_ms, "symbol": tick.get("symbol")}, separators=(",", ":"))
            try:
                pipe = self.redis_client.pipeline()
                pipe.zadd(key, {member: now_ms})
                pipe.zremrangebyscore(key, 0, cutoff_ms)
                pipe.expire(key, max(window_seconds * 3, window_seconds + 60))
                pipe.zcount(key, cutoff_ms, now_ms)
                *_, count = pipe.execute()
            except redis.RedisError:
                count = 0
        else:
            try:
                self.redis_client.zremrangebyscore(key, 0, cutoff_ms)
                count = int(self.redis_client.zcount(key, cutoff_ms, now_ms))
            except redis.RedisError:
                count = 0
        matched = result.matched and count >= occurrences
        return self._replace_result(
            result,
            matched,
            result.reason if matched else f"{result.reason}; occurrences {count}/{occurrences} in {window_seconds}s",
            {"occurrences": occurrences, "occurrence_count": count, "occurrence_window_seconds": window_seconds},
        )

    def _apply_trigger_mode(self, node: AlertLogicNode, tick: dict[str, Any], result: Any, state_key: str) -> Any:
        mode = str(_config_value(node, "trigger_mode", "level") or "level")
        if mode in {"level", "every_match"}:
            return result
        key = _state_base_key(tick, self.workflow_id, state_key, "edge")
        previous = False
        try:
            raw_previous = self.redis_client.get(key)
            if raw_previous is not None:
                text = raw_previous.decode("utf-8") if isinstance(raw_previous, bytes) else str(raw_previous)
                previous = text == "1"
            self.redis_client.setex(key, ROLLING_STATE_DEFAULT_TTL_SECONDS, "1" if result.matched else "0")
        except redis.RedisError:
            previous = False
        if mode == "rising_edge":
            matched = bool(result.matched and not previous)
        elif mode == "falling_edge":
            matched = bool((not result.matched) and previous)
        else:
            matched = result.matched
        return self._replace_result(
            result,
            matched,
            result.reason if matched else f"{result.reason}; trigger_mode {mode} not satisfied",
            {"trigger_mode": mode, "previous_state": previous, "raw_matched": result.matched},
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
    workflow_id: str | None = None,
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
        start_ms = timestamp_ms - window_seconds * 1000
        # Rolling triggers compare the current tick against prior samples, not against itself.
        end_ms = max(start_ms, timestamp_ms - 1)
        try:
            rows = redis_client.zrangebyscore(key, start_ms, end_ms, withscores=True)
        except redis.RedisError:
            rows = []
        payload: dict[str, Any] = {
            "field": field,
            "window_seconds": window_seconds,
            "redis_key": key,
            "status": "missing",
        }
        if rows:
            samples: list[tuple[int, float]] = []
            for raw_member, score in rows:
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
                if value is not None:
                    samples.append((sample_ts, value))
            samples.sort(key=lambda item: item[0])
            sample_ts = samples[0][0] if samples else int(rows[0][1])
            values = [item[1] for item in samples]
            baseline = str(_config_value(node, "baseline", "oldest") or "oldest")
            value = None
            if values:
                if baseline in {"oldest", "nearest_window_start"}:
                    value = values[0]
                elif baseline == "mean":
                    value = sum(values) / len(values)
                elif baseline == "median":
                    ordered = sorted(values)
                    midpoint = len(ordered) // 2
                    value = ordered[midpoint] if len(ordered) % 2 else (ordered[midpoint - 1] + ordered[midpoint]) / 2
                elif baseline == "min":
                    value = min(values)
                elif baseline == "max":
                    value = max(values)
                else:
                    value = values[0]
            age_seconds = max(0.0, (timestamp_ms - sample_ts) / 1000)
            raw_min_coverage = _config_value(node, "min_coverage_ratio", ROLLING_STATE_MIN_COVERAGE_RATIO)
            if raw_min_coverage in (None, ""):
                raw_min_coverage = ROLLING_STATE_MIN_COVERAGE_RATIO
            min_coverage_ratio = float(raw_min_coverage)
            min_coverage_ratio = max(0.0, min(min_coverage_ratio, 1.0))
            min_age_seconds = window_seconds * min_coverage_ratio
            min_samples = max(_as_int(_config_value(node, "min_samples"), 3), 1)
            ready = value is not None and age_seconds >= min_age_seconds and len(samples) >= min_samples
            payload.update(
                {
                    "reference": value,
                    "sample_ts": sample_ts,
                    "age_seconds": age_seconds,
                    "min_age_seconds": min_age_seconds,
                    "sample_count": len(samples),
                    "min_samples": min_samples,
                    "baseline": baseline,
                    "coverage_ratio": (age_seconds / window_seconds) if window_seconds else 0,
                    "status": "ready" if ready else "warming_up",
                }
            )
            if payload["status"] != "ready":
                payload["reference"] = None
        references[rolling_reference_key(node)] = payload
    return ConditionRuntimeContext(
        rolling_references=references,
        state_manager=RuntimeStateManager(redis_client=redis_client, workflow_id=workflow_id, now=now),
    )
