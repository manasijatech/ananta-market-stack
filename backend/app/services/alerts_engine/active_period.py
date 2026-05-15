from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from common.datetime_compat import UTC
from app.schemas.alert import AlertWorkflowActivePeriod


@dataclass(frozen=True)
class ActivePeriodEvaluation:
    active: bool
    reason: str
    details: dict[str, Any]


def _upper_set(values: list[str]) -> set[str]:
    return {str(item).strip().upper() for item in values if str(item).strip()}


def _parse_time(value: str) -> time | None:
    try:
        hour, minute = value.split(":", 1)
        return time(hour=int(hour), minute=int(minute[:2]))
    except Exception:
        return None


def _session_contains(now_time: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= now_time <= end
    return now_time >= start or now_time <= end


def _scoped(config: AlertWorkflowActivePeriod, instrument_scope: dict[str, Any]) -> bool:
    exchanges = _upper_set(config.exchanges)
    exchange_types = _upper_set(config.exchange_types)
    segments = _upper_set(config.segments)
    instrument_types = _upper_set(config.instrument_types)
    if not any((exchanges, exchange_types, segments, instrument_types)):
        return True
    exchange = str(instrument_scope.get("exchange") or "").strip().upper()
    exchange_type = str(instrument_scope.get("exchange_type") or "").strip().upper()
    segment = str(instrument_scope.get("segment") or "").strip().upper()
    instrument_type = str(instrument_scope.get("instrument_type") or "").strip().upper()
    checks = [
        not exchanges or exchange in exchanges,
        not exchange_types or exchange_type in exchange_types,
        not segments or segment in segments,
        not instrument_types or instrument_type in instrument_types,
    ]
    return all(checks)


def evaluate_active_period(
    config: AlertWorkflowActivePeriod,
    instrument_scope: dict[str, Any],
    *,
    now: datetime | None = None,
) -> ActivePeriodEvaluation:
    if not config.enabled:
        return ActivePeriodEvaluation(True, "active period disabled", {"enabled": False})
    if not _scoped(config, instrument_scope):
        return ActivePeriodEvaluation(True, "active period scope does not apply", {"scope_applied": False})
    try:
        timezone = ZoneInfo(config.timezone)
    except ZoneInfoNotFoundError:
        timezone = ZoneInfo("Asia/Kolkata")
    current = now or datetime.now(tz=UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    local_now = current.astimezone(timezone)
    day_name = local_now.strftime("%a").lower()
    if day_name not in {item.lower() for item in config.days}:
        return ActivePeriodEvaluation(
            False,
            f"outside active days ({local_now.strftime('%a')})",
            {"local_time": local_now.isoformat(), "timezone": config.timezone},
        )
    for session in config.sessions:
        start = _parse_time(session.start)
        end = _parse_time(session.end)
        if not start or not end:
            continue
        if _session_contains(local_now.time(), start, end):
            return ActivePeriodEvaluation(
                True,
                f"inside {session.label or 'market'} session",
                {
                    "local_time": local_now.isoformat(),
                    "timezone": config.timezone,
                    "session": session.model_dump(),
                    "scope_applied": True,
                },
            )
    return ActivePeriodEvaluation(
        False,
        "outside active market hours",
        {
            "local_time": local_now.isoformat(),
            "timezone": config.timezone,
            "sessions": [session.model_dump() for session in config.sessions],
            "scope_applied": True,
        },
    )
