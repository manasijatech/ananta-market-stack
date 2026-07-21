from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

from common.datetime_compat import UTC

LOGIN_URL = "https://app.arrow.trade/app/login"
AUTH_URL = "https://edge.arrow.trade/auth/app/authenticate-token"
SDK_AUTH_URL = "https://api.arrow.trade/auth/app/authenticate-token"
WEB_LOGIN_URL = "https://api.arrow.trade/auth/app/login"
WEB_2FA_URL = "https://api.arrow.trade/auth/validate-2fa"


def access_checksum(app_id: str, app_secret: str, request_token: str) -> str:
    raw = f"{app_id}:{app_secret}:{request_token}".encode()
    return hashlib.sha256(raw).hexdigest()


def callback_checksum(app_id: str, request_token: str) -> str:
    raw = f"{request_token}:{app_id}".encode()
    return hashlib.sha256(raw).hexdigest()


def callback_checksum_valid(app_id: str, request_token: str, checksum: str | None) -> bool:
    if not checksum:
        return True
    return hmac.compare_digest(callback_checksum(app_id, request_token), checksum.strip().lower())


def login_url(app_id: str) -> str:
    return f"{LOGIN_URL}?{urlencode({'appID': app_id})}"


def token_expiry(generated_at: datetime | None = None) -> datetime:
    base = generated_at or datetime.now(tz=UTC)
    if base.tzinfo is None:
        base = base.replace(tzinfo=UTC)
    return base + timedelta(hours=24)


def _data(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RuntimeError("Arrow authentication returned an invalid response")
    if str(payload.get("status") or "").lower() in {"error", "failure", "failed"}:
        raise RuntimeError(str(payload.get("message") or payload.get("error") or "Arrow authentication failed"))
    data = payload.get("data", payload)
    if not isinstance(data, dict):
        raise RuntimeError("Arrow authentication response did not contain data")
    return data


def exchange_request_token(
    *, app_id: str, app_secret: str, request_token: str, client: httpx.Client | None = None
) -> tuple[dict[str, Any] | None, str | None]:
    checksum = access_checksum(app_id, app_secret, request_token)
    body = {
        "appID": app_id,
        "token": request_token,
        "checkSum": checksum,
        "checksum": checksum,
    }
    http = client or httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))
    owns_client = client is None
    try:
        last_error = "Arrow token exchange failed"
        for url in (AUTH_URL, SDK_AUTH_URL):
            try:
                response = http.post(url, json=body, headers={"Content-Type": "application/json"})
                if response.status_code in {404, 405, 502} and url == AUTH_URL:
                    last_error = f"Arrow authentication returned HTTP {response.status_code}"
                    continue
                response.raise_for_status()
                data = _data(response.json())
                token = str(data.get("token") or data.get("accessToken") or "").strip()
                if not token:
                    raise RuntimeError("Arrow token exchange did not return an access token")
                return {
                    "access_token": token,
                    "user_id": str(data.get("userID") or data.get("userId") or ""),
                    "name": data.get("name"),
                    "raw": data,
                }, None
            except (httpx.HTTPError, RuntimeError, ValueError) as exc:
                last_error = str(exc)
                if url == SDK_AUTH_URL:
                    break
        return None, last_error
    finally:
        if owns_client:
            http.close()


def auto_login(
    *,
    app_id: str,
    app_secret: str,
    user_id: str,
    password: str,
    totp: str,
    client: httpx.Client | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """SDK-compatible opt-in login. Arrow does not document a general refresh token."""
    http = client or httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))
    owns_client = client is None
    try:
        first = http.post(
            WEB_LOGIN_URL,
            json={"userID": user_id, "password": password, "appID": app_id, "isAppLogin": True},
        )
        first.raise_for_status()
        login_data = _data(first.json())
        request_id = str(login_data.get("requestId") or login_data.get("requestID") or "")
        if not request_id:
            return None, "Arrow automated login did not return a request ID"
        second = http.post(
            WEB_2FA_URL,
            json={"requestId": request_id, "totp": totp, "otp": totp, "appID": app_id},
        )
        second.raise_for_status()
        two_factor = _data(second.json())
        redirect_url = str(two_factor.get("redirectUrl") or two_factor.get("redirectURL") or "")
        from urllib.parse import parse_qs, urlparse

        request_token = (parse_qs(urlparse(redirect_url).query).get("request-token") or [""])[0]
        if not request_token:
            return None, "Arrow automated login did not return a request-token"
        return exchange_request_token(
            app_id=app_id,
            app_secret=app_secret,
            request_token=request_token,
            client=http,
        )
    except (httpx.HTTPError, RuntimeError, ValueError) as exc:
        return None, str(exc)
    finally:
        if owns_client:
            http.close()
