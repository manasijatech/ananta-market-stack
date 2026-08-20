"""Alert workflow studio for Adaptive Workspace.

Reads and writes the existing ``alert_workflow_chat_snapshots`` columns
(validation, compile, explanation, samples, diff). Does not add a second
snapshot table or mutate ``adaptive_workspace_snapshots``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.adaptive_workspace_api import AdaptiveAlertStudioOut
from app.schemas.alert_workflow_chat import AlertWorkflowChatSessionCreateIn
from app.services import alerts as alert_svc
from app.services.alert_workflow_chat import sessions as chat_sessions
from app.services.alert_workflow_chat import snapshots as chat_snapshots
from db.models import AlertWorkflowChatSession, AlertWorkflowChatSnapshot

STUDIO_SESSION_TITLE = "Adaptive workspace studio"


def _workflow_summaries(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = alert_svc.list_workflows(db, user_id)
    summaries: list[dict[str, Any]] = []
    for row in rows[:40]:
        dumped = row.model_dump(mode="json") if hasattr(row, "model_dump") else dict(row)
        summaries.append(
            {
                "id": dumped.get("id"),
                "name": dumped.get("name"),
                "status": dumped.get("status"),
                "symbol": dumped.get("symbol"),
            }
        )
    return summaries


def _graph_dsl(payload: dict[str, Any], workflow: Any | None = None) -> dict[str, Any]:
    graph = payload.get("graph_dsl") if isinstance(payload, dict) else None
    if not isinstance(graph, dict) and workflow is not None:
        graph = workflow.graph_dsl.model_dump(mode="json") if hasattr(getattr(workflow, "graph_dsl", None), "model_dump") else getattr(workflow, "graph_dsl", None)
    if not isinstance(graph, dict):
        graph = {}
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
    return {"nodes": nodes, "edges": edges}


def _empty_studio(db: Session, user_id: str) -> AdaptiveAlertStudioOut:
    return AdaptiveAlertStudioOut(
        source="empty",
        graph_dsl={"nodes": [], "edges": []},
        workflows=_workflow_summaries(db, user_id),
    )


def _studio_from_snapshot(db: Session, user_id: str, row: AlertWorkflowChatSnapshot) -> AdaptiveAlertStudioOut:
    schema = chat_snapshots.snapshot_to_schema(row)
    payload = schema.workflow_payload if isinstance(schema.workflow_payload, dict) else {}
    workflow = alert_svc.get_workflow(db, user_id, row.workflow_id)
    name = str(payload.get("name") or "") or (workflow.name if workflow is not None else "")
    status = (workflow.status if workflow is not None else None) or str(payload.get("status") or "")
    return AdaptiveAlertStudioOut(
        workflow_id=row.workflow_id,
        snapshot_id=row.id,
        session_id=row.session_id,
        source="snapshot",
        name=name,
        status=status,
        workflow_payload=payload,
        graph_dsl=_graph_dsl(payload, workflow),
        validation=schema.validation,
        compile=schema.compile,
        explanation=schema.explanation,
        samples=schema.samples,
        diff=schema.diff,
        valid=bool(schema.valid),
        applied_at=schema.applied_at,
        workflows=_workflow_summaries(db, user_id),
    )


def _studio_from_workflow(db: Session, user_id: str, workflow: Any) -> AdaptiveAlertStudioOut:
    payload = chat_snapshots.workflow_out_payload(workflow)
    valid, validation, compile_result, explanation, samples = chat_snapshots.validate_workflow_payload(payload)
    return AdaptiveAlertStudioOut(
        workflow_id=getattr(workflow, "id", None),
        snapshot_id=None,
        session_id=None,
        source="workflow",
        name=str(payload.get("name") or getattr(workflow, "name", "") or ""),
        status=str(getattr(workflow, "status", None) or payload.get("status") or ""),
        workflow_payload=payload,
        graph_dsl=_graph_dsl(payload, workflow),
        validation=validation,
        compile=compile_result,
        explanation=explanation,
        samples=samples,
        diff={},
        valid=valid,
        applied_at=None,
        workflows=_workflow_summaries(db, user_id),
    )


def _latest_workflow(db: Session, user_id: str, workflow_id: str | None = None) -> Any | None:
    if workflow_id:
        workflow = alert_svc.get_workflow(db, user_id, workflow_id)
        if workflow is None:
            raise ValueError("workflow not found")
        return workflow
    rows = alert_svc.list_workflows(db, user_id)
    return rows[0] if rows else None


def _latest_snapshot(db: Session, user_id: str, workflow_id: str) -> AlertWorkflowChatSnapshot | None:
    return db.scalar(
        select(AlertWorkflowChatSnapshot)
        .where(
            AlertWorkflowChatSnapshot.user_id == user_id,
            AlertWorkflowChatSnapshot.workflow_id == workflow_id,
        )
        .order_by(AlertWorkflowChatSnapshot.created_at.desc(), AlertWorkflowChatSnapshot.version.desc())
    )


def get_or_create_studio_session(db: Session, user_id: str, workflow_id: str) -> AlertWorkflowChatSession:
    existing = db.scalar(
        select(AlertWorkflowChatSession)
        .where(
            AlertWorkflowChatSession.user_id == user_id,
            AlertWorkflowChatSession.workflow_id == workflow_id,
        )
        .order_by(AlertWorkflowChatSession.updated_at.desc(), AlertWorkflowChatSession.id.desc())
    )
    if existing is not None:
        return existing
    return chat_sessions.create_session(
        db,
        user_id,
        AlertWorkflowChatSessionCreateIn(title=STUDIO_SESSION_TITLE, workflow_id=workflow_id),
    )


def get_studio(
    db: Session,
    user_id: str,
    *,
    workflow_id: str | None = None,
    snapshot_id: str | None = None,
) -> AdaptiveAlertStudioOut:
    if snapshot_id:
        row = chat_snapshots.get_owned_snapshot(db, user_id, snapshot_id)
        return _studio_from_snapshot(db, user_id, row)

    workflow = _latest_workflow(db, user_id, workflow_id)
    if workflow is None:
        return _empty_studio(db, user_id)

    row = _latest_snapshot(db, user_id, workflow.id)
    if row is not None:
        return _studio_from_snapshot(db, user_id, row)
    return _studio_from_workflow(db, user_id, workflow)


def refresh_studio(db: Session, user_id: str, workflow_id: str | None = None) -> AdaptiveAlertStudioOut:
    workflow = _latest_workflow(db, user_id, workflow_id)
    if workflow is None:
        raise ValueError("No alert workflow exists to snapshot.")
    session = get_or_create_studio_session(db, user_id, workflow.id)
    payload = chat_snapshots.workflow_out_payload(workflow)
    row = chat_snapshots.create_snapshot(
        db,
        session=session,
        user_id=user_id,
        workflow_id=workflow.id,
        workflow_payload=payload,
        label="Adaptive workspace studio",
    )
    return _studio_from_snapshot(db, user_id, row)


def deploy_studio(db: Session, user_id: str, snapshot_id: str, confirm: bool = False) -> AdaptiveAlertStudioOut:
    if not confirm:
        raise ValueError("Deploy requires explicit confirmation (confirm=true).")
    snapshot, _workflow = chat_snapshots.deploy_snapshot(db, user_id, snapshot_id)
    row = chat_snapshots.get_owned_snapshot(db, user_id, snapshot.id)
    return _studio_from_snapshot(db, user_id, row)
