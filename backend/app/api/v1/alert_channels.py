from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import AlertChannelConfigIn, AlertChannelOut, AlertChannelTestIn
from app.services import alerts as alert_svc
from db.models import User
from db.session import get_db

router = APIRouter()


@router.get("", response_model=list[AlertChannelOut])
def list_channels(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AlertChannelOut]:
    return alert_svc.list_channels(db, user.id)


@router.put("/{channel_type}", response_model=AlertChannelOut)
def save_channel(
    channel_type: str,
    body: AlertChannelConfigIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertChannelOut:
    return alert_svc.save_channel(db, user.id, channel_type, body)


@router.post("/{channel_type}/test", response_model=AlertChannelOut)
def test_channel(
    channel_type: str,
    body: AlertChannelTestIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertChannelOut:
    row = alert_svc.test_channel(db, user.id, channel_type, body.message)
    if row is None:
        raise HTTPException(status_code=404, detail="channel not found")
    return row
