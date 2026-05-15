from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, time, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import httpx
from common.datetime_compat import UTC

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
    # Prefer official SDK path when available; fallback to direct HTTP exchange.
    try:
        from kiteconnect import KiteConnect

        kite = KiteConnect(api_key=api_key)
        session_data = kite.generate_session(request_token, api_secret=api_secret)
        token = (session_data or {}).get("access_token")
        if token:
            return {
                "access_token": token,
                "public_token": (session_data or {}).get("public_token", "") or "",
                "user_id": (session_data or {}).get("user_id", "") or "",
            }, None
    except Exception:
        pass

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


def sanitize_totp_secret(secret: str) -> str:
    return "".join(ch for ch in secret.strip().replace(" ", "") if ch.isalnum()).upper()


def generate_totp(secret: str, digits: int = 6, interval: int = 30) -> str:
    clean = sanitize_totp_secret(secret)
    key = base64.b32decode(clean, casefold=True)
    counter = int(datetime.now(tz=UTC).timestamp() // interval)
    msg = counter.to_bytes(8, "big")
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    code = code_int % (10**digits)
    return str(code).zfill(digits)


def _extract_request_token_from_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        return parse_qs(parsed.query).get("request_token", [None])[0]
    except Exception:
        return None


def fetch_request_token_with_web_login(
    *,
    api_key: str,
    user_id: str,
    password: str,
    totp_value: str,
) -> tuple[str | None, str | None]:
    timeout = get_httpx_client().timeout
    with httpx.Client(timeout=timeout, follow_redirects=False) as session:
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
                "skip_session": False,
            },
        )
        if twofa_response.status_code >= 400:
            return None, twofa_response.text[:500]

        candidate_urls: list[str] = []
        try:
            twofa_body = twofa_response.json()
            redirect_url = ((twofa_body.get("data") or {}).get("redirect_url"))
            if isinstance(redirect_url, str) and redirect_url:
                candidate_urls.append(redirect_url)
        except Exception:
            pass

        response = session.get(login_url, follow_redirects=False)
        hops = 0
        while hops < 5:
            candidate_urls.append(str(response.url))
            location = response.headers.get("location")
            if location:
                next_url = urljoin(str(response.url), location)
                candidate_urls.append(next_url)
                token = _extract_request_token_from_url(next_url)
                if token:
                    return token, None
            token = _extract_request_token_from_url(str(response.url))
            if token:
                return token, None
            if response.status_code not in (301, 302, 303, 307, 308) or not location:
                break
            response = session.get(next_url, follow_redirects=False)
            hops += 1

        for candidate in candidate_urls:
            token = _extract_request_token_from_url(candidate)
            if token:
                return token, None
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
