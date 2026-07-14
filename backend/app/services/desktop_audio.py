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

import edge_tts
import httpx
from fastapi import WebSocket
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services import llm_config
from common.datetime_compat import UTC
from db.models import AlertAudioAsset, DesktopAudioDevice, DesktopAudioPairing, UserAlertChannelDelivery, UserAlertNotification

DEFAULT_TEMPLATE = "{title}. {message}"
DEFAULT_TTS_PROVIDER = "edge_tts"
DEFAULT_MODEL = "hexgrad/kokoro-82m"
DEFAULT_VOICE = "af_bella"
DEFAULT_EDGE_VOICE = "en-US-EmmaMultilingualNeural"
DEFAULT_WEB_SPEECH_RATE = 1.0
DEFAULT_WEB_SPEECH_PITCH = 1.0
DEFAULT_WEB_SPEECH_VOLUME = 1.0
MIME_BY_FORMAT = {"mp3": "audio/mpeg", "wav": "audio/wav", "pcm": "audio/L16"}
EDGE_VOICE_CACHE_TTL = timedelta(hours=6)

_connections: dict[str, set[WebSocket]] = defaultdict(set)
_edge_voice_cache: dict[str, Any] = {"expires_at": None, "voices": []}


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


def _as_float(value: Any, default: float) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


class _SafeFormat(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _render_template(template: str, notification: UserAlertNotification, payload: dict[str, Any]) -> str:
    context = _SafeFormat(
        **{
            **{str(k): v for k, v in payload.items() if isinstance(k, str)},
            "title": notification.title,
            "message": notification.message,
            "level": notification.level,
            "symbol": notification.symbol or payload.get("symbol") or "",
            "exchange": notification.exchange or payload.get("exchange") or "",
        }
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
    now = _now()
    metadata = metadata or {}
    install_id = str(metadata.get("install_id") or metadata.get("device_key") or "").strip()
    device = None
    if install_id:
        for candidate in db.scalars(
            select(DesktopAudioDevice)
            .where(DesktopAudioDevice.user_id == row.user_id)
            .order_by(DesktopAudioDevice.created_at.desc())
        ):
            candidate_metadata = _json_loads(candidate.metadata_json, {})
            if str(candidate_metadata.get("install_id") or candidate_metadata.get("device_key") or "") == install_id:
                device = candidate
                break
            if (
                device is None
                and not str(candidate_metadata.get("install_id") or candidate_metadata.get("device_key") or "")
                and candidate.label == (label or "Ananta Audio App")[:128]
                and candidate_metadata.get("platform") == metadata.get("platform")
            ):
                device = candidate

    token = secrets.token_urlsafe(48)
    if device is None:
        device = DesktopAudioDevice(
            id=str(uuid.uuid4()),
            user_id=row.user_id,
            label=(label or "Ananta Audio App")[:128],
            token_hash=_hash_secret(token),
            metadata_json=_json_dumps(metadata),
        )
    else:
        device.label = (label or device.label or "Ananta Audio App")[:128]
        device.token_hash = _hash_secret(token)
        device.revoked_at = None
        device.metadata_json = _json_dumps({**_json_loads(device.metadata_json, {}), **metadata})
    device.status = "active"
    device.last_seen_at = now
    for candidate in db.scalars(
        select(DesktopAudioDevice).where(
            DesktopAudioDevice.user_id == row.user_id,
            DesktopAudioDevice.id != device.id,
            DesktopAudioDevice.status == "active",
        )
    ):
        candidate_metadata = _json_loads(candidate.metadata_json, {})
        same_install = install_id and str(candidate_metadata.get("install_id") or candidate_metadata.get("device_key") or "") == install_id
        same_unclaimed_host = (
            not str(candidate_metadata.get("install_id") or candidate_metadata.get("device_key") or "")
            and candidate.label == device.label
            and candidate_metadata.get("platform") == metadata.get("platform")
        )
        if same_install or same_unclaimed_host:
            candidate.status = "revoked"
            candidate.revoked_at = now
            db.add(candidate)
    row.status = "completed"
    row.completed_device_id = device.id
    row.completed_at = now
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


def list_devices(db: Session, user_id: str, *, include_revoked: bool = False) -> list[DesktopAudioDevice]:
    stmt = select(DesktopAudioDevice).where(DesktopAudioDevice.user_id == user_id)
    if not include_revoked:
        stmt = stmt.where(DesktopAudioDevice.status != "revoked")
    return list(
        db.scalars(
            stmt.order_by(DesktopAudioDevice.status.asc(), DesktopAudioDevice.created_at.desc())
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


def _speech_config(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": str(config.get("tts_provider") or DEFAULT_TTS_PROVIDER).strip().lower(),
        "voice_name": str(config.get("web_speech_voice") or "").strip(),
        "lang": str(config.get("web_speech_lang") or "").strip(),
        "rate": _as_float(config.get("web_speech_rate"), DEFAULT_WEB_SPEECH_RATE),
        "pitch": _as_float(config.get("web_speech_pitch"), DEFAULT_WEB_SPEECH_PITCH),
        "volume": _as_float(config.get("web_speech_volume"), DEFAULT_WEB_SPEECH_VOLUME),
        "fallback_to_web_speech": str(config.get("fallback_to_web_speech") or "true").lower() != "false",
    }


def _signed_percent(value: Any, default: int = 0) -> str:
    amount = _as_int(value, default)
    amount = max(-100, min(100, amount))
    return f"{amount:+d}%"


def _signed_hz(value: Any, default: int = 0) -> str:
    amount = _as_int(value, default)
    amount = max(-100, min(100, amount))
    return f"{amount:+d}Hz"


def _edge_audio_config(config: dict[str, Any]) -> tuple[str, str, str]:
    voice = str(config.get("edge_voice") or config.get("voice") or DEFAULT_EDGE_VOICE).strip()
    if not voice:
        voice = DEFAULT_EDGE_VOICE
    rate = _signed_percent(config.get("edge_rate"), 0)
    pitch = _signed_hz(config.get("edge_pitch"), 0)
    volume = _signed_percent(config.get("edge_volume"), 0)
    return voice, rate, pitch, volume


def _openrouter_audio_config(config: dict[str, Any]) -> tuple[str, str, str, float]:
    model = str(config.get("model_id") or DEFAULT_MODEL).strip()
    voice = str(config.get("voice") or DEFAULT_VOICE).strip()
    if model == DEFAULT_MODEL and voice in {"", "alloy"}:
        voice = DEFAULT_VOICE
    response_format = str(config.get("response_format") or "mp3").strip().lower()
    speed = _as_float(config.get("speed"), 1.0)
    return model, voice, response_format, speed


def _voice_cache_key(voice: str, speed: float | None = None, **extras: str) -> str:
    parts = [voice]
    if speed is not None:
        parts.append(f"speed={speed:g}")
    for key in sorted(extras):
        parts.append(f"{key}={extras[key]}")
    return "|".join(parts)


def _cached_audio_asset(
    db: Session,
    *,
    user_id: str,
    text: str,
    model: str,
    voice_key: str,
    response_format: str,
) -> AlertAudioAsset | None:
    for asset in db.scalars(
        select(AlertAudioAsset)
        .where(
            AlertAudioAsset.user_id == user_id,
            AlertAudioAsset.generated_text == text,
            AlertAudioAsset.model_id == model,
            AlertAudioAsset.voice == voice_key,
            AlertAudioAsset.response_format == response_format,
            AlertAudioAsset.file_path != "",
            AlertAudioAsset.byte_size > 0,
            AlertAudioAsset.expires_at > _now(),
        )
        .order_by(AlertAudioAsset.created_at.desc())
        .limit(20)
    ):
        path = Path(asset.file_path)
        if path.exists():
            return asset
    return None


async def _edge_generate_audio_bytes(text: str, voice: str, rate: str, pitch: str, volume: str) -> bytes:
    communicate = edge_tts.Communicate(
        text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
        connect_timeout=10,
        receive_timeout=60,
    )
    chunks: list[bytes] = []
    async for message in communicate.stream():
        if message["type"] == "audio":
            chunks.append(message["data"])
    return b"".join(chunks)


def _generate_edge_audio(config: dict[str, Any], text: str) -> tuple[bytes, str, str, str, str]:
    voice, rate, pitch, volume = _edge_audio_config(config)
    audio = asyncio.run(_edge_generate_audio_bytes(text, voice, rate, pitch, volume))
    return audio, voice, rate, pitch, volume


def list_edge_voices(*, force_refresh: bool = False) -> list[dict[str, Any]]:
    cached_until = _edge_voice_cache.get("expires_at")
    if not force_refresh and isinstance(cached_until, datetime) and cached_until > _now():
        return list(_edge_voice_cache.get("voices") or [])

    raw_voices = asyncio.run(edge_tts.list_voices())
    voices = [
        {
            "name": str(voice.get("Name") or ""),
            "short_name": str(voice.get("ShortName") or voice.get("Name") or ""),
            "locale": str(voice.get("Locale") or ""),
            "gender": str(voice.get("Gender") or ""),
            "friendly_name": str(voice.get("FriendlyName") or voice.get("ShortName") or voice.get("Name") or ""),
            "content_categories": list(voice.get("VoiceTag", {}).get("ContentCategories") or []),
            "voice_personalities": list(voice.get("VoiceTag", {}).get("VoicePersonalities") or []),
        }
        for voice in raw_voices
    ]
    voices.sort(key=lambda item: (0 if str(item["locale"]).startswith("en-") else 1, str(item["locale"]), str(item["short_name"])))
    _edge_voice_cache["voices"] = voices
    _edge_voice_cache["expires_at"] = _now() + EDGE_VOICE_CACHE_TTL
    return list(voices)


def _generate_audio(db: Session, user_id: str, config: dict[str, Any], text: str) -> tuple[bytes, str, str, str, float]:
    model, voice, response_format, speed = _openrouter_audio_config(config)
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
        body["speed"] = speed
    with httpx.Client(timeout=45) as client:
        response = client.post("https://openrouter.ai/api/v1/audio/speech", headers=headers, json=body)
        response.raise_for_status()
        return response.content, model, voice, response_format, speed


def _create_assets(
    db: Session,
    *,
    devices: list[DesktopAudioDevice],
    notification: UserAlertNotification,
    delivery: UserAlertChannelDelivery,
    text: str,
    speech: dict[str, Any],
    expires_at: datetime,
    model_id: str,
    voice: str,
    response_format: str,
    file_path: str = "",
    mime_type: str = "audio/mpeg",
    byte_size: int = 0,
    status: str = "ready",
) -> list[AlertAudioAsset]:
    created_assets: list[AlertAudioAsset] = []
    for device in devices:
        asset = AlertAudioAsset(
            id=str(uuid.uuid4()),
            user_id=notification.user_id,
            notification_id=notification.id,
            delivery_id=delivery.id,
            device_id=device.id,
            generated_text=text,
            model_id=model_id,
            voice=voice,
            response_format=response_format,
            file_path=file_path,
            mime_type=mime_type,
            byte_size=byte_size,
            status=status,
            expires_at=expires_at,
        )
        db.add(asset)
        created_assets.append(asset)
    db.commit()
    for asset in created_assets:
        db.refresh(asset)
        asyncio.run(_broadcast_asset(asset, notification, speech))
    return created_assets


def queue_audio_for_delivery(
    db: Session,
    notification: UserAlertNotification,
    delivery: UserAlertChannelDelivery,
    channel,
) -> tuple[bool, str]:
    config = _channel_config(channel)
    speech = _speech_config(config)
    devices = _target_devices(db, notification.user_id, config)
    if not devices:
        return False, "no active desktop audio devices are paired"
    payload = _json_loads(delivery.payload_json, {})
    text = _render_template(str(config.get("spoken_template") or DEFAULT_TEMPLATE), notification, payload)
    retention_days = _as_int(config.get("retention_days"), get_settings().desktop_audio_retention_days)
    expires_at = _now() + timedelta(days=max(retention_days, 1))
    provider = speech["provider"]

    if provider == "web_speech":
        _create_assets(
            db,
            devices=devices,
            notification=notification,
            delivery=delivery,
            text=text,
            speech=speech,
            expires_at=expires_at,
            model_id="web_speech",
            voice=str(speech.get("voice_name") or ""),
            response_format="web_speech",
            file_path="",
            mime_type="text/plain",
            byte_size=0,
        )
        return True, ""

    try:
        if provider == "edge_tts":
            voice, rate, pitch, volume = _edge_audio_config(config)
            voice_key = _voice_cache_key(voice, rate=rate, pitch=pitch, volume=volume)
            cached_asset = _cached_audio_asset(
                db,
                user_id=notification.user_id,
                text=text,
                model="edge_tts",
                voice_key=voice_key,
                response_format="mp3",
            )
            if cached_asset:
                _create_assets(
                    db,
                    devices=devices,
                    notification=notification,
                    delivery=delivery,
                    text=text,
                    speech=speech,
                    expires_at=expires_at,
                    model_id=cached_asset.model_id,
                    voice=cached_asset.voice,
                    response_format=cached_asset.response_format,
                    file_path=cached_asset.file_path,
                    mime_type=cached_asset.mime_type,
                    byte_size=cached_asset.byte_size,
                )
                return True, ""

            audio_bytes, voice, rate, pitch, volume = _generate_edge_audio(config, text)
            voice_key = _voice_cache_key(voice, rate=rate, pitch=pitch, volume=volume)
            file_path = _storage_dir() / f"{uuid.uuid4()}.mp3"
            file_path.write_bytes(audio_bytes)
            _create_assets(
                db,
                devices=devices,
                notification=notification,
                delivery=delivery,
                text=text,
                speech=speech,
                expires_at=expires_at,
                model_id="edge_tts",
                voice=voice_key,
                response_format="mp3",
                file_path=str(file_path),
                mime_type="audio/mpeg",
                byte_size=len(audio_bytes),
            )
            return True, ""

        model, voice, response_format, speed = _openrouter_audio_config(config)
        voice_key = _voice_cache_key(voice, speed)
        cached_asset = _cached_audio_asset(
            db,
            user_id=notification.user_id,
            text=text,
            model=model,
            voice_key=voice_key,
            response_format=response_format,
        )
        if cached_asset:
            _create_assets(
                db,
                devices=devices,
                notification=notification,
                delivery=delivery,
                text=text,
                speech=speech,
                expires_at=expires_at,
                model_id=cached_asset.model_id,
                voice=cached_asset.voice,
                response_format=cached_asset.response_format,
                file_path=cached_asset.file_path,
                mime_type=cached_asset.mime_type,
                byte_size=cached_asset.byte_size,
            )
            return True, ""

        audio_bytes, model, voice, response_format, speed = _generate_audio(db, notification.user_id, config, text)
        voice_key = _voice_cache_key(voice, speed)
        ext = "mp3" if response_format not in {"wav", "pcm"} else response_format
        file_id = str(uuid.uuid4())
        file_path = _storage_dir() / f"{file_id}.{ext}"
        file_path.write_bytes(audio_bytes)
        _create_assets(
            db,
            devices=devices,
            notification=notification,
            delivery=delivery,
            text=text,
            speech=speech,
            expires_at=expires_at,
            model_id=model,
            voice=voice_key,
            response_format=response_format,
            file_path=str(file_path),
            mime_type=MIME_BY_FORMAT.get(response_format, "audio/mpeg"),
            byte_size=len(audio_bytes),
        )
        return True, ""
    except Exception as exc:
        if speech.get("fallback_to_web_speech"):
            _create_assets(
                db,
                devices=devices,
                notification=notification,
                delivery=delivery,
                text=text,
                speech=speech,
                expires_at=expires_at,
                model_id="web_speech-fallback",
                voice=str(speech.get("voice_name") or ""),
                response_format="web_speech",
                file_path="",
                mime_type="text/plain",
                byte_size=0,
            )
            return True, ""
        return False, str(exc)


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


def asset_event(asset: AlertAudioAsset, notification: UserAlertNotification, speech: dict[str, Any] | None = None) -> dict[str, Any]:
    speech = speech or {}
    use_web_speech = asset.response_format == "web_speech"
    return {
        "type": "audio_alert",
        "asset_id": asset.id,
        "notification_id": notification.id,
        "title": notification.title,
        "message": notification.message,
        "spoken_text": asset.generated_text,
        "level": notification.level,
        "symbol": notification.symbol,
        "exchange": notification.exchange,
        "playback_mode": "web_speech" if use_web_speech else "audio_file",
        "fallback_to_web_speech": bool(speech.get("fallback_to_web_speech")),
        "speech": {
            "voice_name": speech.get("voice_name") or "",
            "lang": speech.get("lang") or "",
            "rate": speech.get("rate") or DEFAULT_WEB_SPEECH_RATE,
            "pitch": speech.get("pitch") or DEFAULT_WEB_SPEECH_PITCH,
            "volume": speech.get("volume") or DEFAULT_WEB_SPEECH_VOLUME,
        },
        "created_at": asset.created_at.isoformat(),
        "expires_at": asset.expires_at.isoformat(),
    }


async def _broadcast_asset(asset: AlertAudioAsset, notification: UserAlertNotification, speech: dict[str, Any] | None = None) -> None:
    await _broadcast(str(asset.device_id), asset_event(asset, notification, speech))


async def _broadcast(device_id: str, payload: dict[str, Any]) -> None:
    stale: list[WebSocket] = []
    for websocket in list(_connections.get(device_id, set())):
        try:
            await websocket.send_json(payload)
        except Exception:
            stale.append(websocket)
    for websocket in stale:
        _connections[device_id].discard(websocket)
