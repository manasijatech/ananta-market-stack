"""alert condition state config json

Revision ID: c4e9a7b2d1f6
Revises: b7f2a1d9c6e4
Create Date: 2026-05-27 00:00:00.000000

"""

from __future__ import annotations

import json
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4e9a7b2d1f6"
down_revision: Union[str, None] = "b7f2a1d9c6e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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


def _normalize_condition(condition: Any) -> bool:
    if not isinstance(condition, dict):
        return False
    changed = False
    kind = str(condition.get("kind") or "condition")
    children = condition.get("children")
    if isinstance(children, list):
        for child in children:
            changed = _normalize_condition(child) or changed
    if kind != "condition":
        return changed
    if not isinstance(condition.get("config"), dict):
        condition["config"] = {}
        changed = True
    if not condition.get("trigger_mode"):
        condition["trigger_mode"] = "level"
        changed = True
    return changed


def _normalize_dsl(payload: dict[str, Any]) -> bool:
    changed = False
    if payload.get("version") != 2:
        payload["version"] = 2
        changed = True
    if "validation_status" not in payload:
        payload["validation_status"] = "unknown"
        changed = True
    if not isinstance(payload.get("compiled_summary"), dict):
        payload["compiled_summary"] = {}
        changed = True
    conditions = payload.get("conditions")
    if isinstance(conditions, list):
        for condition in conditions:
            changed = _normalize_condition(condition) or changed
    workflow_ast = payload.get("workflow_ast")
    if isinstance(workflow_ast, dict):
        if workflow_ast.get("version") != 2:
            workflow_ast["version"] = 2
            changed = True
        changed = _normalize_condition(workflow_ast.get("logic")) or changed
    return changed


def _normalize_graph(payload: dict[str, Any]) -> bool:
    changed = False
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return False
    for node in nodes:
        if not isinstance(node, dict) or node.get("kind") != "condition":
            continue
        changed = _normalize_condition(node.get("config")) or changed
    return changed


def _normalize_json_column(table_name: str, json_column: str) -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id, {json_column} FROM {table_name}")).fetchall()
    for row in rows:
        payload = _json_loads(row[1])
        if payload is None:
            continue
        if not _normalize_dsl(payload):
            continue
        bind.execute(
            sa.text(f"UPDATE {table_name} SET {json_column} = :payload WHERE id = :id"),
            {"id": row[0], "payload": _json_dumps(payload)},
        )


def _normalize_graph_column(table_name: str) -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id, graph_dsl_json FROM {table_name}")).fetchall()
    for row in rows:
        payload = _json_loads(row[1])
        if payload is None:
            continue
        if not _normalize_graph(payload):
            continue
        bind.execute(
            sa.text(f"UPDATE {table_name} SET graph_dsl_json = :payload WHERE id = :id"),
            {"id": row[0], "payload": _json_dumps(payload)},
        )


def upgrade() -> None:
    _normalize_json_column("alert_workflow_templates", "workflow_dsl_json")
    _normalize_json_column("alert_workflows", "workflow_dsl_json")
    _normalize_graph_column("alert_workflow_templates")
    _normalize_graph_column("alert_workflows")


def downgrade() -> None:
    # Preserve workflow JSON on downgrade. Removing these keys would discard
    # user-visible rule-builder state and is not required for older readers.
    pass
