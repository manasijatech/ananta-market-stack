from __future__ import annotations

from fastapi import APIRouter

from app.services import alerts as alert_svc

router = APIRouter()


@router.get("")
def list_alert_presets() -> list[dict[str, object]]:
    return alert_svc.alert_presets()

