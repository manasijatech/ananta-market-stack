from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.services import broker_sessions as bs_svc
from db.models import User
from db.session import get_db

router = APIRouter()


class NotificationOut(BaseModel):
    id: str
    account_id: str | None
    broker_code: str | None
    level: str
    kind: str
    title: str
    message: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[NotificationOut]:
    return list(bs_svc.list_notifications(db, user.id))


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationOut:
    row = bs_svc.mark_notification_read(db, user.id, notification_id)
    if row is None:
        raise HTTPException(status_code=404, detail="notification not found")
    return row
