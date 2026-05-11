from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import (
    AlertWorkflowCreate,
    AlertWorkflowOut,
    AlertWorkflowRunOut,
    AlertWorkflowTestIn,
    AlertWorkflowUpdate,
)
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
    return {"notification_id": notification.id, "message": "Test alert created and delivery attempted."}


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


@router.get("/history/all", response_model=list[AlertWorkflowRunOut])
def list_all_runs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertWorkflowRunOut]:
    return alert_svc.list_workflow_runs(db, user.id, limit=limit)
