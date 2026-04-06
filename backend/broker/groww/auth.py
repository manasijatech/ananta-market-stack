from __future__ import annotations

import hashlib
import time

from broker.core.http import get_httpx_client

GROWW_BASE = "https://api.groww.in"


def refresh_access_token(*, api_key: str, api_secret: str) -> tuple[str | None, str | None]:
    ts = str(int(time.time()))
    chk = hashlib.sha256((api_secret + ts).encode("utf-8")).hexdigest()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"key_type": "approval", "checksum": chk, "timestamp": ts}
    r = get_httpx_client().post(f"{GROWW_BASE}/v1/token/api/access", headers=headers, json=payload)
    if r.status_code != 200:
        return None, r.text[:500]
    body = r.json()
    tok = body.get("token")
    return (tok, None) if tok else (None, str(body))


def access_token_from_totp(*, totp_token: str, totp: str) -> tuple[str | None, str | None]:
    headers = {
        "Authorization": f"Bearer {totp_token}",
        "Content-Type": "application/json",
    }
    payload = {"key_type": "totp", "totp": totp}
    r = get_httpx_client().post(f"{GROWW_BASE}/v1/token/api/access", headers=headers, json=payload)
    if r.status_code != 200:
        return None, r.text[:500]
    body = r.json()
    tok = body.get("token")
    return (tok, None) if tok else (None, str(body))
