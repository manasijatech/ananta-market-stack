"""INDstocks access-token generation for INDmoney TOTP accounts."""

from __future__ import annotations

from typing import Any

from broker.core.http import get_httpx_client

BASE = "https://api.indstocks.com"


def generate_access_token(*, client_id: str, mpin: str, totp: str) -> tuple[str | None, str | None]:
    """Issue the account's one live INDstocks token.

    Callers deliberately own caching and scheduling: the upstream endpoint
    invalidates the previous TOTP-issued token on every successful call.
    """
    try:
        response = get_httpx_client().post(
            f"{BASE}/generate/token",
            headers={"x-api-key": client_id, "Content-Type": "application/json"},
            json={"mpin": mpin, "totp": totp},
        )
    except Exception as exc:
        return None, f"INDmoney token generation request failed: {exc}"
    if response.status_code != 200:
        return None, response.text[:500]
    try:
        payload: dict[str, Any] = response.json()
    except ValueError:
        return None, response.text[:500]
    token = str(payload.get("token") or "").strip()
    return (token, None) if token else (None, str(payload)[:500])
