from __future__ import annotations

from urllib.parse import urlencode

from broker.core.http import get_httpx_client


def build_login_url(*, api_key: str, redirect_uri: str, state: str | None = None) -> str:
    params = {
        "response_type": "code",
        "client_id": api_key,
        "redirect_uri": redirect_uri,
    }
    if state:
        params["state"] = state
    return f"https://api.upstox.com/v2/login/authorization/dialog?{urlencode(params)}"


def exchange_authorization_code(
    *,
    api_key: str,
    api_secret: str,
    redirect_uri: str,
    code: str,
) -> tuple[str | None, str | None]:
    data = {
        "code": code,
        "client_id": api_key,
        "client_secret": api_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    r = get_httpx_client().post(
        "https://api.upstox.com/v2/login/authorization/token", data=data
    )
    try:
        body = r.json()
    except Exception:
        return None, r.text[:500]
    if r.status_code != 200:
        errs = body.get("errors") or []
        msg = "; ".join(e.get("message", "") for e in errs if isinstance(e, dict))
        return None, msg or r.text[:500]
    tok = body.get("access_token")
    return (tok, None) if tok else (None, "no token")


def request_access_token(
    *,
    api_key: str,
    api_secret: str,
) -> tuple[dict[str, str] | None, str | None]:
    r = get_httpx_client().post(
        f"https://api.upstox.com/v3/login/auth/token/request/{api_key}",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json={"client_secret": api_secret},
    )
    try:
        body = r.json()
    except Exception:
        return None, r.text[:500]
    if r.status_code >= 400:
        errors = body.get("errors") or []
        msg = "; ".join(e.get("message", "") for e in errors if isinstance(e, dict))
        return None, msg or body.get("message", r.text[:500])
    data = body.get("data") or {}
    return {
        "notifier_url": data.get("notifier_url", "") or "",
        "token_request_expires_at": data.get("token_request_expiry", "") or "",
    }, None
