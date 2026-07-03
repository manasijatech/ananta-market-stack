from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.services import desktop_audio as svc
from db.models import User, UserAlertChannel, UserAlertChannelDelivery, UserAlertNotification
from db.session import SessionLocal, get_db

router = APIRouter()


class PairingStartIn(BaseModel):
    app_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PairingStartOut(BaseModel):
    pairing_id: str
    secret: str
    expires_at: str


class PairingOut(BaseModel):
    id: str
    status: str
    expires_at: str
    completed_device_id: str | None = None


class PairingCompleteIn(BaseModel):
    pairing_id: str
    secret: str
    label: str = "Ananta Audio App"
    metadata: dict[str, Any] = Field(default_factory=dict)


class PairingCompleteOut(BaseModel):
    device_id: str
    device_token: str
    user_id: str


class DeviceOut(BaseModel):
    id: str
    label: str
    status: str
    last_seen_at: str | None = None
    last_ack_asset_id: str | None = None
    revoked_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class DeviceEventIn(BaseModel):
    type: str
    asset_id: str | None = None
    error: str | None = None


def _device_out(row) -> DeviceOut:
    try:
        metadata = json.loads(row.metadata_json or "{}")
    except json.JSONDecodeError:
        metadata = {}
    return DeviceOut(
        id=row.id,
        label=row.label,
        status=row.status,
        last_seen_at=row.last_seen_at.isoformat() if row.last_seen_at else None,
        last_ack_asset_id=row.last_ack_asset_id,
        revoked_at=row.revoked_at.isoformat() if row.revoked_at else None,
        metadata=metadata,
        created_at=row.created_at.isoformat(),
    )


def _bearer_token(authorization: str | None, token: str | None = None) -> str | None:
    if token:
        return token
    if not authorization:
        return None
    prefix = "Bearer "
    if authorization.startswith(prefix):
        return authorization[len(prefix) :].strip()
    return None


@router.post("/pairing/start", response_model=PairingStartOut)
def start_pairing(
    body: PairingStartIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PairingStartOut:
    result = svc.start_pairing(db, user.id, {"app_url": body.app_url, **body.metadata})
    return PairingStartOut(
        pairing_id=result["pairing_id"],
        secret=result["secret"],
        expires_at=result["expires_at"].isoformat(),
    )


@router.get("/pairing/{pairing_id}", response_model=PairingOut)
def get_pairing(
    pairing_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PairingOut:
    row = svc.get_pairing(db, user.id, pairing_id)
    if row is None:
        raise HTTPException(status_code=404, detail="pairing not found")
    return PairingOut(
        id=row.id,
        status=row.status,
        expires_at=row.expires_at.isoformat(),
        completed_device_id=row.completed_device_id,
    )


@router.post("/pairing/complete", response_model=PairingCompleteOut)
def complete_pairing(body: PairingCompleteIn, db: Session = Depends(get_db)) -> PairingCompleteOut:
    try:
        result = svc.complete_pairing(
            db,
            pairing_id=body.pairing_id,
            secret=body.secret,
            label=body.label,
            metadata=body.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PairingCompleteOut(**result)


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(
    include_revoked: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DeviceOut]:
    return [_device_out(row) for row in svc.list_devices(db, user.id, include_revoked=include_revoked)]


@router.delete("/devices/{device_id}")
def revoke_device(
    device_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    if not svc.revoke_device(db, user.id, device_id):
        raise HTTPException(status_code=404, detail="device not found")
    return {"ok": True}


@router.post("/devices/current/disconnect")
def disconnect_current(
    authorization: str | None = Header(default=None, alias="Authorization"),
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    device = svc.authenticate_device(db, _bearer_token(authorization, token))
    if device is None:
        raise HTTPException(status_code=401, detail="invalid device token")
    svc.revoke_device(db, device.user_id, device.id)
    return {"ok": True}


@router.get("/devices/current/pending")
def current_pending(
    authorization: str | None = Header(default=None, alias="Authorization"),
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    device = svc.authenticate_device(db, _bearer_token(authorization, token))
    if device is None:
        raise HTTPException(status_code=401, detail="invalid device token")
    payloads: list[dict[str, Any]] = []
    for asset in svc.pending_assets_for_device(db, device.id):
        notification = db.get(UserAlertNotification, asset.notification_id)
        if not notification:
            continue
        delivery = db.get(UserAlertChannelDelivery, asset.delivery_id) if asset.delivery_id else None
        channel = db.get(UserAlertChannel, delivery.channel_id) if delivery and delivery.channel_id else None
        speech = svc._speech_config(svc._channel_config(channel)) if channel else None  # type: ignore[attr-defined]
        payloads.append(svc.asset_event(asset, notification, speech))
    return payloads


@router.post("/devices/current/events")
def current_device_event(
    body: DeviceEventIn,
    authorization: str | None = Header(default=None, alias="Authorization"),
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    device = svc.authenticate_device(db, _bearer_token(authorization, token))
    if device is None:
        raise HTTPException(status_code=401, detail="invalid device token")
    if body.type == "ack" and body.asset_id:
        svc.mark_asset_acknowledged(db, device, body.asset_id)
    return {"ok": True}


@router.get("/audio/{asset_id}")
def get_audio(
    asset_id: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    device = svc.authenticate_device(db, _bearer_token(authorization, token))
    if device is None:
        raise HTTPException(status_code=401, detail="invalid device token")
    asset = svc.asset_for_device(db, device, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="audio asset not found")
    path = Path(asset.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="audio file not found")
    return FileResponse(path, media_type=asset.mime_type, filename=f"{asset.id}.{asset.response_format}")


@router.websocket("/ws")
async def desktop_audio_ws(websocket: WebSocket, token: str | None = Query(default=None)):
    header_token = _bearer_token(websocket.headers.get("authorization"), token)
    db = SessionLocal()
    try:
        device = svc.authenticate_device(db, header_token)
        if device is None:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        await svc.register_connection(device.id, websocket)
        await websocket.send_json({"type": "connected", "device_id": device.id})
        for asset in svc.pending_assets_for_device(db, device.id):
            notification = db.get(UserAlertNotification, asset.notification_id)
            if notification:
                delivery = db.get(UserAlertChannelDelivery, asset.delivery_id) if asset.delivery_id else None
                channel = db.get(UserAlertChannel, delivery.channel_id) if delivery and delivery.channel_id else None
                speech = svc._speech_config(svc._channel_config(channel)) if channel else None  # type: ignore[attr-defined]
                await websocket.send_json(svc.asset_event(asset, notification, speech))
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type") or msg.get("action")
            if msg_type == "ack" and msg.get("asset_id"):
                svc.mark_asset_acknowledged(db, device, str(msg["asset_id"]))
            elif msg_type == "pong":
                device.last_seen_at = svc._now()  # type: ignore[attr-defined]
                db.add(device)
                db.commit()
    except WebSocketDisconnect:
        pass
    finally:
        if "device" in locals():
            await svc.unregister_connection(device.id, websocket)
        db.close()
