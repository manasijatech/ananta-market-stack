from __future__ import annotations

from datetime import UTC, datetime

from broker.core.types import BrokerCode
from broker.crypto import decrypt_value
from broker.zerodha.auth import is_session_active
from db.models import BrokerAccount

BROKER_CODES = frozenset(b.value for b in BrokerCode)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _ensure_not_expired(account: BrokerAccount, message: str) -> None:
    expires_at = _as_utc(account.session_expires_at)
    if expires_at and expires_at <= datetime.now(tz=UTC):
        raise ValueError(message)


def get_client_for_account(
    account: BrokerAccount,
    *,
    resolver=None,
):
    """
    Build the broker-specific client for a persisted account row.
    ``resolver`` is an optional InstrumentResolver; default is identity mapping.
    """
    res = resolver
    if res is None:
        from broker.core.instruments import DefaultInstrumentResolver

        res = DefaultInstrumentResolver()

    code = account.broker_code
    if code == BrokerCode.ZERODHA.value:
        from broker.zerodha.client import ZerodhaClient

        z = account.zerodha
        if not z:
            raise ValueError("missing zerodha credentials")
        access_token = decrypt_value(z.access_token_cipher)
        if not access_token:
            raise ValueError(
                "Zerodha access token is missing. Complete the Zerodha login flow and "
                "exchange the returned request_token via the session endpoint."
            )
        if not is_session_active(z.access_token_generated_at):
            raise ValueError(
                "Zerodha access token is expired. Ask the user to log in again and send a "
                "fresh request_token to the Zerodha session endpoint."
            )
        return ZerodhaClient(
            api_key=decrypt_value(z.api_key_cipher),
            api_secret=decrypt_value(z.api_secret_cipher),
            access_token=access_token,
            resolver=res,
        )
    if code == BrokerCode.UPSTOX.value:
        from broker.upstox.client import UpstoxClient

        u = account.upstox
        if not u:
            raise ValueError("missing upstox credentials")
        access_token = decrypt_value(u.access_token_cipher)
        if not access_token:
            raise ValueError(
                "Upstox access token is missing. Complete the Upstox OAuth login flow and "
                "exchange the returned authorization_code via the session endpoint."
            )
        _ensure_not_expired(
            account,
            "Upstox access token is expired. Ask the user to log in again and send a fresh authorization_code.",
        )
        return UpstoxClient(
            api_key=decrypt_value(u.api_key_cipher),
            api_secret=decrypt_value(u.api_secret_cipher),
            redirect_uri=decrypt_value(u.redirect_uri_cipher),
            access_token=access_token,
            resolver=res,
        )
    if code == BrokerCode.ANGEL.value:
        from broker.angel.client import AngelClient

        a = account.angel
        if not a:
            raise ValueError("missing angel credentials")
        jwt_token = decrypt_value(a.jwt_token_cipher)
        if not jwt_token:
            raise ValueError("Angel session token is missing. Complete the Angel session flow first.")
        _ensure_not_expired(
            account,
            "Angel session token is expired. Refresh the session manually or enable automation.",
        )
        feed = a.feed_token_cipher
        return AngelClient(
            api_key=decrypt_value(a.api_key_cipher),
            client_code=decrypt_value(a.client_code_cipher),
            pin=decrypt_value(a.pin_cipher) if a.pin_cipher else "",
            jwt_token=jwt_token,
            feed_token=decrypt_value(feed) if feed else None,
            resolver=res,
        )
    if code == BrokerCode.DHAN.value:
        from broker.dhan.client import DhanClient

        d = account.dhan
        if not d:
            raise ValueError("missing dhan credentials")
        access_token = decrypt_value(d.access_token_cipher)
        if not access_token:
            raise ValueError("Dhan access token is missing. Complete the Dhan session flow first.")
        _ensure_not_expired(
            account,
            "Dhan access token is expired. Refresh it manually or enable official automation.",
        )
        return DhanClient(
            app_id=decrypt_value(d.app_id_cipher),
            app_secret=decrypt_value(d.app_secret_cipher),
            client_id=decrypt_value(d.client_id_cipher),
            access_token=access_token,
            resolver=res,
        )
    if code == BrokerCode.GROWW.value:
        from broker.groww.client import GrowwClient

        g = account.groww
        if not g:
            raise ValueError("missing groww credentials")
        access_token = decrypt_value(g.access_token_cipher)
        if not access_token:
            raise ValueError("Groww access token is missing. Refresh the Groww session first.")
        _ensure_not_expired(
            account,
            "Groww access token is expired. Refresh it manually or enable TOTP automation.",
        )
        return GrowwClient(
            api_key=decrypt_value(g.api_key_cipher),
            api_secret=decrypt_value(g.api_secret_cipher),
            access_token=access_token,
            resolver=res,
        )
    if code == BrokerCode.INDMONEY.value:
        from broker.indmoney.client import IndmoneyClient

        i = account.indmoney
        if not i:
            raise ValueError("missing indmoney credentials")
        access_token = decrypt_value(i.access_token_cipher)
        if not access_token:
            raise ValueError("INDmoney access token is missing. Update it from the broker portal session flow.")
        _ensure_not_expired(
            account,
            "INDmoney access token is expired. Ask the user to generate a fresh broker portal token.",
        )
        return IndmoneyClient(
            access_token=access_token,
            resolver=res,
        )
    if code == BrokerCode.KOTAK.value:
        from broker.kotak.client import KotakClient

        k = account.kotak
        if not k:
            raise ValueError("missing kotak credentials")
        bundle = k.session_bundle_cipher
        if not bundle:
            raise ValueError("Kotak session bundle is missing. Complete the Kotak session flow first.")
        _ensure_not_expired(
            account,
            "Kotak session is expired. Refresh it manually or enable TOTP + MPIN automation.",
        )
        return KotakClient(
            ucc=decrypt_value(k.ucc_cipher),
            portal_access_token=decrypt_value(k.portal_access_token_cipher),
            session_bundle=decrypt_value(bundle) if bundle else None,
            resolver=res,
        )
    raise ValueError(f"unsupported broker {code}")
