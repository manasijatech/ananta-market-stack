"""Normalize alert workflow DSL payloads to the unified v3 `alert` shape.

Legacy `market_data` / `alpha_feed` workflow_type values are accepted on read and
converted to `alert` with explicit broker_trigger / feed_trigger flags.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


DSL_VERSION = 3

_LEGACY_MARKET_ACTIVE_PERIOD = {
    "enabled": True,
    "timezone": "Asia/Kolkata",
    "days": ["mon", "tue", "wed", "thu", "fri"],
    "sessions": [{"label": "Regular market", "start": "09:15", "end": "15:30"}],
    "exchanges": [],
    "exchange_types": [],
    "segments": [],
    "instrument_types": [],
}

_DEFAULT_ALPHA_FEED_ACTIVE_PERIOD = {
    "enabled": True,
    "timezone": "Asia/Kolkata",
    "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    "sessions": [{"label": "Always active", "start": "00:00", "end": "23:59"}],
    "exchanges": [],
    "exchange_types": [],
    "segments": [],
    "instrument_types": [],
}


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return dict(dumped) if isinstance(dumped, dict) else {}
    return {}


def _bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    return bool(value)


def normalize_workflow_dsl_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Return a copy of payload normalized to workflow_type=alert + v3 trigger flags."""
    raw = deepcopy(payload) if isinstance(payload, dict) else {}
    legacy_type = str(raw.get("workflow_type") or "alert").strip() or "alert"

    broker_trigger = _as_dict(raw.get("broker_trigger"))
    feed_trigger = _as_dict(raw.get("feed_trigger"))

    if legacy_type == "market_data":
        broker_enabled = _bool(broker_trigger.get("enabled"), True)
        feed_enabled = _bool(feed_trigger.get("enabled"), False)
    elif legacy_type == "alpha_feed":
        broker_enabled = _bool(broker_trigger.get("enabled"), False)
        # Legacy alpha_feed rows always used the feed path; default feed on when unset.
        feed_enabled = _bool(feed_trigger.get("enabled"), True)
        current_active_period = raw.get("active_period")
        if current_active_period is None or current_active_period == _LEGACY_MARKET_ACTIVE_PERIOD:
            raw["active_period"] = dict(_DEFAULT_ALPHA_FEED_ACTIVE_PERIOD)
    else:
        # Canonical alert (or unknown → treat as alert).
        broker_enabled = _bool(broker_trigger.get("enabled"), True)
        feed_enabled = _bool(feed_trigger.get("enabled"), False)
        # If an older alert row only had feed_trigger.enabled and never set broker_trigger,
        # keep broker default True unless feed is the sole intentional source with empty
        # broker-looking conditions — callers that migrate alpha_feed already set flags.
        if "enabled" not in broker_trigger and feed_enabled and not broker_trigger:
            # Explicit feed-only: when broker_trigger key missing entirely and feed on,
            # prefer keeping broker default True only if there are real broker conditions.
            conditions = raw.get("conditions")
            has_broker_conditions = False
            if isinstance(conditions, list):
                for condition in conditions:
                    if not isinstance(condition, dict):
                        continue
                    operator = str(condition.get("operator") or "")
                    field = str(condition.get("field") or "")
                    if operator and operator != "always" and field != "event":
                        has_broker_conditions = True
                        break
            if not has_broker_conditions and feed_enabled:
                broker_enabled = False

    broker_trigger["enabled"] = broker_enabled
    feed_trigger["enabled"] = feed_enabled
    raw["broker_trigger"] = broker_trigger
    raw["feed_trigger"] = feed_trigger
    raw["workflow_type"] = "alert"
    if raw.get("version") != DSL_VERSION:
        raw["version"] = DSL_VERSION
    if "validation_status" not in raw:
        raw["validation_status"] = "unknown"
    if not isinstance(raw.get("compiled_summary"), dict):
        raw["compiled_summary"] = {}
    return raw


def broker_trigger_enabled(dsl: Any) -> bool:
    if hasattr(dsl, "broker_trigger_enabled"):
        return bool(dsl.broker_trigger_enabled())
    if hasattr(dsl, "broker_trigger"):
        trigger = getattr(dsl, "broker_trigger", None)
        if trigger is not None and hasattr(trigger, "enabled"):
            return bool(trigger.enabled)
    if isinstance(dsl, dict):
        normalized = normalize_workflow_dsl_payload(dsl)
        return bool(normalized.get("broker_trigger", {}).get("enabled"))
    workflow_type = str(getattr(dsl, "workflow_type", "") or "")
    return workflow_type in {"market_data", "alert", ""}


def feed_trigger_enabled(dsl: Any) -> bool:
    if hasattr(dsl, "feed_trigger_enabled"):
        return bool(dsl.feed_trigger_enabled())
    trigger = getattr(dsl, "feed_trigger", None) if not isinstance(dsl, dict) else dsl.get("feed_trigger")
    if trigger is not None:
        enabled = getattr(trigger, "enabled", None) if not isinstance(trigger, dict) else trigger.get("enabled")
        if enabled is not None:
            return bool(enabled)
    if isinstance(dsl, dict):
        return bool(normalize_workflow_dsl_payload(dsl).get("feed_trigger", {}).get("enabled"))
    return str(getattr(dsl, "workflow_type", "") or "") == "alpha_feed"
