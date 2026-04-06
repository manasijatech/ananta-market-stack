from __future__ import annotations

import hashlib
import httpx
from urllib.parse import parse_qs, urlparse, urlencode
from datetime import UTC, datetime, time, timedelta, timezone

from broker.core.http import get_httpx_client

IST = timezone(timedelta(hours=5, minutes=30))


def build_login_url(api_key: str, *, state: str | None = None) -> str:
    params = {"api_key": api_key, "v": "3"}
    if state:
        params["state"] = state
    return f"https://kite.trade/connect/login?{urlencode(params)}"


def session_expiry_utc(generated_at: datetime) -> datetime:
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    generated_at_ist = generated_at.astimezone(IST)
    next_day = generated_at_ist.date() + timedelta(days=1)
    expiry_ist = datetime.combine(next_day, time(hour=6), tzinfo=IST)
    return expiry_ist.astimezone(UTC)


def is_session_active(generated_at: datetime | None, *, now: datetime | None = None) -> bool:
    if generated_at is None:
        return False
    current = now or datetime.now(tz=UTC)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    return current < session_expiry_utc(generated_at)


def exchange_request_token(
    *, api_key: str, api_secret: str, request_token: str
) -> tuple[dict[str, str] | None, str | None]:
    checksum = hashlib.sha256(
        f"{api_key}{request_token}{api_secret}".encode()
    ).hexdigest()
    data = {"api_key": api_key, "request_token": request_token, "checksum": checksum}
    client = get_httpx_client()
    r = client.post(
        "https://api.kite.trade/session/token",
        headers={"X-Kite-Version": "3"},
        data=data,
    )
    try:
        body = r.json()
    except Exception:
        return None, r.text[:500]
    if r.status_code != 200 or body.get("status") == "error":
        return None, body.get("message", r.text[:500])
    session_data = body.get("data") or {}
    token = session_data.get("access_token")
    if not token:
        return None, "no access_token"
    return {
        "access_token": token,
        "public_token": session_data.get("public_token", "") or "",
        "user_id": session_data.get("user_id", "") or "",
    }, None


def fetch_request_token_with_web_login(
    *,
    api_key: str,
    user_id: str,
    password: str,
    totp_value: str,
) -> tuple[str | None, str | None]:
    timeout = get_httpx_client().timeout
    with httpx.Client(timeout=timeout, follow_redirects=True) as session:
        login_url = build_login_url(api_key)
        session.get(login_url)
        login_response = session.post(
            "https://kite.zerodha.com/api/login",
            data={"user_id": user_id, "password": password},
        )
        try:
            login_body = login_response.json()
        except Exception:
            return None, login_response.text[:500]
        request_id = ((login_body.get("data") or {}).get("request_id"))
        if not request_id:
            return None, login_body.get("message", "missing request_id")
        twofa_response = session.post(
            "https://kite.zerodha.com/api/twofa",
            data={
                "user_id": user_id,
                "request_id": request_id,
                "twofa_value": totp_value,
                "twofa_type": "totp",
                "skip_session": True,
            },
        )
        if twofa_response.status_code >= 400:
            return None, twofa_response.text[:500]
        final_response = session.get(login_url)
        parsed = urlparse(str(final_response.url))
        request_token = parse_qs(parsed.query).get("request_token", [None])[0]
        if request_token:
            return request_token, None
        return None, "could not extract request_token from Zerodha web login flow"


def authenticate_with_request_token(request_token: str) -> tuple[str | None, str | None]:
    """Deprecated env-based helper — prefer exchange_request_token with explicit keys."""
    import os

    k, s = os.getenv("BROKER_API_KEY"), os.getenv("BROKER_API_SECRET")
    if not k or not s:
        return None, "missing api key/secret"
    session_data, err = exchange_request_token(
        api_key=k,
        api_secret=s,
        request_token=request_token,
    )
    if err or not session_data:
        return None, err or "failed"
    return session_data["access_token"], None
