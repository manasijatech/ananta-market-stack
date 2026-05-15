from __future__ import annotations

from datetime import datetime, timedelta

from common.datetime_compat import UTC
from broker.core.http import get_httpx_client


def generate_access_token_with_totp(
    *, client_id: str, pin: str, totp: str
) -> tuple[dict[str, str] | None, str | None]:
    r = get_httpx_client().post(
        "https://auth.dhan.co/app/generateAccessToken",
        params={"dhanClientId": client_id, "pin": pin, "totp": totp},
    )
    if r.status_code != 200:
        return None, r.text[:500]
    body = r.json()
    tok = body.get("accessToken")
    if not tok:
        return None, str(body)
    return {
        "access_token": tok,
        "expiry_time": body.get("expiryTime", "") or "",
    }, None


def renew_access_token(*, access_token: str, client_id: str) -> tuple[dict[str, str] | None, str | None]:
    r = get_httpx_client().post(
        "https://api.dhan.co/v2/RenewToken",
        headers={"access-token": access_token, "dhanClientId": client_id},
    )
    if r.status_code != 200:
        return None, r.text[:500]
    body = r.json()
    tok = body.get("accessToken")
    if not tok:
        return None, str(body)
    return {
        "access_token": tok,
        "expiry_time": body.get("expiryTime", "") or "",
    }, None


def generate_consent(*, app_id: str, app_secret: str, client_id: str) -> tuple[str | None, str | None]:
    r = get_httpx_client().post(
        "https://auth.dhan.co/app/generate-consent",
        headers={"app_id": app_id, "app_secret": app_secret},
        params={"client_id": client_id},
    )
    if r.status_code != 200:
        return None, r.text[:500]
    body = r.json()
    consent_id = body.get("consentAppId")
    return (consent_id, None) if consent_id else (None, str(body))


def build_consent_login_url(consent_app_id: str) -> str:
    return f"https://auth.dhan.co/login/consentApp-login?consentAppId={consent_app_id}"


def parse_expiry(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def default_expiry_from_now(hours: int = 24) -> datetime:
    return datetime.now(tz=UTC) + timedelta(hours=hours)


def consume_consent(*, app_id: str, app_secret: str, token_id: str) -> tuple[str | None, str | None]:
    headers = {
        "app_id": app_id,
        "app_secret": app_secret,
        "Content-Type": "application/json",
    }
    r = get_httpx_client().post(
        "https://auth.dhan.co/app/consumeApp-consent",
        headers=headers,
        params={"tokenId": token_id},
    )
    if r.status_code != 200:
        return None, r.text[:500]
    body = r.json()
    tok = body.get("accessToken")
    return (tok, None) if tok else (None, str(body))
