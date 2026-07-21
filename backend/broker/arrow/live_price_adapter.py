from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import websockets
from websockets.exceptions import ConnectionClosed

from app.config import get_settings
from broker.arrow.streaming import (
    HFT_URL,
    STANDARD_URL,
    hft_symbol,
    hft_subscription_batches,
    parse_hft_packet,
    parse_standard_packet,
    scale_tick,
    split_hft_frames,
)
from broker.core.live_prices import (
    LIVE_FEED_ACCESS_RETRY_SECONDS,
    REST_FALLBACK_POLL_SECONDS,
    REST_FALLBACK_SYMBOL_LIMIT,
    LiveFeedFetchResult,
    utc_now,
)
from broker.crypto import decrypt_value
from db.models import BrokerAccount, LiveSymbolSubscription


class ArrowLivePriceAdapter:
    broker_code = "arrow"
    adapter_name = "arrow_native_feed"
    fallback_symbol_limit = REST_FALLBACK_SYMBOL_LIMIT

    def __init__(self) -> None:
        # The adapter is shared by all Arrow accounts, so keep a capacity that
        # is safe for both standard and HFT sessions instead of mutating this
        # global value whenever a different account connects.
        self.capacity = min(get_settings().arrow_standard_stream_symbol_limit, 1024)
        self._sessions: dict[str, dict[str, Any]] = {}
        self._rest_fallback_not_before: dict[str, datetime] = {}
        self._feed_disabled_not_before: dict[str, datetime] = {}

    def capacity_wait_reason(self) -> str:
        return f"Arrow {self.adapter_name} capacity is configured for {self.capacity} symbols per connection."

    def disabled_reason(self, account_id: str) -> str | None:
        retry_at = self._feed_disabled_not_before.get(account_id)
        if retry_at and retry_at > utc_now():
            return "Arrow native market feed is temporarily unavailable; throttled REST quote fallback is active."
        self._feed_disabled_not_before.pop(account_id, None)
        return None

    def rest_fallback_allowed(self, account_id: str) -> bool:
        return self._rest_fallback_not_before.get(account_id, datetime.min) <= utc_now()

    def schedule_rest_fallback(self, account_id: str) -> None:
        self._rest_fallback_not_before[account_id] = utc_now() + timedelta(seconds=REST_FALLBACK_POLL_SECONDS)

    def feed_instrument(self, row: LiveSymbolSubscription, hydrated: dict[str, Any]) -> dict[str, str] | None:
        token = str(hydrated.get("arrow_token") or "").strip()
        if not token:
            return None
        exchange = str(hydrated.get("exchange") or row.exchange or "NSE").upper()
        trading_symbol = str(hydrated.get("trading_symbol") or hydrated.get("symbol") or row.symbol)
        return {
            "exchange_token": token,
            "arrow_token": token,
            "exchange": exchange,
            "hft_symbol": hft_symbol(exchange, trading_symbol),
            "price_precision": str(hydrated.get("price_precision") or 2),
        }

    async def fetch_payload(self, acc: BrokerAccount, instruments: list[dict[str, str]]) -> LiveFeedFetchResult:
        if not acc.arrow:
            return LiveFeedFetchResult(status="unsupported", payload={}, reason="missing Arrow credentials")
        try:
            session = await self._session(acc)
            await self._sync(session, instruments)
            fresh = await self._collect(session, instruments)
        except (ConnectionClosed, OSError, asyncio.TimeoutError, ValueError) as exc:
            await self.drop_session(acc.id)
            return LiveFeedFetchResult(status="failed", payload={}, reason=str(exc))
        except Exception as exc:
            await self.drop_session(acc.id)
            self._feed_disabled_not_before[acc.id] = utc_now() + timedelta(seconds=LIVE_FEED_ACCESS_RETRY_SECONDS)
            return LiveFeedFetchResult(status="fallback", payload={}, reason=str(exc))
        payload = {"quotes": {key: session["latest"][key] for key in fresh if key in session["latest"]}}
        return LiveFeedFetchResult(status="ok", payload=payload)

    def payload_value(self, payload: dict[str, Any], instrument: dict[str, str]) -> dict[str, Any] | None:
        value = (payload.get("quotes") or {}).get(instrument["arrow_token"])
        return value if isinstance(value, dict) and value.get("ltp") not in (None, 0, "0") else None

    async def _session(self, acc: BrokerAccount) -> dict[str, Any]:
        row = acc.arrow
        assert row is not None
        app_id = decrypt_value(row.app_id_cipher)
        token = decrypt_value(row.access_token_cipher)
        credential_key = (app_id, token, row.market_stream_mode, row.hft_latency_ms)
        current = self._sessions.get(acc.id)
        if current and current.get("credential_key") == credential_key:
            return current
        if current:
            await self.drop_session(acc.id)
        hft = row.market_stream_mode == "hft"
        params = {"appID": app_id, "token": token}
        if hft:
            params["zstd"] = "1"
        websocket = await websockets.connect(
            f"{HFT_URL if hft else STANDARD_URL}?{urlencode(params)}",
            open_timeout=10,
            close_timeout=3,
            ping_interval=20,
            ping_timeout=20,
            max_size=4 * 1024 * 1024,
        )
        session = {
            "websocket": websocket, "credential_key": credential_key, "hft": hft,
            "latency": row.hft_latency_ms, "subscribed": set(), "latest": {},
            "hft_subscription_request_times": [],
        }
        if hft:
            try:
                import zstandard as zstd
            except ImportError as exc:
                await websocket.close()
                raise RuntimeError("Arrow HFT requires the zstandard package") from exc
            session["zstd"] = zstd.ZstdDecompressor()
        self._sessions[acc.id] = session
        return session

    async def _sync(self, session: dict[str, Any], instruments: list[dict[str, str]]) -> None:
        desired = {item["arrow_token"]: item for item in instruments}
        subscribed: set[str] = session["subscribed"]
        add = [desired[token] for token in desired.keys() - subscribed]
        remove = list(subscribed - desired.keys())
        if session["hft"]:
            await self._send_hft_batches(session, [item["hft_symbol"] for item in add], code="sub")
            if remove:
                old_symbols = [str(session["latest"].get(token, {}).get("hft_symbol") or token) for token in remove]
                await self._send_hft_batches(session, old_symbols, code="unsub")
        else:
            if add:
                await session["websocket"].send(json.dumps({"code": "sub", "mode": "quote", "quote": [int(item["arrow_token"]) for item in add]}))
            if remove:
                await session["websocket"].send(json.dumps({"code": "unsub", "mode": "quote", "quote": [int(token) for token in remove]}))
        subscribed.update(desired)
        subscribed.difference_update(remove)
        for item in add:
            session["latest"].setdefault(item["arrow_token"], {}).update(
                price_precision=int(item["price_precision"]), hft_symbol=item["hft_symbol"]
            )
        for token in remove:
            session["latest"].pop(token, None)

    @staticmethod
    async def _send_hft_batches(session: dict[str, Any], symbols: list[str], *, code: str) -> None:
        if not symbols:
            return
        for message in hft_subscription_batches(
            symbols,
            mode="ltpc",
            latency_ms=session["latency"],
            code=code,
        ):
            request_times: list[float] = session["hft_subscription_request_times"]
            now = time.monotonic()
            request_times[:] = [sent_at for sent_at in request_times if now - sent_at < 1.0]
            if len(request_times) >= 100:
                await asyncio.sleep(max(0.001, 1.0 - (now - request_times[0])))
                now = time.monotonic()
                request_times[:] = [sent_at for sent_at in request_times if now - sent_at < 1.0]
            request_times.append(now)
            await session["websocket"].send(message)

    async def _collect(self, session: dict[str, Any], instruments: list[dict[str, str]]) -> set[str]:
        desired = {item["arrow_token"] for item in instruments}
        fresh: set[str] = set()
        deadline = asyncio.get_running_loop().time() + 0.25
        first = True
        while first or asyncio.get_running_loop().time() < deadline:
            first = False
            try:
                message = await asyncio.wait_for(session["websocket"].recv(), timeout=1.0 if not fresh else 0.05)
            except asyncio.TimeoutError:
                break
            if not isinstance(message, bytes):
                continue
            packets: list[dict[str, Any]] = []
            if session["hft"]:
                decompressed = session["zstd"].decompress(message)
                packets = [parsed for frame in split_hft_frames(decompressed) if (parsed := parse_hft_packet(frame))]
            else:
                parsed = parse_standard_packet(message)
                packets = [parsed] if parsed else []
            for tick in packets:
                if tick.get("kind") == "ack":
                    continue
                token = str(tick.get("token") or "")
                if token not in desired:
                    continue
                current = session["latest"].setdefault(token, {})
                precision = int(current.get("price_precision") or 2)
                current.update(scale_tick(tick, precision))
                fresh.add(token)
        return fresh

    async def drop_session(self, account_id: str) -> None:
        session = self._sessions.pop(account_id, None)
        if session and session.get("websocket"):
            try:
                await asyncio.wait_for(session["websocket"].close(), timeout=2)
            except Exception:
                pass

    async def close_all_sessions(self) -> None:
        for account_id in list(self._sessions):
            await self.drop_session(account_id)


_ADAPTER = ArrowLivePriceAdapter()


def get_adapter() -> ArrowLivePriceAdapter:
    return _ADAPTER
