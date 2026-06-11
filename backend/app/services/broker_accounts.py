from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from common.datetime_compat import UTC
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.schemas.broker import (
    AngelCreate,
    BrokerAccountCreate,
    DhanCreate,
    GrowwCreate,
    IndmoneyCreate,
    InstrumentRef,
    KotakCreate,
    QuoteRow,
    UpstoxCreate,
    ZerodhaCreate,
    ZerodhaSessionStatusOut,
)
from broker.core.instrument_store import SQLiteInstrumentResolver
from broker.angel import auth as angel_auth
from broker.core.redis_cache import cache_quotes
from broker.core.registry import get_client_for_account
from broker.crypto import decrypt_value, encrypt_value
from broker.dhan import auth as dhan_auth
from broker.groww import auth as groww_auth
from broker.kotak import auth as kotak_auth
from broker.upstox import auth as upstox_auth
from broker.zerodha import auth as zerodha_auth
from db.models import (
    AngelCredentials,
    AlertWorkflow,
    BrokerAccount,
    BrokerNotification,
    DhanCredentials,
    GrowwCredentials,
    IndmoneyCredentials,
    KotakCredentials,
    LiveSymbolSubscription,
    UpstoxCredentials,
    User,
    UserAlertNotification,
    UserBrokerDataPreference,
    ZerodhaCredentials,
)

IST = timezone(timedelta(hours=5, minutes=30))


def _next_groww_expiry_utc(now: datetime) -> datetime:
    now_ist = now.astimezone(IST)
    expiry_ist = now_ist.replace(hour=6, minute=0, second=0, microsecond=0)
    if now_ist >= expiry_ist:
        expiry_ist = expiry_ist + timedelta(days=1)
    return expiry_ist.astimezone(UTC)


def _mark_session_healthy(db: Session, acc: BrokerAccount, *, verified_at: datetime | None = None) -> None:
    from app.services.broker_sessions import mark_session_healthy

    mark_session_healthy(db, acc, verified_at=verified_at)


def create_broker_account(
    db: Session,
    user_id: str,
    payload: BrokerAccountCreate,
    *,
    workspace_id: str | None = None,
) -> BrokerAccount:
    if not db.get(User, user_id):
        raise ValueError("user not found")
    bid = str(uuid.uuid4())
    acc = BrokerAccount(
        id=bid,
        workspace_id=workspace_id,
        user_id=user_id,
        broker_code=payload.broker,
        label=payload.label,
        session_status="pending",
    )
    db.add(acc)
    db.flush()

    if isinstance(payload, ZerodhaCreate):
        token = (payload.access_token or "").strip()
        db.add(
            ZerodhaCredentials(
                account_id=bid,
                api_key_cipher=encrypt_value(payload.api_key),
                api_secret_cipher=encrypt_value(payload.api_secret),
                access_token_cipher=encrypt_value(token),
                access_token_generated_at=datetime.now(tz=UTC) if token else None,
                login_user_id_cipher=encrypt_value(payload.login_user_id)
                if payload.login_user_id
                else None,
                login_password_cipher=encrypt_value(payload.login_password)
                if payload.login_password
                else None,
                totp_secret_cipher=encrypt_value(payload.totp_secret)
                if payload.totp_secret
                else None,
            )
        )
        acc.automation_enabled = bool(
            payload.login_user_id and payload.login_password and payload.totp_secret
        )
        acc.automation_mode = "zerodha_web_login_experimental" if acc.automation_enabled else None
        if not token:
            acc.last_error = (
                "Zerodha session not established yet. Complete the login flow and exchange "
                "the returned request_token via /api/v1/broker-accounts/"
                f"{bid}/sessions/zerodha."
            )
    elif isinstance(payload, UpstoxCreate):
        token = (payload.access_token or "").strip()
        db.add(
            UpstoxCredentials(
                account_id=bid,
                api_key_cipher=encrypt_value(payload.api_key),
                api_secret_cipher=encrypt_value(payload.api_secret),
                redirect_uri_cipher=encrypt_value(payload.redirect_uri),
                access_token_cipher=encrypt_value(token),
                access_token_generated_at=datetime.now(tz=UTC) if token else None,
                extended_token_cipher=encrypt_value(payload.extended_token)
                if payload.extended_token
                else None,
            )
        )
        acc.last_error = (
            None
            if token
            else "Upstox session not established yet. Use the Upstox OAuth login flow and POST the authorization_code to the session endpoint."
        )
    elif isinstance(payload, AngelCreate):
        jwt_token = (payload.jwt_token or "").strip()
        db.add(
            AngelCredentials(
                account_id=bid,
                api_key_cipher=encrypt_value(payload.api_key),
                client_code_cipher=encrypt_value(payload.client_code),
                pin_cipher=encrypt_value(payload.pin) if payload.pin else None,
                jwt_token_cipher=encrypt_value(jwt_token),
                feed_token_cipher=encrypt_value(payload.feed_token)
                if payload.feed_token
                else None,
                totp_secret_cipher=encrypt_value(payload.totp_secret)
                if payload.totp_secret
                else None,
                jwt_token_generated_at=datetime.now(tz=UTC) if jwt_token else None,
            )
        )
        acc.automation_enabled = bool(payload.pin and payload.totp_secret)
        acc.automation_mode = "angel_totp" if acc.automation_enabled else None
    elif isinstance(payload, DhanCreate):
        token = (payload.access_token or "").strip()
        token_generated_at = datetime.now(tz=UTC) if token else None
        db.add(
            DhanCredentials(
                account_id=bid,
                app_id_cipher=encrypt_value(payload.app_id),
                app_secret_cipher=encrypt_value(payload.app_secret),
                client_id_cipher=encrypt_value(payload.client_id),
                access_token_cipher=encrypt_value(token),
                pin_cipher=encrypt_value(payload.pin) if payload.pin else None,
                totp_secret_cipher=encrypt_value(payload.totp_secret)
                if payload.totp_secret
                else None,
                access_token_generated_at=token_generated_at,
                access_token_expires_at=token_generated_at.replace(microsecond=0) + timedelta(hours=24)
                if token_generated_at
                else None,
            )
        )
        acc.automation_enabled = bool(payload.pin and payload.totp_secret)
        acc.automation_mode = "dhan_totp" if acc.automation_enabled else None
    elif isinstance(payload, GrowwCreate):
        token = (payload.access_token or "").strip()
        token_generated_at = datetime.now(tz=UTC) if token else None
        has_totp_flow = bool(payload.totp_token and payload.totp_secret)
        has_approval_flow = bool(payload.api_key and payload.api_secret)
        db.add(
            GrowwCredentials(
                account_id=bid,
                api_key_cipher=encrypt_value(payload.api_key or ""),
                api_secret_cipher=encrypt_value(payload.api_secret or ""),
                access_token_cipher=encrypt_value(token),
                totp_token_cipher=encrypt_value(payload.totp_token)
                if payload.totp_token
                else None,
                totp_secret_cipher=encrypt_value(payload.totp_secret)
                if payload.totp_secret
                else None,
                access_token_generated_at=token_generated_at,
                access_token_expires_at=_next_groww_expiry_utc(token_generated_at)
                if token_generated_at
                else None,
            )
        )
        acc.automation_enabled = has_totp_flow or has_approval_flow
        if has_totp_flow:
            acc.automation_mode = "groww_totp"
        elif has_approval_flow:
            acc.automation_mode = "groww_approval"
        else:
            acc.automation_mode = None
    elif isinstance(payload, IndmoneyCreate):
        token = (payload.access_token or "").strip()
        token_generated_at = datetime.now(tz=UTC) if token else None
        db.add(
            IndmoneyCredentials(
                account_id=bid,
                access_token_cipher=encrypt_value(token),
                access_token_generated_at=token_generated_at,
                access_token_expires_at=token_generated_at.replace(microsecond=0) + timedelta(hours=24)
                if token_generated_at
                else None,
            )
        )
        acc.last_error = (
            None
            if token
            else "INDmoney access token not provided yet. Generate it from the broker portal and POST it to the INDmoney session endpoint."
        )
    elif isinstance(payload, KotakCreate):
        db.add(
            KotakCredentials(
                account_id=bid,
                ucc_cipher=encrypt_value(payload.ucc),
                portal_access_token_cipher=encrypt_value(payload.portal_access_token),
                mobile_number_cipher=encrypt_value(payload.mobile_number)
                if payload.mobile_number
                else None,
                session_bundle_cipher=encrypt_value(payload.session_bundle)
                if payload.session_bundle
                else None,
                mpin_cipher=encrypt_value(payload.mpin) if payload.mpin else None,
                totp_secret_cipher=encrypt_value(payload.totp_secret)
                if payload.totp_secret
                else None,
                session_bundle_generated_at=datetime.now(tz=UTC) if payload.session_bundle else None,
            )
        )
        acc.automation_enabled = bool(payload.mobile_number and payload.mpin and payload.totp_secret)
        acc.automation_mode = "kotak_totp_mpin" if acc.automation_enabled else None
    else:
        raise ValueError("unsupported broker payload")

    if acc.last_error is None and acc.automation_enabled:
        acc.session_status = "automation_ready"
    elif acc.last_error is None:
        acc.session_status = "active"
    acc.session_expires_at = getattr(acc, "session_expires_at", None)

    db.commit()
    db.refresh(acc)
    return acc


def verify_account(db: Session, acc: BrokerAccount) -> tuple[bool, str]:
    prior_verified_at = acc.last_verified_at
    prior_error = acc.last_error
    try:
        client = get_client_for_account(acc)
        ok, msg = client.verify_connection()
    except Exception as e:
        ok, msg = False, str(e)
    if ok:
        _mark_session_healthy(db, acc, verified_at=datetime.now(tz=UTC))
    else:
        acc.last_error = msg[:2000] if msg else "error"
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return ok, msg


def delete_broker_account_safely(db: Session, acc: BrokerAccount) -> None:
    """Delete a broker connection without deleting user alert intent/history."""
    account_id = acc.id
    user_id = acc.user_id

    for model in (AlertWorkflow, LiveSymbolSubscription, UserAlertNotification, BrokerNotification):
        db.execute(
            update(model)
            .where(model.account_id == account_id)
            .values(account_id=None)
        )

    pref = db.get(UserBrokerDataPreference, user_id)
    if pref:
        changed = False
        if pref.preferred_search_account_id == account_id:
            pref.preferred_search_account_id = None
            changed = True
        if pref.preferred_default_account_id == account_id:
            pref.preferred_default_account_id = None
            changed = True
        if changed:
            db.add(pref)

    db.delete(acc)
    db.commit()

    try:
        from app.services.alerts_engine.reconcile import reconcile_user_subscriptions

        reconcile_user_subscriptions(db, user_id)
    except Exception:
        # Account removal should not fail if background reconciliation needs a later pass.
        pass


def fetch_quotes_for_account(
    db: Session,
    acc: BrokerAccount,
    instruments: list[InstrumentRef],
    *,
    push_redis: bool = True,
) -> list[QuoteRow]:
    client = get_client_for_account(acc, resolver=SQLiteInstrumentResolver(db, acc.broker_code))
    raw_list = [m.model_dump(exclude_none=True) for m in instruments]
    rows = client.fetch_quotes(raw_list)
    out: list[QuoteRow] = []
    for r in rows:
        out.append(
            QuoteRow(
                symbol=r.get("symbol"),
                ltp=float(r.get("ltp") or 0),
                broker_code=acc.broker_code,
                account_id=acc.id,
                detail={k: v for k, v in r.items() if k not in ("symbol", "ltp")},
            )
        )
    if push_redis and rows:
        cache_quotes(
            user_id=acc.user_id,
            account_id=acc.id,
            broker_code=acc.broker_code,
            quotes=[q.model_dump() for q in out],
        )
    return out


def apply_zerodha_session(db: Session, acc: BrokerAccount, request_token: str) -> tuple[bool, str]:
    row = acc.zerodha
    if not row:
        return False, "not zerodha"
    session_data, err = zerodha_auth.exchange_request_token(
        api_key=decrypt_value(row.api_key_cipher),
        api_secret=decrypt_value(row.api_secret_cipher),
        request_token=request_token,
    )
    if err or not session_data:
        return False, err or "failed"
    row.request_token_cipher = encrypt_value(request_token)
    row.access_token_cipher = encrypt_value(session_data["access_token"])
    row.access_token_generated_at = datetime.now(tz=UTC)
    public_token = session_data.get("public_token", "")
    user_id = session_data.get("user_id", "")
    row.public_token_cipher = encrypt_value(public_token) if public_token else None
    row.session_user_id_cipher = encrypt_value(user_id) if user_id else None
    acc.last_error = None
    acc.session_status = "active"
    acc.session_expires_at = zerodha_auth.session_expiry_utc(row.access_token_generated_at)
    _mark_session_healthy(db, acc, verified_at=row.access_token_generated_at)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def get_zerodha_session_status(acc: BrokerAccount) -> ZerodhaSessionStatusOut:
    row = acc.zerodha
    if not row:
        raise ValueError("missing zerodha credentials")

    api_key = decrypt_value(row.api_key_cipher)
    access_token = decrypt_value(row.access_token_cipher)
    generated_at = row.access_token_generated_at
    expires_at = zerodha_auth.session_expiry_utc(generated_at) if generated_at else None
    active = bool(access_token) and zerodha_auth.is_session_active(generated_at)
    session_user_id = (
        decrypt_value(row.session_user_id_cipher) if row.session_user_id_cipher else None
    )

    if active:
        guidance = (
            "Zerodha session is active for the current day. The user must re-authorize after "
            "the broker invalidates the token on the next day morning."
        )
    elif access_token:
        guidance = (
            "A Zerodha access token exists but is likely expired. Ask the user to complete "
            "the Zerodha login redirect again and submit the new request_token."
        )
    else:
        if acc.automation_enabled:
            guidance = (
                "No Zerodha access token is stored yet. Official flow: send the user to the "
                "login_url, capture the request_token from the redirect, then call the Zerodha "
                "session API. Experimental flow: call POST /sessions/zerodha/refresh to use "
                "stored web-login credentials and TOTP."
            )
        else:
            guidance = (
                "No Zerodha access token is stored yet. Send the user to the login_url, capture "
                "the request_token from the redirect, then call the Zerodha session API."
            )

    return ZerodhaSessionStatusOut(
        account_id=acc.id,
        login_url=zerodha_auth.build_login_url(api_key, state=acc.id),
        has_access_token=bool(access_token),
        session_active=active,
        access_token_generated_at=generated_at,
        access_token_expires_at=expires_at,
        session_user_id=session_user_id,
        guidance=guidance,
    )


def apply_upstox_session(db: Session, acc: BrokerAccount, code: str) -> tuple[bool, str]:
    row = acc.upstox
    if not row:
        return False, "not upstox"
    tok, err = upstox_auth.exchange_authorization_code(
        api_key=decrypt_value(row.api_key_cipher),
        api_secret=decrypt_value(row.api_secret_cipher),
        redirect_uri=decrypt_value(row.redirect_uri_cipher),
        code=code,
    )
    if err or not tok:
        return False, err or "failed"
    row.access_token_cipher = encrypt_value(tok)
    row.access_token_generated_at = datetime.now(tz=UTC)
    acc.last_error = None
    acc.session_status = "active"
    _mark_session_healthy(db, acc, verified_at=row.access_token_generated_at)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def apply_angel_session(
    db: Session, acc: BrokerAccount, client_code: str, pin: str, totp: str
) -> tuple[bool, str]:
    row = acc.angel
    if not row:
        return False, "not angel"
    jwt_t, feed, err = angel_auth.login(
        api_key=decrypt_value(row.api_key_cipher),
        client_code=client_code,
        pin=pin,
        totp=totp,
    )
    if err or not jwt_t:
        return False, err or "failed"
    row.jwt_token_cipher = encrypt_value(jwt_t)
    row.client_code_cipher = encrypt_value(client_code)
    if pin:
        row.pin_cipher = encrypt_value(pin)
    if feed:
        row.feed_token_cipher = encrypt_value(feed)
    row.jwt_token_generated_at = datetime.now(tz=UTC)
    acc.last_error = None
    acc.session_status = "active"
    acc.session_expires_at = datetime.now(tz=UTC) + timedelta(hours=24)
    _mark_session_healthy(db, acc, verified_at=row.jwt_token_generated_at)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def apply_dhan_session(db: Session, acc: BrokerAccount, token_id: str) -> tuple[bool, str]:
    row = acc.dhan
    if not row:
        return False, "not dhan"
    tok, err = dhan_auth.consume_consent(
        app_id=decrypt_value(row.app_id_cipher),
        app_secret=decrypt_value(row.app_secret_cipher),
        token_id=token_id,
    )
    if err or not tok:
        return False, err or "failed"
    now = datetime.now(tz=UTC)
    row.access_token_cipher = encrypt_value(tok)
    row.access_token_generated_at = now
    row.access_token_expires_at = _next_groww_expiry_utc(now)
    acc.last_error = None
    acc.session_status = "active"
    acc.session_expires_at = row.access_token_expires_at
    _mark_session_healthy(db, acc, verified_at=now)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def apply_kotak_session(
    db: Session, acc: BrokerAccount, mobile: str, totp: str, mpin: str
) -> tuple[bool, str]:
    row = acc.kotak
    if not row:
        return False, "not kotak"
    bundle, err = kotak_auth.totp_mpin_session(
        ucc=decrypt_value(row.ucc_cipher),
        portal_access_token=decrypt_value(row.portal_access_token_cipher),
        mobile_number=mobile,
        totp=totp,
        mpin=mpin,
    )
    if err or not bundle:
        return False, err or "failed"
    row.session_bundle_cipher = encrypt_value(bundle)
    row.mobile_number_cipher = encrypt_value(mobile)
    row.session_bundle_generated_at = datetime.now(tz=UTC)
    if not row.mpin_cipher:
        row.mpin_cipher = encrypt_value(mpin)
    acc.last_error = None
    acc.session_status = "active"
    acc.session_expires_at = datetime.now(tz=UTC) + timedelta(hours=24)
    _mark_session_healthy(db, acc, verified_at=row.session_bundle_generated_at)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""


def apply_groww_refresh(db: Session, acc: BrokerAccount) -> tuple[bool, str]:
    row = acc.groww
    if not row:
        return False, "not groww"
    tok, err = groww_auth.refresh_access_token(
        api_key=decrypt_value(row.api_key_cipher),
        api_secret=decrypt_value(row.api_secret_cipher),
    )
    if err or not tok:
        return False, err or "failed"
    now = datetime.now(tz=UTC)
    row.access_token_cipher = encrypt_value(tok)
    row.access_token_generated_at = now
    row.access_token_expires_at = _next_groww_expiry_utc(now)
    acc.last_error = None
    acc.session_status = "active"
    acc.session_expires_at = row.access_token_expires_at
    _mark_session_healthy(db, acc, verified_at=now)
    db.add(row)
    db.add(acc)
    db.commit()
    return True, ""
