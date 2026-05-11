from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import (
    AlertNotificationOut,
    AlertNotificationTestIn,
    AlertNotificationUnreadCountOut,
)
from app.services import alerts as alert_svc
from db.models import User
from db.session import SessionLocal, get_db

router = APIRouter()


@router.get("", response_model=list[AlertNotificationOut])
def list_alert_notifications(
    workflow_id: str | None = Query(default=None),
    since: datetime | None = Query(default=None),
    unread_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertNotificationOut]:
    return alert_svc.list_alert_notifications(
        db,
        user.id,
        workflow_id=workflow_id,
        since=since,
        unread_only=unread_only,
        limit=limit,
    )


@router.get("/unread-count", response_model=AlertNotificationUnreadCountOut)
def unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertNotificationUnreadCountOut:
    return AlertNotificationUnreadCountOut(unread_count=alert_svc.unread_alert_count(db, user.id))


@router.post("/{notification_id}/read", response_model=AlertNotificationOut)
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertNotificationOut:
    row = alert_svc.mark_alert_notification_read(db, user.id, notification_id)
    if row is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="alert notification not found")
    return row


@router.post("/read-all")
def read_all(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    return {"updated": alert_svc.read_all_alert_notifications(db, user.id)}


@router.post("/test", response_model=AlertNotificationOut)
def test_alert(
    body: AlertNotificationTestIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertNotificationOut:
    return alert_svc.create_test_alert_notification(db, user.id, body)


@router.get("/stream")
async def stream_alert_notifications(
    user: User = Depends(get_current_user),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    async def event_stream():
        last_seen = datetime.fromisoformat(last_event_id) if last_event_id else None
        while True:
            db = SessionLocal()
            try:
                rows = alert_svc.list_alert_notifications(
                    db,
                    user.id,
                    since=last_seen,
                    limit=50,
                )
            finally:
                db.close()
            fresh = list(reversed(rows))
            for row in fresh:
                if last_seen and row.created_at <= last_seen:
                    continue
                last_seen = row.created_at
                yield (
                    f"id: {row.created_at.isoformat()}\n"
                    "event: alert\n"
                    f"data: {json.dumps(row.model_dump(mode='json'))}\n\n"
                )
            yield "event: ping\ndata: {}\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
