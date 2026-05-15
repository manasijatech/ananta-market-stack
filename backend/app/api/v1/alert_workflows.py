from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import (
    AlertWorkflowCreate,
    AlertWorkflowOut,
    AlertWorkflowLlmContextPreviewOut,
    AlertWorkflowLlmPreviewIn,
    AlertWorkflowLlmTestOut,
    AlertWorkflowRunOut,
    AlertWorkflowTestIn,
    AlertWorkflowUpdate,
    AlertWorkflowValidationOut,
)
from app.schemas.llm_usage import WorkflowLlmUsageSummaryOut
from app.services import alerts as alert_svc
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("", response_model=list[AlertWorkflowOut])
def list_workflows(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowOut]:
    return alert_svc.list_workflows(db, user.id, status=status)


@router.post("", response_model=AlertWorkflowOut)
def create_workflow(
    body: AlertWorkflowCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    return alert_svc.create_workflow(db, user.id, body)


@router.get("/llm/placeholders")
def llm_placeholders() -> dict[str, object]:
    return alert_svc.llm_placeholder_catalog()


@router.post("/{workflow_id}/llm/preview-context", response_model=AlertWorkflowLlmContextPreviewOut)
def preview_llm_context(
    workflow_id: str,
    body: AlertWorkflowLlmPreviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowLlmContextPreviewOut:
    result = alert_svc.preview_workflow_llm_context(
        db,
        user.id,
        workflow_id,
        body.tick,
        previous_tick=body.previous_tick,
        reason=body.reason,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return result


@router.post("/{workflow_id}/llm/test", response_model=AlertWorkflowLlmTestOut)
def test_llm_analysis(
    workflow_id: str,
    body: AlertWorkflowLlmPreviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowLlmTestOut:
    result = alert_svc.test_workflow_llm_analysis(
        db,
        user.id,
        workflow_id,
        body.tick,
        previous_tick=body.previous_tick,
        reason=body.reason,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return result


@router.get("/{workflow_id}", response_model=AlertWorkflowOut)
def get_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    row = alert_svc.get_workflow(db, user.id, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return row


@router.put("/{workflow_id}", response_model=AlertWorkflowOut)
def update_workflow(
    workflow_id: str,
    body: AlertWorkflowUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    row = alert_svc.update_workflow(db, user.id, workflow_id, body)
    if row is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return row


@router.delete("/{workflow_id}")
def delete_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    ok = alert_svc.delete_workflow(db, user.id, workflow_id)
    if not ok:
        raise HTTPException(status_code=404, detail="workflow not found")
    return {"ok": True}


@router.post("/{workflow_id}/enable", response_model=AlertWorkflowOut)
def enable_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    row = alert_svc.set_workflow_status(db, user.id, workflow_id, "active")
    if row is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return row


@router.post("/{workflow_id}/disable", response_model=AlertWorkflowOut)
def disable_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    row = alert_svc.set_workflow_status(db, user.id, workflow_id, "inactive")
    if row is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return row


@router.post("/{workflow_id}/duplicate", response_model=AlertWorkflowOut)
def duplicate_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    row = alert_svc.duplicate_workflow(db, user.id, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return row


@router.post("/{workflow_id}/test")
def test_workflow(
    workflow_id: str,
    body: AlertWorkflowTestIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, object]:
    workflow = alert_svc.get_workflow(db, user.id, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    matched, reason = alert_svc.evaluate_workflow_payload(workflow, body.tick)
    return {"matched": matched, "reason": reason}


@router.post("/{workflow_id}/validate", response_model=AlertWorkflowValidationOut)
def validate_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowValidationOut:
    result = alert_svc.validate_workflow(db, user.id, workflow_id)
    if result is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return result


@router.post("/{workflow_id}/compile-preview", response_model=AlertWorkflowValidationOut)
def compile_preview_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowValidationOut:
    result = alert_svc.compile_preview_workflow(db, user.id, workflow_id)
    if result is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return result


@router.post("/{workflow_id}/explain")
def explain_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, object]:
    result = alert_svc.explain_workflow(db, user.id, workflow_id)
    if result is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return result


@router.post("/{workflow_id}/sample-alerts")
def sample_workflow_alerts(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, object]:
    result = alert_svc.sample_workflow_alerts(db, user.id, workflow_id)
    if result is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return result


@router.post("/{workflow_id}/deploy", response_model=AlertWorkflowOut)
def deploy_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    row = alert_svc.deploy_workflow(db, user.id, workflow_id)
    if row is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return row


@router.post("/{workflow_id}/test-notification")
def test_workflow_notification(
    workflow_id: str,
    body: AlertWorkflowTestIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    workflow = alert_svc.get_workflow(db, user.id, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    notification = alert_svc.create_workflow_test_notification(db, workflow, body.tick)
    return {"notification_id": notification.id, "message": "Test alert created and queued for channel delivery."}


@router.get("/{workflow_id}/runs", response_model=list[AlertWorkflowRunOut])
def list_workflow_runs(
    workflow_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowRunOut]:
    workflow = alert_svc.get_workflow(db, user.id, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return alert_svc.list_workflow_runs(db, user.id, workflow_id=workflow_id, limit=limit)


@router.get(
    "/{workflow_id}/llm/usage",
    response_model=WorkflowLlmUsageSummaryOut,
    summary="Workflow LLM usage summary",
    description=(
        "Returns lifetime and daily LLM usage for a single workflow id. "
        "Historical usage survives later workflow deletion in the ledger, but this route still requires the workflow "
        "to exist for the current user so the frontend can treat it as a workflow-scoped detail view."
    ),
)
def workflow_llm_usage_summary(
    workflow_id: str,
    date_from: date | None = Query(default=None, description="Optional inclusive lower date bound in UTC."),
    date_to: date | None = Query(default=None, description="Optional inclusive upper date bound in UTC."),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkflowLlmUsageSummaryOut:
    result = alert_svc.workflow_llm_usage_summary(
        db,
        user.id,
        workflow_id,
        date_from=date_from,
        date_to=date_to,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return result


@router.get("/history/all", response_model=list[AlertWorkflowRunOut])
def list_all_runs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowRunOut]:
    return alert_svc.list_workflow_runs(db, user.id, limit=limit)
