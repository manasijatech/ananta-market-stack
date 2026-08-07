"""unified alert workflow dsl v3

Revision ID: e5a1b7c3d902
Revises: c3d8e1f4a902
Create Date: 2026-08-07 00:00:00.000000

Normalize stored workflow / template / chat-snapshot JSON from exclusive
market_data|alpha_feed types into the unified v3 `alert` shape with explicit
broker_trigger / feed_trigger flags.
"""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5a1b7c3d902"
down_revision: Union[str, None] = "c3d8e1f4a902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

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


def _json_loads(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _json_dumps(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


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


def _normalize_dsl(payload: dict[str, Any]) -> bool:
    original = _json_dumps(payload)
    raw = payload
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
    return _json_dumps(raw) != original


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _normalize_json_column(table_name: str, json_column: str) -> None:
    if not _table_exists(table_name):
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id, {json_column} FROM {table_name}")).fetchall()
    for row in rows:
        payload = _json_loads(row[1])
        if payload is None:
            continue
        working = deepcopy(payload)
        if not _normalize_dsl(working):
            continue
        bind.execute(
            sa.text(f"UPDATE {table_name} SET {json_column} = :payload WHERE id = :id"),
            {"id": row[0], "payload": _json_dumps(working)},
        )


def _normalize_chat_snapshot_payloads() -> None:
    table_name = "alert_workflow_chat_snapshots"
    if not _table_exists(table_name):
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id, workflow_payload_json FROM {table_name}")).fetchall()
    for row in rows:
        payload = _json_loads(row[1])
        if payload is None:
            continue
        working = deepcopy(payload)
        # Snapshots store AlertWorkflowUpdate-shaped payloads with nested workflow_dsl.
        dsl = working.get("workflow_dsl")
        changed = False
        if isinstance(dsl, dict):
            changed = _normalize_dsl(dsl) or changed
            working["workflow_dsl"] = dsl
        elif "workflow_type" in working or "conditions" in working or "feed_trigger" in working:
            changed = _normalize_dsl(working) or changed
        if not changed:
            continue
        bind.execute(
            sa.text(f"UPDATE {table_name} SET workflow_payload_json = :payload WHERE id = :id"),
            {"id": row[0], "payload": _json_dumps(working)},
        )


def upgrade() -> None:
    _normalize_json_column("alert_workflows", "workflow_dsl_json")
    _normalize_json_column("alert_workflow_templates", "workflow_dsl_json")
    _normalize_chat_snapshot_payloads()


def downgrade() -> None:
    # Non-destructive: leave v3 JSON in place; soft-read path accepts both shapes.
    pass
