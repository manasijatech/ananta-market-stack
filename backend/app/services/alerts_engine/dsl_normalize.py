"""Normalize alert workflow DSL payloads to the unified v3 `alert` shape.

Legacy `market_data` / `alpha_feed` workflow_type values are accepted on read and
converted to `alert` with explicit broker_trigger / feed_trigger flags.
"""

from __future__ import annotations

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


def _has_broker_conditions(conditions: Any) -> bool:
    if not isinstance(conditions, list):
        return False
    for condition in conditions:
        if not isinstance(condition, dict):
            continue
        operator = str(condition.get("operator") or "")
        field = str(condition.get("field") or "")
        if operator and operator != "always" and field != "event":
            return True
    return False


def _is_already_normalized(payload: dict[str, Any]) -> bool:
    if payload.get("workflow_type") != "alert":
        return False
    if payload.get("version") != DSL_VERSION:
        return False
    broker = payload.get("broker_trigger")
    feed = payload.get("feed_trigger")
    if not isinstance(broker, dict) or not isinstance(feed, dict):
        return False
    if not isinstance(broker.get("enabled"), bool) or not isinstance(feed.get("enabled"), bool):
        return False
    return True


def normalize_workflow_dsl_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Return a payload normalized to workflow_type=alert + v3 trigger flags.

    Already-canonical v3 payloads are returned as-is (no copy) for hot-path reads.
    """
    if not isinstance(payload, dict):
        payload = {}
    if _is_already_normalized(payload):
        return payload

    # Shallow copy is enough: we only replace top-level keys we mutate.
    raw = dict(payload)
    legacy_type = str(raw.get("workflow_type") or "alert").strip() or "alert"

    broker_trigger = _as_dict(raw.get("broker_trigger"))
    feed_trigger = _as_dict(raw.get("feed_trigger"))

    if legacy_type == "market_data":
        broker_enabled = _bool(broker_trigger.get("enabled"), True)
        feed_enabled = _bool(feed_trigger.get("enabled"), False)
    elif legacy_type == "alpha_feed":
        broker_enabled = _bool(broker_trigger.get("enabled"), False)
        feed_enabled = _bool(feed_trigger.get("enabled"), True)
        current_active_period = raw.get("active_period")
        if current_active_period is None or current_active_period == _LEGACY_MARKET_ACTIVE_PERIOD:
            raw["active_period"] = dict(_DEFAULT_ALPHA_FEED_ACTIVE_PERIOD)
    else:
        broker_enabled = _bool(broker_trigger.get("enabled"), True)
        feed_enabled = _bool(feed_trigger.get("enabled"), False)
        if "enabled" not in broker_trigger and feed_enabled and not _has_broker_conditions(raw.get("conditions")):
            broker_enabled = False

    broker_trigger["enabled"] = broker_enabled
    feed_trigger["enabled"] = feed_enabled
    raw["broker_trigger"] = broker_trigger
    raw["feed_trigger"] = feed_trigger
    raw["workflow_type"] = "alert"
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
        broker = dsl.get("broker_trigger")
        if isinstance(broker, dict) and isinstance(broker.get("enabled"), bool):
            return bool(broker["enabled"])
        workflow_type = str(dsl.get("workflow_type") or "")
        if workflow_type == "alpha_feed":
            return False
        if workflow_type in {"market_data", "alert", ""}:
            return True
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
        workflow_type = str(dsl.get("workflow_type") or "")
        return workflow_type == "alpha_feed"
    return str(getattr(dsl, "workflow_type", "") or "") == "alpha_feed"
