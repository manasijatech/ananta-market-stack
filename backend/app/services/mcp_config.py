from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.schemas.system_config import McpServerConfigOut, McpServerConfigUpdateIn
from broker.crypto import decrypt_value, encrypt_value
from db.models import User, UserMcpServerConfig


@dataclass(frozen=True)
class McpConnectionConfig:
    name: str | None
    url: str
    transport: str
    headers: dict[str, str]
    timeout_seconds: int
    tool_cache_enabled: bool


def _now() -> datetime:
    return datetime.utcnow()


def _ensure_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user:
        return user
    user = User(id=user_id, display_name=None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _api_key_hint(api_key: str) -> str | None:
    cleaned = api_key.strip()
    if not cleaned:
        return None
    return ("*" * 8) + (cleaned[-4:] if len(cleaned) >= 4 else cleaned)


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _validate_headers(headers: dict[str, str]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for key, value in headers.items():
        name = str(key).strip()
        text = str(value).strip()
        if not name or not text:
            continue
        if "\n" in name or "\r" in name or "\n" in text or "\r" in text:
            raise ValueError("MCP headers cannot contain newline characters.")
        cleaned[name] = text
    return cleaned


def _validate_url(url: str, *, required: bool) -> str:
    cleaned = url.strip()
    if not cleaned:
        if required:
            raise ValueError("MCP server URL is required when MCP is enabled.")
        return ""
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("MCP server URL must be an absolute http or https URL.")
    return cleaned


def config_to_schema(row: UserMcpServerConfig | None) -> McpServerConfigOut:
    if row is None:
        return McpServerConfigOut()
    api_key = decrypt_value(row.api_key_cipher) if row.api_key_cipher else ""
    return McpServerConfigOut(
        is_enabled=bool(row.is_enabled),
        name=row.name,
        url=row.url or "",
        transport=row.transport if row.transport in {"streamable_http", "sse"} else "streamable_http",
        has_api_key=bool(api_key),
        api_key_hint=_api_key_hint(api_key) if api_key else None,
        api_key_header_name=row.api_key_header_name or "Authorization",
        api_key_prefix=row.api_key_prefix or "",
        extra_headers=_json_loads(row.extra_headers_json, {}),
        timeout_seconds=int(row.timeout_seconds or 15),
        tool_cache_enabled=bool(row.tool_cache_enabled),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def get_mcp_server_config(db: Session, user_id: str) -> McpServerConfigOut:
    _ensure_user(db, user_id)
    return config_to_schema(db.get(UserMcpServerConfig, user_id))


def upsert_mcp_server_config(
    db: Session,
    user_id: str,
    payload: McpServerConfigUpdateIn,
) -> McpServerConfigOut:
    _ensure_user(db, user_id)
    row = db.get(UserMcpServerConfig, user_id)
    now = _now()
    if row is None:
        row = UserMcpServerConfig(user_id=user_id, created_at=now, updated_at=now)

    row.is_enabled = payload.is_enabled
    row.name = (payload.name or "").strip() or None
    row.url = _validate_url(payload.url, required=payload.is_enabled)
    row.transport = payload.transport
    row.api_key_header_name = payload.api_key_header_name.strip() or "Authorization"
    row.api_key_prefix = payload.api_key_prefix.strip()
    row.extra_headers_json = json.dumps(_validate_headers(payload.extra_headers), separators=(",", ":"))
    row.timeout_seconds = int(payload.timeout_seconds)
    row.tool_cache_enabled = payload.tool_cache_enabled
    if payload.api_key is not None and payload.api_key.strip():
        row.api_key_cipher = encrypt_value(payload.api_key.strip())
    row.updated_at = now
    db.add(row)
    db.commit()
    db.refresh(row)
    return config_to_schema(row)


def clear_mcp_api_key(db: Session, user_id: str) -> McpServerConfigOut:
    row = db.get(UserMcpServerConfig, user_id)
    if row is None:
        return get_mcp_server_config(db, user_id)
    row.api_key_cipher = ""
    row.updated_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return config_to_schema(row)


def get_enabled_mcp_connection(db: Session, user_id: str) -> McpConnectionConfig | None:
    row = db.get(UserMcpServerConfig, user_id)
    if row is None or not row.is_enabled:
        return None
    url = _validate_url(row.url or "", required=True)
    headers = _validate_headers(_json_loads(row.extra_headers_json, {}))
    api_key = decrypt_value(row.api_key_cipher) if row.api_key_cipher else ""
    if api_key:
        header_name = (row.api_key_header_name or "Authorization").strip()
        prefix = (row.api_key_prefix or "").strip()
        headers[header_name] = f"{prefix} {api_key}".strip()
    return McpConnectionConfig(
        name=row.name,
        url=url,
        transport=row.transport if row.transport in {"streamable_http", "sse"} else "streamable_http",
        headers=headers,
        timeout_seconds=int(row.timeout_seconds or 15),
        tool_cache_enabled=bool(row.tool_cache_enabled),
    )
