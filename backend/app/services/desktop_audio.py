from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import WebSocket
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services import llm_config
from common.datetime_compat import UTC
from db.models import AlertAudioAsset, DesktopAudioDevice, DesktopAudioPairing, UserAlertChannelDelivery, UserAlertNotification

DEFAULT_TEMPLATE = "{title}. {message}"
DEFAULT_MODEL = "openai/gpt-4o-mini-tts"
DEFAULT_VOICE = "alloy"
MIME_BY_FORMAT = {"mp3": "audio/mpeg", "wav": "audio/wav", "pcm": "audio/L16"}

_connections: dict[str, set[WebSocket]] = defaultdict(set)


def _now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


class _SafeFormat(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _render_template(template: str, notification: UserAlertNotification, payload: dict[str, Any]) -> str:
    context = _SafeFormat(
        title=notification.title,
        message=notification.message,
        level=notification.level,
        symbol=notification.symbol or payload.get("symbol") or "",
        exchange=notification.exchange or payload.get("exchange") or "",
        **{str(k): v for k, v in payload.items() if isinstance(k, str)},
    )
    return (template or DEFAULT_TEMPLATE).format_map(context).strip()[:4000]


def start_pairing(db: Session, user_id: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    pairing_id = str(uuid.uuid4())
    secret = secrets.token_urlsafe(32)
    row = DesktopAudioPairing(
        id=pairing_id,
        user_id=user_id,
        secret_hash=_hash_secret(secret),
        status="pending",
        expires_at=_now() + timedelta(seconds=max(settings.desktop_audio_pairing_ttl_seconds, 60)),
        metadata_json=_json_dumps(metadata or {}),
    )
    db.add(row)
    db.commit()
    return {
        "pairing_id": pairing_id,
        "secret": secret,
        "expires_at": row.expires_at,
    }


def get_pairing(db: Session, user_id: str, pairing_id: str) -> DesktopAudioPairing | None:
    row = db.get(DesktopAudioPairing, pairing_id)
    if row is None or row.user_id != user_id:
        return None
    if row.status == "pending" and row.expires_at <= _now():
        row.status = "expired"
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def complete_pairing(
    db: Session,
    *,
    pairing_id: str,
    secret: str,
    label: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row = db.get(DesktopAudioPairing, pairing_id)
    if row is None or row.status != "pending" or row.expires_at <= _now():
        raise ValueError("pairing request is expired or unavailable")
    if not secrets.compare_digest(row.secret_hash, _hash_secret(secret)):
        raise ValueError("pairing secret is invalid")
    token = secrets.token_urlsafe(48)
    device = DesktopAudioDevice(
        id=str(uuid.uuid4()),
        user_id=row.user_id,
        label=(label or "Ananta Audio App")[:128],
        token_hash=_hash_secret(token),
        status="active",
        last_seen_at=_now(),
        metadata_json=_json_dumps(metadata or {}),
    )
    row.status = "completed"
    row.completed_device_id = device.id
    row.completed_at = _now()
    db.add(device)
    db.add(row)
    db.commit()
    db.refresh(device)
    return {"device_id": device.id, "device_token": token, "user_id": device.user_id}


def authenticate_device(db: Session, token: str | None) -> DesktopAudioDevice | None:
    if not token:
        return None
    token_hash = _hash_secret(token)
    row = db.scalars(
        select(DesktopAudioDevice).where(
            DesktopAudioDevice.token_hash == token_hash,
            DesktopAudioDevice.status == "active",
        )
    ).first()
    if row is None:
        return None
    row.last_seen_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_devices(db: Session, user_id: str) -> list[DesktopAudioDevice]:
    return list(
        db.scalars(
            select(DesktopAudioDevice)
            .where(DesktopAudioDevice.user_id == user_id)
            .order_by(DesktopAudioDevice.created_at.desc())
        ).all()
    )


def revoke_device(db: Session, user_id: str, device_id: str) -> bool:
    row = db.get(DesktopAudioDevice, device_id)
    if row is None or row.user_id != user_id:
        return False
    row.status = "revoked"
    row.revoked_at = _now()
    db.add(row)
    db.commit()
    asyncio.run(_broadcast(device_id, {"type": "device_revoked"}))
    return True


def _storage_dir() -> Path:
    path = Path(get_settings().desktop_audio_storage_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _channel_config(channel) -> dict[str, Any]:
    from app.services.alerts import _channel_config_payload

    return _channel_config_payload(channel)


def _target_devices(db: Session, user_id: str, config: dict[str, Any]) -> list[DesktopAudioDevice]:
    enabled_ids = [str(item) for item in config.get("enabled_device_ids") or [] if str(item)]
    stmt = select(DesktopAudioDevice).where(
        DesktopAudioDevice.user_id == user_id,
        DesktopAudioDevice.status == "active",
    )
    if enabled_ids:
        stmt = stmt.where(DesktopAudioDevice.id.in_(enabled_ids))
    return list(db.scalars(stmt).all())


def _generate_audio(db: Session, user_id: str, config: dict[str, Any], text: str) -> tuple[bytes, str, str, str]:
    model = str(config.get("model_id") or DEFAULT_MODEL).strip()
    voice = str(config.get("voice") or DEFAULT_VOICE).strip()
    response_format = str(config.get("response_format") or "mp3").strip().lower()
    api_key = llm_config.get_provider_api_key(db, user_id, "openrouter")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    public_base = get_settings().app_public_base_url
    if public_base:
        headers["HTTP-Referer"] = public_base
    headers["X-OpenRouter-Title"] = get_settings().app_name
    body = {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": response_format,
    }
    if config.get("speed") not in (None, ""):
        body["speed"] = float(config.get("speed"))
    with httpx.Client(timeout=45) as client:
        response = client.post("https://openrouter.ai/api/v1/audio/speech", headers=headers, json=body)
        response.raise_for_status()
        return response.content, model, voice, response_format


def queue_audio_for_delivery(
    db: Session,
    notification: UserAlertNotification,
    delivery: UserAlertChannelDelivery,
    channel,
) -> tuple[bool, str]:
    config = _channel_config(channel)
    devices = _target_devices(db, notification.user_id, config)
    if not devices:
        return False, "no active desktop audio devices are paired"
    payload = _json_loads(delivery.payload_json, {})
    text = _render_template(str(config.get("spoken_template") or DEFAULT_TEMPLATE), notification, payload)
    retention_days = int(config.get("retention_days") or get_settings().desktop_audio_retention_days)
    expires_at = _now() + timedelta(days=max(retention_days, 1))
    try:
        audio_bytes, model, voice, response_format = _generate_audio(db, notification.user_id, config, text)
    except Exception as exc:
        return False, str(exc)

    ext = "mp3" if response_format not in {"wav", "pcm"} else response_format
    file_id = str(uuid.uuid4())
    file_path = _storage_dir() / f"{file_id}.{ext}"
    file_path.write_bytes(audio_bytes)
    created_assets: list[AlertAudioAsset] = []
    for device in devices:
        asset = AlertAudioAsset(
            id=str(uuid.uuid4()),
            user_id=notification.user_id,
            notification_id=notification.id,
            delivery_id=delivery.id,
            device_id=device.id,
            generated_text=text,
            model_id=model,
            voice=voice,
            response_format=response_format,
            file_path=str(file_path),
            mime_type=MIME_BY_FORMAT.get(response_format, "audio/mpeg"),
            byte_size=len(audio_bytes),
            status="ready",
            expires_at=expires_at,
        )
        db.add(asset)
        created_assets.append(asset)
    db.commit()
    for asset in created_assets:
        db.refresh(asset)
        asyncio.run(_broadcast_asset(asset, notification))
    return True, ""


def pending_assets_for_device(db: Session, device_id: str, limit: int = 25) -> list[AlertAudioAsset]:
    return list(
        db.scalars(
            select(AlertAudioAsset)
            .where(
                AlertAudioAsset.device_id == device_id,
                AlertAudioAsset.status == "ready",
                AlertAudioAsset.expires_at > _now(),
                AlertAudioAsset.acknowledged_at.is_(None),
            )
            .order_by(AlertAudioAsset.created_at.asc())
            .limit(limit)
        ).all()
    )


def mark_asset_acknowledged(db: Session, device: DesktopAudioDevice, asset_id: str) -> None:
    asset = db.get(AlertAudioAsset, asset_id)
    if asset and asset.device_id == device.id:
        asset.acknowledged_at = _now()
        asset.status = "acknowledged"
        device.last_ack_asset_id = asset.id
        db.add(asset)
        db.add(device)
        db.commit()


def asset_for_device(db: Session, device: DesktopAudioDevice, asset_id: str) -> AlertAudioAsset | None:
    asset = db.get(AlertAudioAsset, asset_id)
    if asset is None or asset.device_id != device.id or asset.expires_at <= _now():
        return None
    return asset


def cleanup_expired_audio_assets(db: Session) -> dict[str, int]:
    expired = list(db.scalars(select(AlertAudioAsset).where(AlertAudioAsset.expires_at <= _now())).all())
    deleted_files = 0
    for asset in expired:
        try:
            path = Path(asset.file_path)
            if path.exists():
                path.unlink()
                deleted_files += 1
        except OSError:
            pass
        db.delete(asset)
    deleted_rows = len(expired)
    db.commit()
    cutoff = _now() - timedelta(days=1)
    db.execute(delete(DesktopAudioPairing).where(DesktopAudioPairing.status != "pending", DesktopAudioPairing.created_at < cutoff))
    db.commit()
    return {"deleted_rows": deleted_rows, "deleted_files": deleted_files}


async def register_connection(device_id: str, websocket: WebSocket) -> None:
    _connections[device_id].add(websocket)


async def unregister_connection(device_id: str, websocket: WebSocket) -> None:
    _connections[device_id].discard(websocket)


def asset_event(asset: AlertAudioAsset, notification: UserAlertNotification) -> dict[str, Any]:
    return {
        "type": "audio_alert",
        "asset_id": asset.id,
        "notification_id": notification.id,
        "title": notification.title,
        "message": notification.message,
        "level": notification.level,
        "symbol": notification.symbol,
        "exchange": notification.exchange,
        "created_at": asset.created_at.isoformat(),
        "expires_at": asset.expires_at.isoformat(),
    }


async def _broadcast_asset(asset: AlertAudioAsset, notification: UserAlertNotification) -> None:
    await _broadcast(str(asset.device_id), asset_event(asset, notification))


async def _broadcast(device_id: str, payload: dict[str, Any]) -> None:
    stale: list[WebSocket] = []
    for websocket in list(_connections.get(device_id, set())):
        try:
            await websocket.send_json(payload)
        except Exception:
            stale.append(websocket)
    for websocket in stale:
        _connections[device_id].discard(websocket)
