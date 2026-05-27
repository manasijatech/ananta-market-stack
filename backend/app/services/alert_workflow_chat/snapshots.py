from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.alert import AlertWorkflowDsl, AlertWorkflowUpdate
from app.schemas.alert_workflow_chat import AlertWorkflowChatSnapshotOut
from app.services import alerts as alert_svc
from app.services.alerts_engine.ast import ensure_workflow_ast
from app.services.alerts_engine.compiler import compile_workflow_dsl
from app.services.alerts_engine.explain import explain_ast
from app.services.alerts_engine.samples import sample_alerts_for_ast
from app.services.alert_workflow_chat.serialization import json_dumps, json_loads
from common.datetime_compat import UTC
from db.models import AlertWorkflow, AlertWorkflowChatSession, AlertWorkflowChatSnapshot


def utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def workflow_out_payload(workflow: Any) -> dict[str, Any]:
    if hasattr(workflow, "model_dump"):
        payload = workflow.model_dump(mode="json")
    else:
        payload = dict(workflow or {})
    return {
        "template_id": payload.get("template_id"),
        "name": payload.get("name") or "AI workflow draft",
        "description": payload.get("description") or "",
        "account_id": payload.get("account_id"),
        "broker_code": payload.get("broker_code"),
        "symbol": payload.get("symbol"),
        "exchange": payload.get("exchange"),
        "instrument_ref": payload.get("instrument_ref") or {},
        "workflow_dsl": payload.get("workflow_dsl") or {},
        "graph_dsl": payload.get("graph_dsl") or {"nodes": [], "edges": []},
        "editor_mode": payload.get("editor_mode") or "rule",
        "channel_override": payload.get("channel_override"),
        "status": payload.get("status") or "draft",
    }


def _snapshot_to_schema(row: AlertWorkflowChatSnapshot) -> AlertWorkflowChatSnapshotOut:
    return AlertWorkflowChatSnapshotOut(
        id=row.id,
        session_id=row.session_id,
        run_id=row.run_id,
        workflow_id=row.workflow_id,
        user_id=row.user_id,
        version=row.version,
        label=row.label,
        workflow_payload=json_loads(row.workflow_payload_json, {}),
        validation=json_loads(row.validation_json, {}),
        compile=json_loads(row.compile_json, {}),
        explanation=json_loads(row.explanation_json, {}),
        samples=json_loads(row.samples_json, {}),
        diff=json_loads(row.diff_json, {}),
        valid=bool(row.valid),
        applied_at=row.applied_at,
        created_at=row.created_at,
    )


def snapshot_to_schema(row: AlertWorkflowChatSnapshot) -> AlertWorkflowChatSnapshotOut:
    return _snapshot_to_schema(row)


def validate_workflow_payload(payload: dict[str, Any]) -> tuple[bool, dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    try:
        dsl = AlertWorkflowDsl(**(payload.get("workflow_dsl") or {}))
        if dsl.workflow_type != "market_data":
            return False, {"valid": False, "errors": ["Workflow chat only supports market_data workflows."]}, {}, {}, {}
        compile_result = compile_workflow_dsl(dsl)
        workflow_ast = compile_result.get("workflow_ast")
        validation = {
            "valid": bool(compile_result.get("valid")),
            "errors": compile_result.get("errors") or [],
            "workflow_ast": workflow_ast,
            "compiled_summary": compile_result.get("compiled_summary") or {},
        }
        if not validation["valid"] or not workflow_ast:
            return False, validation, compile_result, {}, {}
        ast = ensure_workflow_ast({"workflow_ast": workflow_ast})
        explanation = explain_ast(ast)
        samples = sample_alerts_for_ast(ast)
        payload["workflow_dsl"] = {
            **dsl.model_dump(mode="json"),
            "workflow_ast": workflow_ast,
            "validation_status": "valid",
            "compiled_summary": compile_result.get("compiled_summary") or {},
        }
        return True, validation, compile_result, explanation, samples
    except Exception as exc:
        return False, {"valid": False, "errors": [str(exc)]}, {}, {}, {}


def create_snapshot(
    db: Session,
    *,
    session: AlertWorkflowChatSession,
    user_id: str,
    workflow_id: str,
    workflow_payload: dict[str, Any],
    run_id: str | None = None,
    label: str | None = None,
    diff: dict[str, Any] | None = None,
) -> AlertWorkflowChatSnapshot:
    valid, validation, compile_result, explanation, samples = validate_workflow_payload(workflow_payload)
    version = int(
        db.scalar(
            select(func.max(AlertWorkflowChatSnapshot.version)).where(
                AlertWorkflowChatSnapshot.session_id == session.id
            )
        )
        or 0
    ) + 1
    now = utc_now()
    row = AlertWorkflowChatSnapshot(
        id=str(uuid.uuid4()),
        session_id=session.id,
        run_id=run_id,
        workflow_id=workflow_id,
        user_id=user_id,
        version=version,
        label=(label or f"Snapshot {version}")[:256],
        workflow_payload_json=json_dumps(workflow_payload),
        validation_json=json_dumps(validation),
        compile_json=json_dumps(compile_result),
        explanation_json=json_dumps(explanation),
        samples_json=json_dumps(samples),
        diff_json=json_dumps(diff or {}),
        valid=valid,
        created_at=now,
    )
    db.add(row)
    if valid:
        session.active_snapshot_id = row.id
        session.updated_at = now
        db.add(session)
    db.commit()
    db.refresh(row)
    return row


def list_snapshots(db: Session, user_id: str, session_id: str) -> list[AlertWorkflowChatSnapshotOut]:
    rows = list(
        db.scalars(
            select(AlertWorkflowChatSnapshot)
            .where(
                AlertWorkflowChatSnapshot.user_id == user_id,
                AlertWorkflowChatSnapshot.session_id == session_id,
            )
            .order_by(AlertWorkflowChatSnapshot.version.asc(), AlertWorkflowChatSnapshot.created_at.asc())
        ).all()
    )
    return [_snapshot_to_schema(row) for row in rows]


def get_owned_snapshot(db: Session, user_id: str, snapshot_id: str) -> AlertWorkflowChatSnapshot:
    row = db.get(AlertWorkflowChatSnapshot, snapshot_id)
    if not row or row.user_id != user_id:
        raise ValueError("workflow chat snapshot not found")
    return row


def apply_snapshot(db: Session, user_id: str, snapshot_id: str):
    row = get_owned_snapshot(db, user_id, snapshot_id)
    if not row.valid:
        raise ValueError("Only valid workflow snapshots can be applied.")
    workflow = db.get(AlertWorkflow, row.workflow_id)
    if not workflow or workflow.user_id != user_id:
        raise ValueError("workflow not found for snapshot")
    payload = json_loads(row.workflow_payload_json, {})
    update = AlertWorkflowUpdate(**{key: value for key, value in payload.items() if key != "template_id"})
    out = alert_svc.apply_workflow_chat_snapshot_payload(db, user_id, workflow.id, update)
    if out is None:
        raise ValueError("workflow not found for snapshot")
    row.applied_at = utc_now()
    session = db.get(AlertWorkflowChatSession, row.session_id)
    if session is not None:
        session.active_snapshot_id = row.id
        session.workflow_id = workflow.id
        session.updated_at = row.applied_at
        db.add(session)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _snapshot_to_schema(row), out


def deploy_snapshot(db: Session, user_id: str, snapshot_id: str):
    snapshot, _workflow = apply_snapshot(db, user_id, snapshot_id)
    out = alert_svc.deploy_workflow(db, user_id, snapshot.workflow_id)
    if out is None:
        raise ValueError("workflow not found for snapshot")
    return snapshot, out

