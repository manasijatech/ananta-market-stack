from __future__ import annotations

import asyncio
import json
import logging
import struct
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import websockets
from websockets.exceptions import ConnectionClosed

from broker.core.live_prices import (
    LIVE_FEED_ACCESS_RETRY_SECONDS,
    REST_FALLBACK_POLL_SECONDS,
    REST_FALLBACK_SYMBOL_LIMIT,
    LiveFeedFetchResult,
    utc_now,
)
from broker.crypto import decrypt_value
from db.models import BrokerAccount, LiveSymbolSubscription

logger = logging.getLogger(__name__)

_FEED_URL = "wss://api-feed.dhan.co"
_SUBSCRIBE_QUOTE = 17
_UNSUBSCRIBE_QUOTE = 18
_DISCONNECT = 12
_BATCH_SIZE = 100
_INITIAL_TICK_WAIT_SECONDS = 2.5
_DRAIN_WAIT_SECONDS = 0.05

_SEGMENT_NAMES = {
    0: "IDX_I",
    1: "NSE_EQ",
    2: "NSE_FNO",
    3: "NSE_CURRENCY",
    4: "BSE_EQ",
    5: "MCX_COMM",
    7: "BSE_CURRENCY",
    8: "BSE_FNO",
}

_DISCONNECT_REASONS = {
    800: "Dhan Data API internal server error",
    804: "Dhan requested instrument count exceeds the allowed limit",
    805: "Dhan live feed connection or request limit exceeded",
    806: "Dhan Data APIs are not subscribed for this account",
    807: "Dhan access token is expired",
    808: "Dhan live feed authentication failed",
    809: "Dhan access token is invalid",
    810: "Dhan client ID is invalid",
    811: "Dhan expiry date is invalid",
    812: "Dhan date format is invalid",
    813: "Dhan security ID is invalid",
    814: "Dhan live feed request is invalid",
}


class DhanFeedDisconnect(RuntimeError):
    def __init__(self, code: int) -> None:
        self.code = code
        super().__init__(f"{_DISCONNECT_REASONS.get(code, 'Dhan disconnected the live feed')} (code {code})")


def parse_feed_packet(data: bytes) -> dict[str, Any] | None:
    """Decode one Dhan v2 little-endian market-feed packet."""
    if len(data) < 8:
        return None
    response_code, message_length, segment_code, security_id = struct.unpack_from("<BHBI", data)
    if message_length > len(data):
        return None
    base: dict[str, Any] = {
        "response_code": response_code,
        "message_length": message_length,
        "exchange_segment": _SEGMENT_NAMES.get(segment_code, str(segment_code)),
        "security_id": str(security_id),
    }
    if response_code == 2 and len(data) >= 16:
        ltp, last_trade_time = struct.unpack_from("<fI", data, 8)
        return {**base, "ltp": float(ltp), "last_trade_time": last_trade_time}
    if response_code == 4 and len(data) >= 50:
        (
            ltp,
            last_trade_quantity,
            last_trade_time,
            average_price,
            volume,
            total_sell_quantity,
            total_buy_quantity,
            open_price,
            close_price,
            high_price,
            low_price,
        ) = struct.unpack_from("<fHIfIIIffff", data, 8)
        return {
            **base,
            "ltp": float(ltp),
            "last_trade_quantity": last_trade_quantity,
            "last_trade_time": last_trade_time,
            "average_price": float(average_price),
            "volume": volume,
            "total_sell_quantity": total_sell_quantity,
            "total_buy_quantity": total_buy_quantity,
            "open": float(open_price),
            "close": float(close_price),
            "high": float(high_price),
            "low": float(low_price),
        }
    if response_code == 5 and len(data) >= 12:
        (open_interest,) = struct.unpack_from("<I", data, 8)
        return {**base, "open_interest": open_interest}
    if response_code == 6 and len(data) >= 16:
        previous_close, previous_open_interest = struct.unpack_from("<fI", data, 8)
        return {
            **base,
            "previous_close": float(previous_close),
            "previous_open_interest": previous_open_interest,
        }
    if response_code == 50 and len(data) >= 10:
        (disconnect_code,) = struct.unpack_from("<H", data, 8)
        raise DhanFeedDisconnect(disconnect_code)
    return base


class DhanLivePriceAdapter:
    broker_code = "dhan"
    adapter_name = "dhan_v2_feed"
    capacity = 5000
    fallback_symbol_limit = REST_FALLBACK_SYMBOL_LIMIT

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._rest_fallback_not_before: dict[str, datetime] = {}
        self._feed_disabled_not_before: dict[str, datetime] = {}

    def capacity_wait_reason(self) -> str:
        return (
            "Dhan supports 5000 instruments on each live-feed connection. "
            "Higher-priority workflow and watchlist symbols are tracked first."
        )

    def disabled_reason(self, account_id: str) -> str | None:
        retry_at = self._feed_disabled_not_before.get(account_id)
        if retry_at and retry_at > utc_now():
            return (
                "Dhan native live feed is temporarily paused after a Data API entitlement or authentication error. "
                "The app is using throttled REST quote fallback and will retry the feed automatically."
            )
        self._feed_disabled_not_before.pop(account_id, None)
        return None

    def rest_fallback_allowed(self, account_id: str) -> bool:
        retry_at = self._rest_fallback_not_before.get(account_id)
        return not retry_at or retry_at <= utc_now()

    def schedule_rest_fallback(self, account_id: str) -> None:
        self._rest_fallback_not_before[account_id] = utc_now() + timedelta(seconds=REST_FALLBACK_POLL_SECONDS)

    def feed_instrument(self, row: LiveSymbolSubscription, hydrated: dict[str, Any]) -> dict[str, str] | None:
        exchange_segment = str(hydrated.get("dhan_exchange_segment") or "").strip().upper()
        security_id = str(hydrated.get("dhan_security_id") or "").strip()
        if not exchange_segment or not security_id:
            return None
        return {
            "exchange_segment": exchange_segment,
            "security_id": security_id,
            # Shared publishing code calls this field the exchange token.
            "exchange_token": security_id,
        }

    async def fetch_payload(
        self,
        acc: BrokerAccount,
        instruments: list[dict[str, str]],
    ) -> LiveFeedFetchResult:
        if not acc.dhan:
            return LiveFeedFetchResult(status="unsupported", payload={}, reason="missing Dhan credentials")
        try:
            client_id = decrypt_value(acc.dhan.client_id_cipher)
            access_token = decrypt_value(acc.dhan.access_token_cipher)
            session = await self._session(acc.id, client_id, access_token)
            await self._sync_subscriptions(session, instruments)
            fresh_keys = await self._collect_packets(session, instruments)
        except DhanFeedDisconnect as exc:
            await self.drop_session(acc.id)
            if exc.code in {805, 806, 807, 808, 809, 810}:
                self._disable_feed(acc.id)
                return LiveFeedFetchResult(status="fallback", payload={}, reason=str(exc))
            return LiveFeedFetchResult(status="failed", payload={}, reason=str(exc))
        except (ConnectionClosed, OSError, asyncio.TimeoutError) as exc:
            await self.drop_session(acc.id)
            logger.warning("Dhan live feed failed for %s: %s", acc.id, exc)
            return LiveFeedFetchResult(status="failed", payload={}, reason=str(exc))
        except Exception as exc:
            await self.drop_session(acc.id)
            logger.warning("Dhan live feed failed for %s: %s", acc.id, exc, exc_info=True)
            return LiveFeedFetchResult(status="failed", payload={}, reason=str(exc))

        payload = {
            "quotes": {
                key: session["latest"][key]
                for key in fresh_keys
                if key in session["latest"]
            }
        }
        if any(self.payload_value(payload, instrument) for instrument in instruments):
            return LiveFeedFetchResult(status="ok", payload=payload)
        return LiveFeedFetchResult(
            status="ok",
            payload=payload,
            reason="Dhan native live feed is connected but has not delivered a quote packet yet.",
        )

    def payload_value(self, payload: dict[str, Any], instrument: dict[str, str]) -> dict[str, Any] | None:
        quotes = payload.get("quotes")
        if not isinstance(quotes, dict):
            return None
        value = quotes.get(self._key(instrument))
        return value if isinstance(value, dict) and value.get("ltp") not in (None, 0, "0") else None

    async def _session(self, account_id: str, client_id: str, access_token: str) -> dict[str, Any]:
        credential_key = (client_id, access_token)
        session = self._sessions.get(account_id)
        if session is not None and session.get("credential_key") == credential_key:
            return session
        if session is not None:
            await self.drop_session(account_id)
        url = f"{_FEED_URL}?{urlencode({'version': 2, 'token': access_token, 'clientId': client_id, 'authType': 2})}"
        websocket = await websockets.connect(
            url,
            open_timeout=10,
            close_timeout=3,
            ping_interval=20,
            ping_timeout=20,
            max_size=2 * 1024 * 1024,
        )
        session = {
            "websocket": websocket,
            "credential_key": credential_key,
            "subscribed": set(),
            "latest": {},
        }
        self._sessions[account_id] = session
        return session

    async def _sync_subscriptions(
        self,
        session: dict[str, Any],
        instruments: list[dict[str, str]],
    ) -> None:
        desired = {self._key(item) for item in instruments}
        subscribed: set[str] = session["subscribed"]
        to_subscribe = sorted(desired - subscribed)
        to_unsubscribe = sorted(subscribed - desired)
        await self._send_batches(session["websocket"], _SUBSCRIBE_QUOTE, to_subscribe)
        await self._send_batches(session["websocket"], _UNSUBSCRIBE_QUOTE, to_unsubscribe)
        subscribed.update(to_subscribe)
        subscribed.difference_update(to_unsubscribe)
        for key in to_unsubscribe:
            session["latest"].pop(key, None)

    async def _collect_packets(
        self,
        session: dict[str, Any],
        instruments: list[dict[str, str]],
    ) -> set[str]:
        desired = {self._key(item) for item in instruments}
        latest: dict[str, dict[str, Any]] = session["latest"]
        fresh_keys: set[str] = set()
        missing_prices = any(not latest.get(key, {}).get("ltp") for key in desired)
        timeout = _INITIAL_TICK_WAIT_SECONDS if missing_prices else _DRAIN_WAIT_SECONDS
        while True:
            try:
                message = await asyncio.wait_for(session["websocket"].recv(), timeout=timeout)
            except asyncio.TimeoutError:
                return fresh_keys
            timeout = _DRAIN_WAIT_SECONDS
            if not isinstance(message, bytes):
                continue
            packet = parse_feed_packet(message)
            if not packet or "security_id" not in packet:
                continue
            key = f"{packet['exchange_segment']}|{packet['security_id']}"
            current = latest.setdefault(key, {})
            current.update(packet)
            if key in desired and packet.get("ltp") not in (None, 0, "0"):
                fresh_keys.add(key)
            last_trade_time = packet.get("last_trade_time")
            if last_trade_time:
                current["tsInMillis"] = int(last_trade_time) * 1000

    async def drop_session(self, account_id: str) -> None:
        session = self._sessions.pop(account_id, None)
        if not session:
            return
        websocket = session.get("websocket")
        if websocket is None:
            return
        try:
            await websocket.send(json.dumps({"RequestCode": _DISCONNECT}))
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass

    def _disable_feed(self, account_id: str) -> None:
        self._feed_disabled_not_before[account_id] = utc_now() + timedelta(
            seconds=LIVE_FEED_ACCESS_RETRY_SECONDS
        )

    @staticmethod
    async def _send_batches(websocket: Any, request_code: int, keys: list[str]) -> None:
        for start in range(0, len(keys), _BATCH_SIZE):
            batch = keys[start : start + _BATCH_SIZE]
            instruments = []
            for key in batch:
                exchange_segment, security_id = key.split("|", 1)
                instruments.append(
                    {
                        "ExchangeSegment": exchange_segment,
                        "SecurityId": security_id,
                    }
                )
            await websocket.send(
                json.dumps(
                    {
                        "RequestCode": request_code,
                        "InstrumentCount": len(instruments),
                        "InstrumentList": instruments,
                    }
                )
            )

    @staticmethod
    def _key(instrument: dict[str, str]) -> str:
        return f"{instrument['exchange_segment']}|{instrument['security_id']}"


_ADAPTER = DhanLivePriceAdapter()


def get_adapter() -> DhanLivePriceAdapter:
    return _ADAPTER
