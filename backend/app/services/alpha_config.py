from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.system_config import AlphaApiConfigOut, AlphaApiCredentialUpsertIn
from app.services.alpha_websocket import fetch_alpha_account
from broker.crypto import decrypt_value, encrypt_value
from db.models import UserAlphaApiCredential


def _build_api_key_hint(api_key: str) -> str | None:
    cleaned = (api_key or "").strip()
    if not cleaned:
        return None
    visible_suffix = cleaned[-4:] if len(cleaned) >= 4 else cleaned
    return ("*" * 8) + visible_suffix


def get_alpha_api_config(db: Session, user_id: str) -> AlphaApiConfigOut:
    row = db.get(UserAlphaApiCredential, user_id)
    return AlphaApiConfigOut(
        has_api_key=bool(row and row.api_key_cipher),
        api_key_hint=_build_api_key_hint(decrypt_value(row.api_key_cipher))
        if row and row.api_key_cipher
        else None,
        is_enabled=bool(row and row.is_enabled),
        api_key_updated_at=row.updated_at if row else None,
        account=_json_loads(row.account_json, {}) if row else {},
        account_checked_at=row.account_checked_at if row else None,
        account_error=row.account_error if row else None,
    )


def _json_loads(value: str | None, default: dict) -> dict:
    if not value:
        return default
    try:
        import json

        payload = json.loads(value)
        return payload if isinstance(payload, dict) else default
    except Exception:
        return default


def upsert_alpha_api_credential(
    db: Session,
    user_id: str,
    payload: AlphaApiCredentialUpsertIn,
) -> AlphaApiConfigOut:
    import asyncio
    import json
    from datetime import datetime

    from common.datetime_compat import UTC

    try:
        account = asyncio.run(fetch_alpha_account(payload.api_key))
    except Exception as exc:
        raise ValueError(f"Could not verify Manasija Alpha API account: {exc}") from exc
    row = db.get(UserAlphaApiCredential, user_id)
    if row is None:
        row = UserAlphaApiCredential(user_id=user_id)
    row.api_key_cipher = encrypt_value(payload.api_key)
    row.is_enabled = payload.is_enabled
    row.account_json = json.dumps(account, default=str)
    row.account_checked_at = datetime.now(tz=UTC).replace(tzinfo=None)
    row.account_error = None
    db.add(row)
    db.commit()
    return get_alpha_api_config(db, user_id)


def delete_alpha_api_credential(db: Session, user_id: str) -> AlphaApiConfigOut:
    row = db.get(UserAlphaApiCredential, user_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return get_alpha_api_config(db, user_id)


def get_alpha_api_key(db: Session, user_id: str) -> str:
    row = db.scalars(
        select(UserAlphaApiCredential).where(
            UserAlphaApiCredential.user_id == user_id,
            UserAlphaApiCredential.is_enabled.is_(True),
        )
    ).first()
    if row is None or not row.api_key_cipher:
        raise ValueError(
            "Manasija Alpha API key is not configured. Add it in System Config."
        )
    return decrypt_value(row.api_key_cipher)
