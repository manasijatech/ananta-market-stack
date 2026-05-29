from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, time, timedelta, timezone

from common.datetime_compat import UTC
import pyotp
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.broker import (
    BrokerSessionStatusOut,
    SessionGrowwIn,
    SessionStartOut,
    SessionUpstoxRequestOut,
    SessionZerodhaRefreshOut,
)
from broker.angel import auth as angel_auth
from broker.crypto import decrypt_value, encrypt_value
from broker.dhan import auth as dhan_auth
from broker.groww import auth as groww_auth
from broker.kotak import auth as kotak_auth
from broker.upstox import auth as upstox_auth
from broker.zerodha import auth as zerodha_auth
from db.models import BrokerAccount, BrokerNotification
from db.session import SessionLocal

IST = timezone(timedelta(hours=5, minutes=30))
MAINTENANCE_TIME_IST = time(hour=6, minute=30)
INSTRUMENT_SYNC_TIME_IST = time(hour=8, minute=30)
_last_maintenance_date: date | None = None
_last_instrument_sync_date: date | None = None
_settings = get_settings()


def _now_utc() -> datetime:
    return datetime.now(tz=UTC)


def _today_ist() -> date:
    return datetime.now(tz=IST).date()


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _is_active(expires_at: datetime | None) -> bool:
    normalized = _as_utc(expires_at)
    return normalized is None or normalized > _now_utc()


def _totp(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def _next_groww_expiry_utc(now: datetime | None = None) -> datetime:
    base = now or _now_utc()
    now_ist = base.astimezone(IST)
    expiry_ist = now_ist.replace(hour=6, minute=0, second=0, microsecond=0)
    if now_ist >= expiry_ist:
        expiry_ist = expiry_ist + timedelta(days=1)
    return expiry_ist.astimezone(UTC)


def _public_app_url(path: str) -> str | None:
    base = (
        _settings.market_stack_public_app_url
        or _settings.next_public_app_url
        or _settings.app_public_base_url
        or ""
    ).rstrip("/")
    if not base:
        return None
    return f"{base}{path}"


def _set_session_state(
    acc: BrokerAccount,
    *,
    status: str,
    expires_at: datetime | None,
    error: str | None = None,
) -> None:
    acc.session_status = status
    acc.session_expires_at = expires_at
    acc.last_error = error


SESSION_NOTIFICATION_KINDS = ("session_action_required", "session_refresh_failed")


def mark_session_healthy(
    db: Session,
    acc: BrokerAccount,
    *,
    verified_at: datetime | None = None,
) -> None:
    """Record a successful broker session and retire stale session warnings."""
    acc.last_verified_at = (verified_at or _now_utc()).replace(tzinfo=None)
    acc.last_error = None
    if not acc.session_status or acc.session_status in {"pending", "action_required", "automation_ready"}:
        acc.session_status = "active"
    db.execute(
        update(BrokerNotification)
        .where(
            BrokerNotification.user_id == acc.user_id,
            BrokerNotification.account_id == acc.id,
            BrokerNotification.kind.in_(SESSION_NOTIFICATION_KINDS),
            BrokerNotification.is_read.is_(False),
        )
        .values(is_read=True)
    )


def _create_notification_once_per_day(
    db: Session,
    *,
    user_id: str,
    account_id: str | None,
    broker_code: str | None,
    kind: str,
    title: str,
    message: str,
    level: str = "info",
) -> None:
    day_start = datetime.combine(_today_ist(), time.min, tzinfo=IST).astimezone(UTC)
    day_end = day_start + timedelta(days=1)
    q = select(BrokerNotification).where(
        BrokerNotification.user_id == user_id,
        BrokerNotification.account_id == account_id,
        BrokerNotification.kind == kind,
        BrokerNotification.created_at >= day_start,
        BrokerNotification.created_at < day_end,
    )
    if db.scalars(q).first():
        return
    db.add(
        BrokerNotification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            account_id=account_id,
            broker_code=broker_code,
            kind=kind,
            title=title,
            message=message,
            level=level,
        )
    )


def list_notifications(db: Session, user_id: str) -> list[BrokerNotification]:
    active_accounts = list(
        db.scalars(
            select(BrokerAccount).where(
                BrokerAccount.user_id == user_id,
                BrokerAccount.is_active.is_(True),
                BrokerAccount.session_status == "active",
            )
        ).all()
    )
    for acc in active_accounts:
        if _is_active(acc.session_expires_at):
            mark_session_healthy(db, acc, verified_at=acc.last_verified_at)
            db.add(acc)
    if active_accounts:
        db.commit()
    q = (
        select(BrokerNotification)
        .where(BrokerNotification.user_id == user_id)
        .order_by(BrokerNotification.created_at.desc())
    )
    return list(db.scalars(q).all())


def mark_notification_read(db: Session, user_id: str, notification_id: str) -> BrokerNotification | None:
    row = db.get(BrokerNotification, notification_id)
    if not row or row.user_id != user_id:
        return None
    row.is_read = True
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_broker_session_status(acc: BrokerAccount) -> BrokerSessionStatusOut:
    code = acc.broker_code
    if code == "zerodha":
        row = acc.zerodha
        if not row:
            raise ValueError("missing zerodha credentials")
        api_key = decrypt_value(row.api_key_cipher)
        access_token = decrypt_value(row.access_token_cipher)
        generated_at = row.access_token_generated_at
        expires_at = zerodha_auth.session_expiry_utc(generated_at) if generated_at else None
        active = bool(access_token) and zerodha_auth.is_session_active(generated_at)
        return BrokerSessionStatusOut(
            broker=code,
            account_id=acc.id,
            session_active=active,
            automation_supported=True,
            automation_enabled=acc.automation_enabled,
            automation_mode=acc.automation_mode,
            login_url=zerodha_auth.build_login_url(api_key, state=acc.id),
            has_access_token=bool(access_token),
            token_generated_at=generated_at,
            token_expires_at=expires_at,
            fields_required=[] if acc.automation_enabled else ["request_token"],
            guidance=(
                "Official flow: use the Zerodha login URL, capture the request_token from the "
                "redirect, then call POST /sessions/zerodha. Optional experimental automation "
                "can use stored user_id + password + TOTP secret to obtain the request_token "
                "through Zerodha's web login endpoints."
            ),
        )

    if code == "upstox":
        row = acc.upstox
        if not row:
            raise ValueError("missing upstox credentials")
        api_key = decrypt_value(row.api_key_cipher)
        redirect_uri = decrypt_value(row.redirect_uri_cipher)
        access_token = decrypt_value(row.access_token_cipher)
        generated_at = row.access_token_generated_at
        return BrokerSessionStatusOut(
            broker=code,
            account_id=acc.id,
            session_active=bool(access_token),
            automation_supported=True,
            automation_enabled=acc.automation_enabled,
            automation_mode=acc.automation_mode,
            login_url=upstox_auth.build_login_url(
                api_key=api_key,
                redirect_uri=redirect_uri,
                state=acc.id,
            ),
            has_access_token=bool(access_token),
            token_generated_at=generated_at,
            token_expires_at=acc.session_expires_at,
            fields_required=["authorization_code"],
            guidance=(
                "Upstox uses OAuth 2.0 and requires the user to log in on upstox.com. "
                "Use the login_url, capture the authorization code from the redirect, "
                "then call POST /sessions/upstox. Upstox also supports an official "
                "semi-automated token-request flow that delivers the token to a configured "
                "notifier webhook after the user approves it in Upstox."
            ),
        )

    if code == "dhan":
        row = acc.dhan
        if not row:
            raise ValueError("missing dhan credentials")
        access_token = decrypt_value(row.access_token_cipher)
        can_auto = bool(row.pin_cipher and row.totp_secret_cipher)
        guidance = (
            "Manual flow: generate tokenId via Dhan consent login and call POST /sessions/dhan. "
            "Official automation is available if client_id, pin, and totp_secret are stored."
        )
        return BrokerSessionStatusOut(
            broker=code,
            account_id=acc.id,
            session_active=bool(access_token) and _is_active(row.access_token_expires_at),
            automation_supported=True,
            automation_enabled=acc.automation_enabled,
            automation_mode=acc.automation_mode,
            has_access_token=bool(access_token),
            token_generated_at=row.access_token_generated_at,
            token_expires_at=row.access_token_expires_at,
            fields_required=["token_id"] if not can_auto else [],
            guidance=guidance,
        )

    if code == "angel":
        row = acc.angel
        if not row:
            raise ValueError("missing angel credentials")
        jwt_token = decrypt_value(row.jwt_token_cipher)
        return BrokerSessionStatusOut(
            broker=code,
            account_id=acc.id,
            session_active=bool(jwt_token) and _is_active(acc.session_expires_at),
            automation_supported=True,
            automation_enabled=acc.automation_enabled,
            automation_mode=acc.automation_mode,
            has_access_token=bool(jwt_token),
            token_generated_at=row.jwt_token_generated_at,
            token_expires_at=acc.session_expires_at,
            fields_required=["client_code", "pin", "totp"] if not row.totp_secret_cipher else [],
            guidance=(
                "SmartAPI sessions require login-based token regeneration. Manual refresh uses "
                "POST /sessions/angel. If pin and totp_secret are stored, the backend can "
                "attempt daily automated regeneration."
            ),
        )

    if code == "groww":
        row = acc.groww
        if not row:
            raise ValueError("missing groww credentials")
        access_token = decrypt_value(row.access_token_cipher)
        api_key = decrypt_value(row.api_key_cipher).strip()
        api_secret = decrypt_value(row.api_secret_cipher).strip()
        has_approval_flow = bool(api_key and api_secret)
        has_totp_flow = bool(row.totp_token_cipher and row.totp_secret_cipher)
        if has_totp_flow:
            guidance = (
                "Groww TOTP mode is configured. The backend can refresh using totp_token + "
                "totp_secret (manual or automated)."
            )
        elif has_approval_flow:
            guidance = (
                "Groww approval mode is configured. The backend can refresh access tokens "
                "using api_key + api_secret."
            )
        else:
            guidance = (
                "Groww session is manual right now. Configure either api_key + api_secret "
                "(approval mode) or totp_token + totp_secret (TOTP mode) for automated refresh."
            )
        return BrokerSessionStatusOut(
            broker=code,
            account_id=acc.id,
            session_active=bool(access_token) and _is_active(row.access_token_expires_at),
            automation_supported=True,
            automation_enabled=has_totp_flow or has_approval_flow,
            automation_mode=acc.automation_mode,
            has_access_token=bool(access_token),
            token_generated_at=row.access_token_generated_at,
            token_expires_at=row.access_token_expires_at,
            fields_required=[]
            if (has_totp_flow or has_approval_flow)
            else ["access_token or api_key+api_secret or totp_token+totp_secret"],
            guidance=guidance,
        )

    if code == "indmoney":
        row = acc.indmoney
        if not row:
            raise ValueError("missing indmoney credentials")
        access_token = decrypt_value(row.access_token_cipher)
        return BrokerSessionStatusOut(
            broker=code,
            account_id=acc.id,
            session_active=bool(access_token) and _is_active(row.access_token_expires_at),
            automation_supported=False,
            automation_enabled=False,
            has_access_token=bool(access_token),
            token_generated_at=row.access_token_generated_at,
            token_expires_at=row.access_token_expires_at,
            fields_required=["access_token"],
            guidance=(
                "INDmoney remains a manual portal token flow with IP whitelisting requirements. "
                "When the token expires, prompt the user to generate a new token from the "
                "broker portal and submit it through POST /sessions/indmoney."
            ),
        )

    if code == "kotak":
        row = acc.kotak
        if not row:
            raise ValueError("missing kotak credentials")
        has_session = bool(row.session_bundle_cipher and decrypt_value(row.session_bundle_cipher))
        return BrokerSessionStatusOut(
            broker=code,
            account_id=acc.id,
            session_active=has_session and _is_active(acc.session_expires_at),
            automation_supported=True,
            automation_enabled=acc.automation_enabled,
            automation_mode=acc.automation_mode,
            has_access_token=has_session,
            token_generated_at=row.session_bundle_generated_at,
            token_expires_at=acc.session_expires_at,
            fields_required=["mobile_number", "totp", "mpin"] if not row.totp_secret_cipher else [],
            guidance=(
                "Kotak Neo needs the portal consumer token plus a TOTP + MPIN trade session. "
                "Manual refresh uses POST /sessions/kotak. If mobile_number, mpin, and "
                "totp_secret are stored, the backend can rebuild the session automatically."
            ),
        )

    raise ValueError(f"unsupported broker {code}")


def refresh_dhan_session(db: Session, acc: BrokerAccount) -> tuple[bool, str]:
    row = acc.dhan
    if not row:
        return False, "missing dhan credentials"
    now = _now_utc()
    access_token = decrypt_value(row.access_token_cipher)

    if acc.automation_enabled and row.pin_cipher and row.totp_secret_cipher:
        payload, err = dhan_auth.generate_access_token_with_totp(
            client_id=decrypt_value(row.client_id_cipher),
            pin=decrypt_value(row.pin_cipher),
            totp=_totp(decrypt_value(row.totp_secret_cipher)),
        )
        if err or not payload:
            return False, err or "failed"
        row.access_token_cipher = encrypt_value(payload["access_token"])
        row.access_token_generated_at = now
        row.access_token_expires_at = dhan_auth.parse_expiry(payload.get("expiry_time")) or dhan_auth.default_expiry_from_now()
        _set_session_state(acc, status="active", expires_at=row.access_token_expires_at, error=None)
        mark_session_healthy(db, acc, verified_at=now)
    elif access_token:
        payload, err = dhan_auth.renew_access_token(
            access_token=access_token,
            client_id=decrypt_value(row.client_id_cipher),
        )
        if err or not payload:
            return False, err or "failed"
        row.access_token_cipher = encrypt_value(payload["access_token"])
        row.access_token_generated_at = now
        row.access_token_expires_at = dhan_auth.parse_expiry(payload.get("expiry_time")) or dhan_auth.default_expiry_from_now()
        _set_session_state(acc, status="active", expires_at=row.access_token_expires_at, error=None)
        mark_session_healthy(db, acc, verified_at=now)
    else:
        return False, "no stored Dhan access token or automation credentials"

    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def refresh_zerodha_session_experimental(db: Session, acc: BrokerAccount) -> tuple[SessionZerodhaRefreshOut | None, str | None]:
    row = acc.zerodha
    if not row or not row.login_user_id_cipher or not row.login_password_cipher or not row.totp_secret_cipher:
        return None, "experimental Zerodha automation needs login_user_id, login_password, and totp_secret"
    try:
        totp_value = zerodha_auth.generate_totp(decrypt_value(row.totp_secret_cipher))
    except Exception as exc:
        return None, f"invalid zerodha totp_secret: {exc}"
    request_token, err = zerodha_auth.fetch_request_token_with_web_login(
        api_key=decrypt_value(row.api_key_cipher),
        user_id=decrypt_value(row.login_user_id_cipher),
        password=decrypt_value(row.login_password_cipher),
        totp_value=totp_value,
    )
    if err or not request_token:
        return None, err or "failed to get request_token"
    ok, err = __import__("app.services.broker_accounts", fromlist=["apply_zerodha_session"]).apply_zerodha_session(
        db, acc, request_token
    )
    if not ok:
        return None, err or "failed to exchange request_token"
    refreshed = db.get(BrokerAccount, acc.id)
    if not refreshed or not refreshed.zerodha or not refreshed.zerodha.access_token_generated_at:
        return None, "session exchange did not persist correctly"
    generated_at = refreshed.zerodha.access_token_generated_at
    return SessionZerodhaRefreshOut(
        request_token=request_token,
        access_token_generated_at=generated_at,
        access_token_expires_at=zerodha_auth.session_expiry_utc(generated_at),
        guidance=(
            "This flow is experimental and relies on Zerodha web-login endpoints rather than "
            "the official Kite Connect redirect flow."
        ),
    ), None


def request_upstox_access_token(db: Session, acc: BrokerAccount) -> tuple[SessionUpstoxRequestOut | None, str | None]:
    row = acc.upstox
    if not row:
        return None, "missing upstox credentials"
    payload, err = upstox_auth.request_access_token(
        api_key=decrypt_value(row.api_key_cipher),
        api_secret=decrypt_value(row.api_secret_cipher),
    )
    if err or not payload:
        return None, err or "failed"
    expiry_raw = payload.get("token_request_expires_at")
    token_request_expires_at = None
    if expiry_raw:
        try:
            token_request_expires_at = datetime.fromisoformat(expiry_raw.replace("Z", "+00:00"))
            if token_request_expires_at.tzinfo is None:
                token_request_expires_at = token_request_expires_at.replace(tzinfo=UTC)
            else:
                token_request_expires_at = token_request_expires_at.astimezone(UTC)
        except ValueError:
            token_request_expires_at = None
    row.token_request_expires_at = token_request_expires_at
    db.add(row)
    db.commit()
    notifier_url = _public_app_url("/api/broker-callbacks/upstox/notifier")
    return SessionUpstoxRequestOut(
        account_id=acc.id,
        token_request_expires_at=token_request_expires_at,
        notifier_url=notifier_url or payload.get("notifier_url"),
        guidance=(
            "This is Upstox's official semi-automated flow. The user approves the token "
            "request in Upstox, and Upstox sends the token to the configured notifier webhook."
        ),
    ), None


def consume_upstox_notifier(db: Session, payload: dict) -> tuple[bool, str]:
    access_token = str(payload.get("access_token") or payload.get("token") or "").strip()
    extended_token = str(payload.get("extended_token") or "").strip()
    api_key = str(payload.get("client_id") or payload.get("api_key") or "").strip()
    user_id = str(payload.get("user_id") or "").strip()
    if not access_token:
        return False, "missing access_token in Upstox notifier payload"
    q = select(BrokerAccount).where(BrokerAccount.broker_code == "upstox")
    accounts = list(db.scalars(q).all())
    matched = None
    for acc in accounts:
        row = acc.upstox
        if not row:
            continue
        if decrypt_value(row.api_key_cipher) != api_key:
            continue
        if row.session_user_id_cipher and user_id and decrypt_value(row.session_user_id_cipher) != user_id:
            continue
        matched = acc
        break
    if matched is None:
        return False, "no matching Upstox account found for notifier payload"
    row = matched.upstox
    if row is None:
        return False, "missing upstox credentials"
    now = _now_utc()
    row.access_token_cipher = encrypt_value(access_token)
    row.access_token_generated_at = now
    row.extended_token_cipher = encrypt_value(extended_token) if extended_token else None
    row.session_user_id_cipher = encrypt_value(user_id) if user_id else row.session_user_id_cipher
    matched.session_status = "active"
    mark_session_healthy(db, matched, verified_at=now)
    db.add(row)
    db.add(matched)
    db.commit()
    return True, ""


def start_dhan_consent(acc: BrokerAccount) -> SessionStartOut:
    row = acc.dhan
    if not row:
        raise ValueError("missing dhan credentials")
    consent_app_id, err = dhan_auth.generate_consent(
        app_id=decrypt_value(row.app_id_cipher),
        app_secret=decrypt_value(row.app_secret_cipher),
        client_id=decrypt_value(row.client_id_cipher),
    )
    if err or not consent_app_id:
        raise ValueError(err or "failed to generate Dhan consent")
    return SessionStartOut(
        account_id=acc.id,
        broker="dhan",
        login_url=dhan_auth.build_consent_login_url(consent_app_id),
        state=consent_app_id,
        guidance=(
            "Open the login_url in the browser, let the user complete Dhan login and 2FA, "
            "capture the tokenId from the redirect, then call POST /sessions/dhan."
        ),
    )


def refresh_angel_session(db: Session, acc: BrokerAccount) -> tuple[bool, str]:
    row = acc.angel
    if not row or not row.pin_cipher or not row.totp_secret_cipher:
        return False, "angel automation needs pin and totp_secret"
    jwt_t, feed, err = angel_auth.login(
        api_key=decrypt_value(row.api_key_cipher),
        client_code=decrypt_value(row.client_code_cipher),
        pin=decrypt_value(row.pin_cipher),
        totp=_totp(decrypt_value(row.totp_secret_cipher)),
    )
    if err or not jwt_t:
        return False, err or "failed"
    now = _now_utc()
    row.jwt_token_cipher = encrypt_value(jwt_t)
    row.feed_token_cipher = encrypt_value(feed) if feed else None
    row.jwt_token_generated_at = now
    expires_at = now + timedelta(hours=24)
    _set_session_state(acc, status="active", expires_at=expires_at, error=None)
    mark_session_healthy(db, acc, verified_at=now)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def refresh_groww_session(
    db: Session,
    acc: BrokerAccount,
    body: SessionGrowwIn | None = None,
) -> tuple[bool, str]:
    row = acc.groww
    if not row:
        return False, "missing groww credentials"
    approval_api_key = decrypt_value(row.api_key_cipher).strip()
    approval_api_secret = decrypt_value(row.api_secret_cipher).strip()

    token: str | None = None
    err: str | None = None
    if body and body.access_token:
        token = body.access_token.strip()
    elif body and body.totp:
        if not row.totp_token_cipher:
            return False, "missing stored Groww totp_token"
        token, err = groww_auth.access_token_from_totp(
            totp_token=decrypt_value(row.totp_token_cipher),
            totp=body.totp.strip(),
        )
    elif acc.automation_enabled and row.totp_token_cipher and row.totp_secret_cipher:
        token, err = groww_auth.access_token_from_totp(
            totp_token=decrypt_value(row.totp_token_cipher),
            totp=_totp(decrypt_value(row.totp_secret_cipher)),
        )
    elif approval_api_key and approval_api_secret:
        token, err = groww_auth.refresh_access_token(
            api_key=approval_api_key,
            api_secret=approval_api_secret,
        )
    if err or not token:
        return False, err or "failed"

    now = _now_utc()
    expires_at = _next_groww_expiry_utc(now)
    row.access_token_cipher = encrypt_value(token)
    row.access_token_generated_at = now
    row.access_token_expires_at = expires_at
    _set_session_state(acc, status="active", expires_at=expires_at, error=None)
    mark_session_healthy(db, acc, verified_at=now)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def refresh_kotak_session(db: Session, acc: BrokerAccount) -> tuple[bool, str]:
    row = acc.kotak
    if not row or not row.mobile_number_cipher or not row.mpin_cipher or not row.totp_secret_cipher:
        return False, "kotak automation needs mobile_number, mpin, and totp_secret"
    bundle, err = kotak_auth.totp_mpin_session(
        ucc=decrypt_value(row.ucc_cipher),
        portal_access_token=decrypt_value(row.portal_access_token_cipher),
        mobile_number=decrypt_value(row.mobile_number_cipher),
        totp=_totp(decrypt_value(row.totp_secret_cipher)),
        mpin=decrypt_value(row.mpin_cipher),
    )
    if err or not bundle:
        return False, err or "failed"
    now = _now_utc()
    row.session_bundle_cipher = encrypt_value(bundle)
    row.session_bundle_generated_at = now
    expires_at = now + timedelta(hours=24)
    _set_session_state(acc, status="active", expires_at=expires_at, error=None)
    mark_session_healthy(db, acc, verified_at=now)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def update_indmoney_access_token(db: Session, acc: BrokerAccount, access_token: str) -> tuple[bool, str]:
    row = acc.indmoney
    if not row:
        return False, "missing indmoney credentials"
    now = _now_utc()
    expires_at = now + timedelta(hours=24)
    row.access_token_cipher = encrypt_value(access_token)
    row.access_token_generated_at = now
    row.access_token_expires_at = expires_at
    _set_session_state(acc, status="active", expires_at=expires_at, error=None)
    mark_session_healthy(db, acc, verified_at=now)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def process_account_maintenance(db: Session, acc: BrokerAccount) -> None:
    code = acc.broker_code
    if code == "zerodha":
        status = get_broker_session_status(acc)
        if not status.session_active and acc.automation_enabled:
            refreshed, err = refresh_zerodha_session_experimental(db, acc)
            if refreshed is not None:
                return
            _set_session_state(acc, status="action_required", expires_at=status.token_expires_at, error=err)
            _create_notification_once_per_day(
                db,
                user_id=acc.user_id,
                account_id=acc.id,
                broker_code=code,
                kind="session_refresh_failed",
                title=f"{acc.label}: Zerodha experimental refresh failed",
                message=err or status.guidance,
                level="warning",
            )
        elif not status.session_active:
            _set_session_state(acc, status="action_required", expires_at=status.token_expires_at, error=status.guidance)
            _create_notification_once_per_day(
                db,
                user_id=acc.user_id,
                account_id=acc.id,
                broker_code=code,
                kind="session_action_required",
                title=f"{acc.label}: Zerodha login required",
                message=status.guidance,
                level="warning",
            )
        db.add(acc)
        db.commit()
        return

    if code == "upstox":
        status = get_broker_session_status(acc)
        if not status.session_active:
            _set_session_state(acc, status="action_required", expires_at=status.token_expires_at, error=status.guidance)
            _create_notification_once_per_day(
                db,
                user_id=acc.user_id,
                account_id=acc.id,
                broker_code=code,
                kind="session_action_required",
                title=f"{acc.label}: Upstox login required",
                message=(
                    f"{status.guidance} You can also use the official semi-automated "
                    "token-request endpoint to ask the user for in-app approval."
                ),
                level="warning",
            )
        db.add(acc)
        db.commit()
        return

    if code == "indmoney":
        status = get_broker_session_status(acc)
        if not status.session_active:
            _set_session_state(acc, status="action_required", expires_at=status.token_expires_at, error=status.guidance)
            _create_notification_once_per_day(
                db,
                user_id=acc.user_id,
                account_id=acc.id,
                broker_code=code,
                kind="session_action_required",
                title=f"{acc.label}: INDmoney token update required",
                message=status.guidance,
                level="warning",
            )
        db.add(acc)
        db.commit()
        return

    refreshers = {
        "dhan": refresh_dhan_session,
        "angel": refresh_angel_session,
        "groww": lambda inner_db, inner_acc: refresh_groww_session(inner_db, inner_acc, None),
        "kotak": refresh_kotak_session,
    }
    refresher = refreshers.get(code)
    if refresher is None:
        return
    ok, msg = refresher(db, acc)
    if not ok:
        _set_session_state(acc, status="action_required", expires_at=acc.session_expires_at, error=msg)
        _create_notification_once_per_day(
            db,
            user_id=acc.user_id,
            account_id=acc.id,
            broker_code=code,
            kind="session_refresh_failed",
            title=f"{acc.label}: {code} session refresh failed",
            message=msg,
            level="warning",
        )
        db.add(acc)
        db.commit()


def run_daily_maintenance_once() -> None:
    global _last_maintenance_date
    now_ist = datetime.now(tz=IST)
    if now_ist.time() < MAINTENANCE_TIME_IST:
        return
    if _last_maintenance_date == now_ist.date():
        return
    db = SessionLocal()
    try:
        accounts = list(db.scalars(select(BrokerAccount).where(BrokerAccount.is_active.is_(True))).all())
        for acc in accounts:
            process_account_maintenance(db, acc)
        _last_maintenance_date = now_ist.date()
    finally:
        db.close()


def run_daily_instrument_sync_once() -> None:
    global _last_instrument_sync_date
    now_ist = datetime.now(tz=IST)
    if now_ist.time() < INSTRUMENT_SYNC_TIME_IST:
        return
    if _last_instrument_sync_date == now_ist.date():
        return
    from app.services import broker_data

    db = SessionLocal()
    try:
        accounts = list(db.scalars(select(BrokerAccount).where(BrokerAccount.is_active.is_(True))).all())
        processed_brokers: set[str] = set()
        for acc in accounts:
            if acc.broker_code in processed_brokers:
                continue
            processed_brokers.add(acc.broker_code)
            result = broker_data.sync_instruments_to_csv(db, acc)
            if result.sync_status not in {"completed", "preserved"}:
                _create_notification_once_per_day(
                    db,
                    user_id=acc.user_id,
                    account_id=acc.id,
                    broker_code=acc.broker_code,
                    kind="instrument_sync_failed",
                    title=f"{acc.label}: instrument sync failed",
                    message=result.error or "instrument sync failed",
                    level="warning",
                )
        _last_instrument_sync_date = now_ist.date()
    finally:
        db.close()


def run_user_maintenance(db: Session, user_id: str) -> int:
    accounts = list(
        db.scalars(
            select(BrokerAccount).where(
                BrokerAccount.user_id == user_id,
                BrokerAccount.is_active.is_(True),
            )
        ).all()
    )
    for acc in accounts:
        process_account_maintenance(db, acc)
    return len(accounts)


async def maintenance_loop(stop_event: asyncio.Event) -> None:
    initial_cycle = True
    while not stop_event.is_set():
        try:
            from app.services import system_maintenance

            system_maintenance.run_scheduled_maintenance_once()
        except Exception:
            pass
        try:
            run_daily_maintenance_once()
        except Exception:
            pass
        try:
            run_daily_instrument_sync_once()
        except Exception:
            pass
        try:
            from app.services import broker_data_preferences

            broker_data_preferences.run_holdings_refresh_cycle(force=initial_cycle)
        except Exception:
            pass
        try:
            from app.services.alerts_engine.reconcile import reconcile_all_users

            db = SessionLocal()
            try:
                reconcile_all_users(db)
            finally:
                db.close()
        except Exception:
            pass
        initial_cycle = False
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=300)
        except asyncio.TimeoutError:
            continue
