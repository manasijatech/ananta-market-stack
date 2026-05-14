from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import AlertReconcileReportOut
from app.services import alerts as alert_svc
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("/condition-registry")
def condition_registry() -> dict[str, object]:
    return alert_svc.alert_condition_registry()


@router.get("/reconcile-report", response_model=AlertReconcileReportOut)
def reconcile_report(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertReconcileReportOut:
    return alert_svc.reconcile_subscriptions_for_user(db, user.id)

