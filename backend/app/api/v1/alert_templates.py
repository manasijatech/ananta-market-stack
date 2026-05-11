from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import AlertTemplateOut, AlertWorkflowInstantiateIn, AlertWorkflowOut
from app.services import alerts as alert_svc
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("", response_model=list[AlertTemplateOut])
def list_templates(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertTemplateOut]:
    _ = user
    return alert_svc.list_templates(db)


@router.get("/{template_id}", response_model=AlertTemplateOut)
def get_template(
    template_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertTemplateOut:
    _ = user
    row = alert_svc.get_template(db, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="template not found")
    return row


@router.post("/{template_id}/instantiate", response_model=AlertWorkflowOut)
def instantiate_template(
    template_id: str,
    body: AlertWorkflowInstantiateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertWorkflowOut:
    if body.template_id != template_id:
        raise HTTPException(status_code=400, detail="template mismatch")
    try:
        return alert_svc.instantiate_template(db, user.id, template_id, body.model_dump(mode="json"))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
