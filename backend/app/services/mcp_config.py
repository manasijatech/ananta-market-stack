from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import secrets
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.system_config import McpOAuthStartOut, McpServerConfigOut, McpServerConfigUpdateIn
from broker.crypto import decrypt_value, encrypt_value
from db.models import User, UserMcpServerConfig

MCP_CLIENT_NAME = "Market Stack Broker Chat"
MCP_CLIENT_VERSION = "0.1.0"
DEFAULT_MCP_SCOPE = ""


@dataclass(frozen=True)
class McpConnectionConfig:
    name: str | None
    url: str
    transport: str
    headers: dict[str, str]
    timeout_seconds: int
    tool_cache_enabled: bool
    inventory: dict[str, Any]


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


def _json_dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


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


def _decrypt_or_empty(value: str | None) -> str:
    return decrypt_value(value) if value else ""


def _has_valid_oauth_token(row: UserMcpServerConfig) -> bool:
    if not row.oauth_access_token_cipher:
        return False
    if row.oauth_token_expires_at and row.oauth_token_expires_at <= _now() + timedelta(seconds=30):
        return False
    return True


def _inventory_summary(inventory: dict[str, Any]) -> dict[str, Any]:
    return {
        "tools": inventory.get("tools", []),
        "prompts": inventory.get("prompts", []),
        "resources": inventory.get("resources", []),
        "errors": inventory.get("errors", {}),
    }


def config_to_schema(row: UserMcpServerConfig | None) -> McpServerConfigOut:
    if row is None:
        return McpServerConfigOut()
    api_key = _decrypt_or_empty(row.api_key_cipher)
    oauth_authenticated = _has_valid_oauth_token(row)
    return McpServerConfigOut(
        is_enabled=bool(row.is_enabled),
        name=row.name,
        url=row.url or "",
        transport=row.transport if row.transport in {"streamable_http", "sse"} else "streamable_http",
        auth_mode="oauth" if oauth_authenticated or not api_key else "api_key",
        has_api_key=bool(api_key),
        api_key_hint=_api_key_hint(api_key) if api_key else None,
        api_key_header_name=row.api_key_header_name or "Authorization",
        api_key_prefix=row.api_key_prefix or "Bearer",
        oauth_authenticated=oauth_authenticated,
        oauth_authorized_at=row.oauth_authorized_at,
        oauth_token_expires_at=row.oauth_token_expires_at,
        oauth_last_error=row.oauth_last_error,
        inventory=_inventory_summary(_json_loads(row.inventory_json, {})),
        inventory_checked_at=row.inventory_checked_at,
        inventory_error=row.inventory_error,
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

    previous_url = row.url or ""
    row.is_enabled = payload.is_enabled
    row.name = (payload.name or "").strip() or None
    row.url = _validate_url(payload.url, required=payload.is_enabled)
    row.transport = payload.transport
    row.api_key_header_name = payload.api_key_header_name.strip() or "Authorization"
    row.api_key_prefix = payload.api_key_prefix.strip() or "Bearer"
    row.extra_headers_json = _json_dumps(_validate_headers(payload.extra_headers))
    row.timeout_seconds = int(payload.timeout_seconds)
    row.tool_cache_enabled = payload.tool_cache_enabled
    if payload.api_key is not None and payload.api_key.strip():
        row.api_key_cipher = encrypt_value(payload.api_key.strip())
    if row.url != previous_url:
        _clear_oauth_state(row, clear_client=True)
        row.inventory_json = "{}"
        row.inventory_checked_at = None
        row.inventory_error = None
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


def clear_mcp_oauth(db: Session, user_id: str) -> McpServerConfigOut:
    row = db.get(UserMcpServerConfig, user_id)
    if row is None:
        return get_mcp_server_config(db, user_id)
    _clear_oauth_state(row, clear_client=False)
    row.updated_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return config_to_schema(row)


def delete_mcp_server_config(db: Session, user_id: str) -> McpServerConfigOut:
    row = db.get(UserMcpServerConfig, user_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return get_mcp_server_config(db, user_id)


def _clear_oauth_state(row: UserMcpServerConfig, *, clear_client: bool) -> None:
    row.oauth_access_token_cipher = ""
    row.oauth_refresh_token_cipher = ""
    row.oauth_token_expires_at = None
    row.oauth_state = ""
    row.oauth_code_verifier_cipher = ""
    row.oauth_redirect_uri = ""
    row.oauth_scope = ""
    row.oauth_authorized_at = None
    row.oauth_last_error = None
    if clear_client:
        row.oauth_client_id = ""
        row.oauth_client_secret_cipher = ""
        row.oauth_auth_metadata_json = "{}"


def get_enabled_mcp_connection(db: Session, user_id: str) -> McpConnectionConfig | None:
    row = db.get(UserMcpServerConfig, user_id)
    if row is None or not row.is_enabled:
        return None
    url = _validate_url(row.url or "", required=True)
    headers = _headers_for_row(row)
    inventory = _json_loads(row.inventory_json, {})
    return McpConnectionConfig(
        name=row.name,
        url=url,
        transport=row.transport if row.transport in {"streamable_http", "sse"} else "streamable_http",
        headers=headers,
        timeout_seconds=int(row.timeout_seconds or 15),
        tool_cache_enabled=bool(row.tool_cache_enabled),
        inventory=inventory,
    )


def mcp_inventory_is_stale(db: Session, user_id: str, *, max_age_seconds: int = 15 * 60) -> bool:
    row = db.get(UserMcpServerConfig, user_id)
    if row is None or not row.is_enabled or not row.url:
        return False
    if row.inventory_checked_at is None:
        return True
    return row.inventory_checked_at <= _now() - timedelta(seconds=max_age_seconds)


def _headers_for_row(row: UserMcpServerConfig) -> dict[str, str]:
    headers = _validate_headers(_json_loads(row.extra_headers_json, {}))
    if _has_valid_oauth_token(row):
        headers["Authorization"] = f"Bearer {_decrypt_or_empty(row.oauth_access_token_cipher)}"
        return headers
    api_key = _decrypt_or_empty(row.api_key_cipher)
    if api_key:
        header_name = (row.api_key_header_name or "Authorization").strip()
        prefix = (row.api_key_prefix or "Bearer").strip()
        headers[header_name] = f"{prefix} {api_key}".strip()
    return headers


def _callback_url() -> str:
    base = (get_settings().app_public_base_url or "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/system-config/mcp/oauth/callback"


def _validate_redirect_uri(redirect_uri: str | None) -> str:
    cleaned = (redirect_uri or "").strip()
    if not cleaned:
        return _callback_url()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("MCP OAuth redirect_uri must be an absolute http or https URL.")
    return cleaned


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _well_known_urls_for_resource(resource_url: str) -> list[str]:
    parsed = urlparse(resource_url)
    root = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")
    urls = []
    if path:
        urls.append(f"{root}/.well-known/oauth-protected-resource{path}")
    urls.append(f"{root}/.well-known/oauth-protected-resource")
    return urls


def _auth_metadata_urls(issuer: str) -> list[str]:
    parsed = urlparse(issuer.rstrip("/"))
    root = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.strip("/")
    if path:
        return [
            f"{root}/.well-known/oauth-authorization-server/{path}",
            f"{root}/.well-known/openid-configuration/{path}",
            f"{root}/{path}/.well-known/openid-configuration",
        ]
    return [
        f"{root}/.well-known/oauth-authorization-server",
        f"{root}/.well-known/openid-configuration",
    ]


def _parse_www_authenticate(header: str) -> dict[str, str]:
    result: dict[str, str] = {}
    _, _, rest = header.partition(" ")
    for part in rest.split(","):
        key, sep, value = part.strip().partition("=")
        if not sep:
            continue
        result[key.strip()] = value.strip().strip('"')
    return result


async def _discover_protected_resource_metadata(url: str, headers: dict[str, str], timeout: int) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=float(timeout), follow_redirects=False) as client:
        try:
            response = await client.get(url, headers=headers)
            challenge = response.headers.get("WWW-Authenticate", "")
            parsed = _parse_www_authenticate(challenge)
            if parsed.get("resource_metadata"):
                meta = await client.get(parsed["resource_metadata"], headers=headers)
                meta.raise_for_status()
                payload = meta.json()
                if parsed.get("scope") and "scope" not in payload:
                    payload["scope"] = parsed["scope"]
                return payload
        except Exception:
            pass
        for metadata_url in _well_known_urls_for_resource(url):
            try:
                response = await client.get(metadata_url, headers=headers)
                if response.status_code < 400:
                    return response.json()
            except Exception:
                continue
    raise ValueError("Could not discover MCP protected resource metadata.")


async def _discover_authorization_metadata(resource_metadata: dict[str, Any], timeout: int) -> dict[str, Any]:
    issuers = resource_metadata.get("authorization_servers") or []
    if not issuers:
        raise ValueError("MCP server did not advertise authorization_servers metadata.")
    async with httpx.AsyncClient(timeout=float(timeout), follow_redirects=True) as client:
        for issuer in issuers:
            for metadata_url in _auth_metadata_urls(str(issuer)):
                try:
                    response = await client.get(metadata_url)
                    if response.status_code < 400:
                        metadata = response.json()
                        metadata.setdefault("issuer", issuer)
                        return metadata
                except Exception:
                    continue
    raise ValueError("Could not discover MCP OAuth authorization metadata.")


async def _register_oauth_client(auth_metadata: dict[str, Any], redirect_uri: str, timeout: int) -> dict[str, Any]:
    registration_endpoint = str(auth_metadata.get("registration_endpoint") or "").strip()
    if not registration_endpoint:
        raise ValueError("MCP authorization server does not support dynamic client registration.")
    payload = {
        "client_name": MCP_CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    async with httpx.AsyncClient(timeout=float(timeout), follow_redirects=True) as client:
        response = await client.post(registration_endpoint, json=payload)
        response.raise_for_status()
        registered = response.json()
    if not registered.get("client_id"):
        raise ValueError("MCP authorization server did not return a client_id.")
    return registered


async def start_mcp_oauth(db: Session, user_id: str, redirect_uri: str | None = None) -> McpOAuthStartOut:
    _ensure_user(db, user_id)
    row = db.get(UserMcpServerConfig, user_id)
    if row is None or not row.url:
        raise ValueError("Save an MCP server URL before starting authentication.")
    url = _validate_url(row.url, required=True)
    headers = _validate_headers(_json_loads(row.extra_headers_json, {}))
    timeout = int(row.timeout_seconds or 15)
    redirect_uri = _validate_redirect_uri(redirect_uri)
    resource_metadata = await _discover_protected_resource_metadata(url, headers, timeout)
    auth_metadata = await _discover_authorization_metadata(resource_metadata, timeout)
    oauth_resource = str(resource_metadata.get("resource") or url).strip() or url

    client_id = row.oauth_client_id or ""
    client_secret = _decrypt_or_empty(row.oauth_client_secret_cipher)
    if not client_id or (row.oauth_redirect_uri and row.oauth_redirect_uri != redirect_uri):
        registered = await _register_oauth_client(auth_metadata, redirect_uri, timeout)
        client_id = str(registered.get("client_id") or "")
        client_secret = str(registered.get("client_secret") or "")

    authorization_endpoint = str(auth_metadata.get("authorization_endpoint") or "").strip()
    if not authorization_endpoint:
        raise ValueError("MCP authorization server did not advertise an authorization_endpoint.")

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    scope = str(resource_metadata.get("scope") or DEFAULT_MCP_SCOPE).strip()
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": _pkce_challenge(verifier),
        "code_challenge_method": "S256",
        "resource": oauth_resource,
    }
    if scope:
        query["scope"] = scope
    authorization_url = f"{authorization_endpoint}?{urlencode(query)}"

    row.oauth_client_id = client_id
    row.oauth_client_secret_cipher = encrypt_value(client_secret) if client_secret else ""
    auth_metadata["_mcp_resource"] = oauth_resource
    row.oauth_auth_metadata_json = _json_dumps(auth_metadata)
    row.oauth_state = state
    row.oauth_code_verifier_cipher = encrypt_value(verifier)
    row.oauth_redirect_uri = redirect_uri
    row.oauth_scope = scope
    row.oauth_last_error = None
    row.updated_at = _now()
    db.add(row)
    db.commit()
    return McpOAuthStartOut(authorization_url=authorization_url, redirect_uri=redirect_uri, state=state)


async def complete_mcp_oauth(db: Session, state: str, code: str, user_id: str | None = None) -> str:
    row = db.query(UserMcpServerConfig).filter(UserMcpServerConfig.oauth_state == state).first()
    if row is None:
        raise ValueError("MCP OAuth state is invalid or expired.")
    if user_id is not None and row.user_id != user_id:
        raise ValueError("MCP OAuth state does not belong to the current user.")
    auth_metadata = _json_loads(row.oauth_auth_metadata_json, {})
    token_endpoint = str(auth_metadata.get("token_endpoint") or "").strip()
    if not token_endpoint:
        raise ValueError("MCP OAuth token endpoint is missing.")
    verifier = _decrypt_or_empty(row.oauth_code_verifier_cipher)
    if not verifier:
        raise ValueError("MCP OAuth verifier is missing.")

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": row.oauth_redirect_uri,
        "client_id": row.oauth_client_id,
        "code_verifier": verifier,
        "resource": str(auth_metadata.get("_mcp_resource") or row.url),
    }
    client_secret = _decrypt_or_empty(row.oauth_client_secret_cipher)
    if client_secret:
        data["client_secret"] = client_secret
    async with httpx.AsyncClient(timeout=float(row.timeout_seconds or 15), follow_redirects=True) as client:
        response = await client.post(token_endpoint, data=data)
        response.raise_for_status()
        payload = response.json()

    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise ValueError("MCP OAuth token response did not include an access_token.")
    expires_in = payload.get("expires_in")
    expires_at = None
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        expires_at = _now() + timedelta(seconds=int(expires_in))
    row.oauth_access_token_cipher = encrypt_value(access_token)
    refresh_token = str(payload.get("refresh_token") or "").strip()
    row.oauth_refresh_token_cipher = encrypt_value(refresh_token) if refresh_token else ""
    row.oauth_token_expires_at = expires_at
    row.oauth_state = ""
    row.oauth_code_verifier_cipher = ""
    row.oauth_authorized_at = _now()
    row.oauth_last_error = None
    row.updated_at = _now()
    db.add(row)
    db.commit()
    return row.user_id


@asynccontextmanager
async def _mcp_session(row: UserMcpServerConfig):
    from mcp import ClientSession
    from mcp.client.sse import sse_client
    from mcp.client.streamable_http import streamablehttp_client

    headers = _headers_for_row(row)
    timeout = float(row.timeout_seconds or 15)
    if row.transport == "sse":
        async with sse_client(row.url, headers=headers, timeout=timeout, sse_read_timeout=max(timeout, 30.0)) as streams:
            async with ClientSession(*streams) as session:
                yield session
    else:
        async with streamablehttp_client(
            row.url,
            headers=headers,
            timeout=timeout,
            sse_read_timeout=max(timeout, 30.0),
        ) as (read_stream, write_stream, _get_session_id):
            async with ClientSession(read_stream, write_stream) as session:
                yield session


def _dump_model(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_dump_model(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _dump_model(item) for key, item in value.items()}
    return value


async def refresh_mcp_inventory(db: Session, user_id: str) -> McpServerConfigOut:
    row = db.get(UserMcpServerConfig, user_id)
    if row is None:
        raise ValueError("Save an MCP server before refreshing its capabilities.")
    if not row.url:
        raise ValueError("MCP server URL is required.")
    try:
        inventory = await _fetch_mcp_inventory(row)
        row.inventory_json = _json_dumps(inventory)
        row.inventory_checked_at = _now()
        row.inventory_error = None
    except Exception as exc:
        row.inventory_checked_at = _now()
        row.inventory_error = str(exc)
    row.updated_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return config_to_schema(row)


async def _fetch_mcp_inventory(row: UserMcpServerConfig) -> dict[str, Any]:
    async with _mcp_session(row) as session:
        timeout = float(row.timeout_seconds or 15)
        await asyncio.wait_for(session.initialize(), timeout=timeout)
        tools, tools_error = await _list_mcp_capability(session, method_name="list_tools", result_attr="tools", timeout=timeout)
        prompts, prompts_error = await _list_mcp_capability(
            session,
            method_name="list_prompts",
            result_attr="prompts",
            timeout=timeout,
        )
        resources, resources_error = await _list_mcp_capability(
            session,
            method_name="list_resources",
            result_attr="resources",
            timeout=timeout,
        )

        errors = {
            key: value
            for key, value in {
                "tools": tools_error,
                "prompts": prompts_error,
                "resources": resources_error,
            }.items()
            if value
        }
        inventory: dict[str, Any] = {
            "tools": tools,
            "prompts": prompts,
            "resources": resources,
        }
        if errors:
            inventory["errors"] = errors
        return inventory


async def _list_mcp_capability(
    session: Any,
    *,
    method_name: str,
    result_attr: str,
    timeout: float,
) -> tuple[list[Any], str | None]:
    try:
        result = await asyncio.wait_for(getattr(session, method_name)(), timeout=timeout)
    except Exception as exc:
        return [], f"{exc.__class__.__name__}: {exc}"
    value = getattr(result, result_attr, [])
    dumped = _dump_model(value)
    return dumped if isinstance(dumped, list) else [], None
