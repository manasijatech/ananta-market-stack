from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user
from app.schemas.broker import (
    BrokerSessionStatusOut,
    BrokerAccountCreate,
    BrokerAccountOut,
    QuoteRequest,
    QuoteRow,
    SessionAngelIn,
    SessionDhanIn,
    SessionGrowwIn,
    SessionIndmoneyIn,
    SessionKotakIn,
    SessionStartOut,
    SessionUpstoxRequestOut,
    SessionUpstoxIn,
    SessionZerodhaRefreshOut,
    SessionZerodhaIn,
    VerifyOut,
    ZerodhaSessionStatusOut,
)
from app.services import broker_accounts as ba_svc
from app.services import broker_sessions as bs_svc
from broker.core.registry import BROKER_CODES
from db.models import BrokerAccount, User
from db.session import get_db

router = APIRouter()


def _get_owned_account(db: Session, user_id: str, account_id: str) -> BrokerAccount:
    acc = db.get(BrokerAccount, account_id)
    if not acc or acc.user_id != user_id:
        raise HTTPException(status_code=404, detail="broker account not found")
    return acc


@router.post("", response_model=BrokerAccountOut)
def create_broker_account(
    payload: BrokerAccountCreate = Body(
        ...,
        openapi_examples={
            "zerodha_default": {
                "summary": "Zerodha (official redirect flow)",
                "value": {
                    "broker": "zerodha",
                    "label": "zerodha-main",
                    "api_key": "kite_api_key",
                    "api_secret": "kite_api_secret",
                },
            },
            "zerodha_with_optional_automation": {
                "summary": "Zerodha (official flow + optional automation creds)",
                "value": {
                    "broker": "zerodha",
                    "label": "zerodha-auto",
                    "api_key": "kite_api_key",
                    "api_secret": "kite_api_secret",
                    "login_user_id": "AB1234",
                    "login_password": "your_password",
                    "totp_secret": "BASE32_TOTP_SECRET",
                },
            },
            "groww_totp": {
                "summary": "Groww TOTP mode",
                "value": {
                    "broker": "groww",
                    "label": "groww-main",
                    "totp_token": "groww_user_api_key",
                    "totp_secret": "BASE32_SECRET_FROM_QR",
                },
            },
            "groww_approval": {
                "summary": "Groww approval mode",
                "value": {
                    "broker": "groww",
                    "label": "groww-approval",
                    "api_key": "groww_api_key",
                    "api_secret": "groww_api_secret",
                },
            },
            "upstox_oauth": {
                "summary": "Upstox OAuth",
                "value": {
                    "broker": "upstox",
                    "label": "upstox-main",
                    "api_key": "upstox_api_key",
                    "api_secret": "upstox_api_secret",
                    "redirect_uri": "https://your-app.example.com/upstox/callback",
                },
            },
        },
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerAccount:
    """
    **Add a new broker account.**

    This endpoint supports multiple brokers via a discriminated union. 
    Supply the correct fields for the chosen `broker`.

    - **Zerodha**: Needs `api_key`, `api_secret`.
    - **Upstox**: Needs `api_key`, `api_secret`, `redirect_uri`.
    - **Angel/Dhan/Groww**: Need keys + optional TOTP secrets for automation.
    - **Kotak/INDmoney**: Standard portal access tokens.

    Accounts are created as 'active' by default but may require a session exchange.
    """
    if payload.broker not in BROKER_CODES:
        raise HTTPException(status_code=400, detail="unknown broker")
    try:
        return ba_svc.create_broker_account(db, user.id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("", response_model=list[BrokerAccountOut])
def list_broker_accounts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BrokerAccount]:
    """
    **List all broker accounts for the current user.**

    Returns basic metadata and session status. Does NOT return sensitive credentials.
    """
    q = select(BrokerAccount).where(BrokerAccount.user_id == user.id).order_by(BrokerAccount.created_at)
    return list(db.scalars(q).all())


@router.post("/maintenance/run", response_model=VerifyOut)
def run_maintenance_now(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """
    **Manually trigger session maintenance.**

    Checks all of the user's active accounts:
    - Verifies connectivity.
    - Attempts automated token refreshes (if `totp_secret` is present and broker supports it).
    - Updates `session_status` and expiry hints.
    """
    count = bs_svc.run_user_maintenance(db, user.id)
    return VerifyOut(ok=True, message=f"Processed {count} broker account(s)")


@router.get("/{account_id}", response_model=BrokerAccountOut)
def get_broker_account(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerAccount:
    """**Fetch metadata for a specific broker account ID.**"""
    return _get_owned_account(db, user.id, account_id)


@router.delete("/{account_id}", status_code=204)
def delete_broker_account(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """
    **Remove a broker account.**

    Performs a cascade delete of the account and its associated credentials.
    """
    acc = _get_owned_account(db, user.id, account_id)
    db.delete(acc)
    db.commit()


@router.post("/{account_id}/verify", response_model=VerifyOut)
def verify_broker_account(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """
    **Test connectivity to the broker.**

    Attempts a simple request (like profile fetch) to confirm that 
    the current access tokens/credentials are valid.
    """
    acc = _get_owned_account(db, user.id, account_id)
    ok, msg = ba_svc.verify_account(db, acc)
    return VerifyOut(ok=ok, message=msg or "")


@router.post("/{account_id}/quotes", response_model=list[QuoteRow])
def post_quotes(
    account_id: str,
    body: QuoteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[QuoteRow]:
    """
    **Fetch real-time quotes for a batch of instruments.**

    Pass an array of broker-specific identifiers (e.g., `zerodha_instrument_token`, 
    `upstox_instrument_key`). Only fields matching the current account's broker 
    will be used.

    - **Redis Cache**: Successful quotes are cached in Redis with a TTL (default 120s).
    - **Freshness**: Updates `ltp` and detail dictionary for current-session analysis.
    """
    acc = _get_owned_account(db, user.id, account_id)
    try:
        return ba_svc.fetch_quotes_for_account(db, acc, body.instruments, push_redis=True)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/{account_id}/sessions/zerodha", response_model=VerifyOut)
def session_zerodha(
    account_id: str,
    body: SessionZerodhaIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """
    **Exchange Zerodha request_token for an access_token.**

    Official flow: Redirect user to Zerodha login -> extract `request_token` 
    from URL -> POST here to enable trading for the day.
    """
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "zerodha":
        raise HTTPException(status_code=400, detail="account is not zerodha")
    ok, err = ba_svc.apply_zerodha_session(db, acc, body.request_token)
    return VerifyOut(ok=ok, message=err or "")


@router.get("/{account_id}/sessions/zerodha", response_model=ZerodhaSessionStatusOut)
def zerodha_session_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ZerodhaSessionStatusOut:
    """**Retrieve current Zerodha session status.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "zerodha":
        raise HTTPException(status_code=400, detail="account is not zerodha")
    try:
        return ba_svc.get_zerodha_session_status(acc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{account_id}/sessions/zerodha/refresh", response_model=SessionZerodhaRefreshOut)
def zerodha_session_refresh_experimental(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionZerodhaRefreshOut:
    """
    **Experimental: Automate Zerodha web login.**

    Requires Zerodha `user_id`, `password`, and `totp_secret` to be stored. 
    Mimics web login to avoid manual redirect flows. **Use with caution.**
    """
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "zerodha":
        raise HTTPException(status_code=400, detail="account is not zerodha")
    refreshed, err = bs_svc.refresh_zerodha_session_experimental(db, acc)
    if err or refreshed is None:
        raise HTTPException(status_code=400, detail=err or "failed")
    return refreshed


@router.get("/{account_id}/sessions/upstox", response_model=BrokerSessionStatusOut)
def upstox_session_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerSessionStatusOut:
    """**Fetch Upstox session status and OAuth login URL.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "upstox":
        raise HTTPException(status_code=400, detail="account is not upstox")
    return bs_svc.get_broker_session_status(acc)


@router.post("/{account_id}/sessions/upstox", response_model=VerifyOut)
def session_upstox(
    account_id: str,
    body: SessionUpstoxIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """
    **Exchange Upstox authorization_code for an access_token.**

    Exchange the code returned by the OAuth redirect flow for a trading token.
    """
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "upstox":
        raise HTTPException(status_code=400, detail="account is not upstox")
    ok, err = ba_svc.apply_upstox_session(db, acc, body.authorization_code)
    return VerifyOut(ok=ok, message=err or "")


@router.post("/{account_id}/sessions/upstox/request-token", response_model=SessionUpstoxRequestOut)
def upstox_request_token(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionUpstoxRequestOut:
    """
    **Trigger official semi-automated Upstox approval request.**

    Users will receive an approval request in the Upstox app or WhatsApp. 
    Once approved, the token will be delivered to our webhook.
    """
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "upstox":
        raise HTTPException(status_code=400, detail="account is not upstox")
    result, err = bs_svc.request_upstox_access_token(db, acc)
    if err or result is None:
        raise HTTPException(status_code=400, detail=err or "failed")
    return result


@router.post("/sessions/upstox/notifier", response_model=VerifyOut, include_in_schema=True)
async def upstox_notifier(request: Request, db: Session = Depends(get_db)) -> VerifyOut:
    """**Public Webhook for Upstox semi-automated token delivery.**"""
    payload = await request.json()
    ok, err = bs_svc.consume_upstox_notifier(db, payload)
    return VerifyOut(ok=ok, message=err or "")


@router.post("/{account_id}/sessions/angel", response_model=VerifyOut)
def session_angel(
    account_id: str,
    body: SessionAngelIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """
    **Execute manual Angel SmartAPI login.**

    Supply client_code (if different), 4-digit PIN, and active TOTP.
    """
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "angel":
        raise HTTPException(status_code=400, detail="account is not angel")
    ok, err = ba_svc.apply_angel_session(
        db, acc, body.client_code, body.pin, body.totp
    )
    return VerifyOut(ok=ok, message=err or "")


@router.get("/{account_id}/sessions/angel", response_model=BrokerSessionStatusOut)
def angel_session_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerSessionStatusOut:
    """**Fetch Angel session and automation status.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "angel":
        raise HTTPException(status_code=400, detail="account is not angel")
    return bs_svc.get_broker_session_status(acc)


@router.post("/{account_id}/sessions/angel/refresh", response_model=VerifyOut)
def angel_session_refresh(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """**Try official automated TOTP-based Angel refresh.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "angel":
        raise HTTPException(status_code=400, detail="account is not angel")
    ok, err = bs_svc.refresh_angel_session(db, acc)
    return VerifyOut(ok=ok, message=err or "")


@router.post("/{account_id}/sessions/dhan", response_model=VerifyOut)
def session_dhan(
    account_id: str,
    body: SessionDhanIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """**Consume official Dhan consent `token_id`.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "dhan":
        raise HTTPException(status_code=400, detail="account is not dhan")
    ok, err = ba_svc.apply_dhan_session(db, acc, body.token_id)
    return VerifyOut(ok=ok, message=err or "")


@router.get("/{account_id}/sessions/dhan", response_model=BrokerSessionStatusOut)
def dhan_session_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerSessionStatusOut:
    """**Fetch Dhan session status.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "dhan":
        raise HTTPException(status_code=400, detail="account is not dhan")
    return bs_svc.get_broker_session_status(acc)


@router.post("/{account_id}/sessions/dhan/refresh", response_model=VerifyOut)
def dhan_session_refresh(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """**Try official automated Dhan token generation/refresh via Pin + TOTP.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "dhan":
        raise HTTPException(status_code=400, detail="account is not dhan")
    ok, err = bs_svc.refresh_dhan_session(db, acc)
    return VerifyOut(ok=ok, message=err or "")


@router.post("/{account_id}/sessions/dhan/start", response_model=SessionStartOut)
def dhan_session_start(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionStartOut:
    """**Generate a Dhan consent login URL.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "dhan":
        raise HTTPException(status_code=400, detail="account is not dhan")
    try:
        return bs_svc.start_dhan_consent(acc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{account_id}/sessions/kotak", response_model=VerifyOut)
def session_kotak(
    account_id: str,
    body: SessionKotakIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """**Execute manual Kotak Neo TOTP login.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "kotak":
        raise HTTPException(status_code=400, detail="account is not kotak")
    ok, err = ba_svc.apply_kotak_session(
        db, acc, body.mobile_number, body.totp, body.mpin
    )
    return VerifyOut(ok=ok, message=err or "")


@router.get("/{account_id}/sessions/kotak", response_model=BrokerSessionStatusOut)
def kotak_session_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerSessionStatusOut:
    """**Fetch Kotak session status.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "kotak":
        raise HTTPException(status_code=400, detail="account is not kotak")
    return bs_svc.get_broker_session_status(acc)


@router.post("/{account_id}/sessions/kotak/refresh", response_model=VerifyOut)
def kotak_session_refresh(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """**Try official automated Kotak refresh via MPIN + TOTP.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "kotak":
        raise HTTPException(status_code=400, detail="account is not kotak")
    ok, err = bs_svc.refresh_kotak_session(db, acc)
    return VerifyOut(ok=ok, message=err or "")


@router.post("/{account_id}/sessions/groww", response_model=VerifyOut)
def session_groww(
    account_id: str,
    body: SessionGrowwIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """
    **Manual or automated Groww session update.**

    Supply a fresh Bearer token or let the backend attempt TOTP-based 
    login if configured.
    """
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "groww":
        raise HTTPException(status_code=400, detail="account is not groww")
    ok, err = bs_svc.refresh_groww_session(db, acc, body)
    return VerifyOut(ok=ok, message=err or "")


@router.get("/{account_id}/sessions/groww", response_model=BrokerSessionStatusOut)
def groww_session_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerSessionStatusOut:
    """**Fetch Groww session status.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "groww":
        raise HTTPException(status_code=400, detail="account is not groww")
    return bs_svc.get_broker_session_status(acc)


@router.get("/{account_id}/sessions/indmoney", response_model=BrokerSessionStatusOut)
def indmoney_session_status(
    account_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrokerSessionStatusOut:
    """**Fetch INDmoney session status.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "indmoney":
        raise HTTPException(status_code=400, detail="account is not indmoney")
    return bs_svc.get_broker_session_status(acc)


@router.post("/{account_id}/sessions/indmoney", response_model=VerifyOut)
def session_indmoney(
    account_id: str,
    body: SessionIndmoneyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyOut:
    """**Update INDmoney session token manually.**"""
    acc = _get_owned_account(db, user.id, account_id)
    if acc.broker_code != "indmoney":
        raise HTTPException(status_code=400, detail="account is not indmoney")
    ok, err = bs_svc.update_indmoney_access_token(db, acc, body.access_token)
    return VerifyOut(ok=ok, message=err or "")
