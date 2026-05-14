from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.alert import AlertUniversePreviewIn, AlertUniversePreviewOut
from app.services import alerts as alert_svc
from db.models import User
from db.session import get_db

router = APIRouter()


@router.post("/preview", response_model=AlertUniversePreviewOut)
def preview_universe(
    body: AlertUniversePreviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlertUniversePreviewOut:
    return alert_svc.preview_universe(db, user.id, body.target_universe, body.limit)

