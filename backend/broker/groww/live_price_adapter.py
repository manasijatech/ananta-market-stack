from __future__ import annotations

import asyncio
import contextlib
import io
import logging
import time
from datetime import datetime, timedelta
from typing import Any

from broker.core.live_prices import (
    LIVE_FEED_ACCESS_RETRY_SECONDS,
    REST_FALLBACK_POLL_SECONDS,
    REST_FALLBACK_SYMBOL_LIMIT,
    LiveFeedFetchResult,
    is_access_forbidden_reason,
    live_feed_access_reason,
    utc_now,
)
from db.models import BrokerAccount, LiveSymbolSubscription

logger = logging.getLogger(__name__)
groww_nats_logger = logging.getLogger("growwapi.groww.nats_client")


class _DropNoisyGrowwNatsLogs(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if record.name != "growwapi.groww.nats_client":
            return True
        message = record.getMessage().strip()
        return message not in {"Error:", "Error: None", "Disconnected"}


groww_nats_logger.addFilter(_DropNoisyGrowwNatsLogs())


class GrowwLivePriceAdapter:
    broker_code = "groww"
    adapter_name = "groww_feed"
    capacity = 1000
    fallback_symbol_limit = REST_FALLBACK_SYMBOL_LIMIT

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._rest_fallback_not_before: dict[str, datetime] = {}
        self._feed_disabled_not_before: dict[str, datetime] = {}

    def capacity_wait_reason(self) -> str:
        return (
            "Groww feed supports 1000 live subscriptions per account. "
            "Higher-priority workflow and watchlist symbols are tracked first."
        )

    def disabled_reason(self, account_id: str) -> str | None:
        retry_at = self._feed_disabled_not_before.get(account_id)
        if retry_at and retry_at > utc_now():
            return (
                "Groww live websocket/feed access is currently disabled for this account after a broker access failure. "
                "The app is using the throttled REST quote fallback where available."
            )
        self._feed_disabled_not_before.pop(account_id, None)
        return None

    def rest_fallback_allowed(self, account_id: str) -> bool:
        retry_at = self._rest_fallback_not_before.get(account_id)
        return not retry_at or retry_at <= utc_now()

    def schedule_rest_fallback(self, account_id: str) -> None:
        self._rest_fallback_not_before[account_id] = utc_now() + timedelta(seconds=REST_FALLBACK_POLL_SECONDS)

    def feed_instrument(self, row: LiveSymbolSubscription, hydrated: dict[str, Any]) -> dict[str, str] | None:
        exchange = str(hydrated.get("groww_exchange") or hydrated.get("exchange") or row.exchange or "NSE").strip()
        segment = str(hydrated.get("groww_segment") or hydrated.get("segment") or "CASH").strip()
        exchange_token = str(hydrated.get("groww_exchange_token") or hydrated.get("exchange_token") or "").strip()
        if not exchange or not segment or not exchange_token:
            return None
        return {"exchange": exchange, "segment": segment, "exchange_token": exchange_token}

    async def fetch_payload(self, acc: BrokerAccount, instruments: list[dict[str, str]]) -> LiveFeedFetchResult:
        if not acc.groww:
            return LiveFeedFetchResult(status="unsupported", payload={}, reason="missing groww credentials")
        try:
            payload = await asyncio.to_thread(
                self._fetch_payload_sync,
                account_id=acc.id,
                access_token_cipher=acc.groww.access_token_cipher,
                instruments=instruments,
            )
        except Exception as exc:
            message = str(exc)
            if is_access_forbidden_reason(message):
                self._disable_feed(acc.id)
                return LiveFeedFetchResult(
                    status="fallback",
                    payload={},
                    reason=live_feed_access_reason(acc.broker_code, message),
                )
            self.drop_session(acc.id)
            logger.warning("Groww live feed failed for %s: %s", acc.id, exc)
            return LiveFeedFetchResult(status="failed", payload={}, reason=message)
        if not self._has_ltp(payload or {}, instruments):
            self._disable_feed(acc.id)
            return LiveFeedFetchResult(
                status="fallback",
                payload=payload or {},
                reason=(
                    "Groww live websocket/feed did not return a live price for the subscribed instruments. "
                    "The app is using the throttled REST quote fallback where available."
                ),
            )
        return LiveFeedFetchResult(status="ok", payload=payload or {})

    def payload_value(self, payload: dict[str, Any], instrument: dict[str, str]) -> dict[str, Any] | None:
        root = payload.get("ltp") if isinstance(payload.get("ltp"), dict) else payload
        exchange_rows = root.get(instrument["exchange"]) if isinstance(root, dict) else None
        segment_rows = exchange_rows.get(instrument["segment"]) if isinstance(exchange_rows, dict) else None
        value = segment_rows.get(instrument["exchange_token"]) if isinstance(segment_rows, dict) else None
        return value if isinstance(value, dict) else None

    def _fetch_payload_sync(
        self,
        *,
        account_id: str,
        access_token_cipher: str,
        instruments: list[dict[str, str]],
    ) -> dict[str, Any]:
        session = self._session(account_id, access_token_cipher)
        feed = session["feed"]
        self._sync_subscriptions(feed, session, instruments)
        return feed.get_ltp() or {}

    def _session(self, account_id: str, access_token_cipher: str) -> dict[str, Any]:
        session = self._sessions.get(account_id)
        if session is not None:
            return session
        from broker.crypto import decrypt_value
        from growwapi import GrowwAPI, GrowwFeed

        access_token = decrypt_value(access_token_cipher)
        with contextlib.redirect_stdout(io.StringIO()):
            feed = GrowwFeed(GrowwAPI(access_token))
        session = {"feed": feed, "subscribed": set(), "created_at": time.monotonic()}
        self._sessions[account_id] = session
        return session

    def _sync_subscriptions(self, feed: Any, session: dict[str, Any], instruments: list[dict[str, str]]) -> None:
        desired = {self._key(item) for item in instruments}
        subscribed: set[tuple[str, str, str]] = session.setdefault("subscribed", set())
        to_subscribe = [item for item in instruments if self._key(item) not in subscribed]
        to_unsubscribe = [
            {"exchange": exchange, "segment": segment, "exchange_token": exchange_token}
            for exchange, segment, exchange_token in subscribed - desired
        ]
        if to_subscribe:
            feed.subscribe_ltp(to_subscribe)
            subscribed.update(self._key(item) for item in to_subscribe)
        if to_unsubscribe:
            try:
                feed.unsubscribe_ltp(to_unsubscribe)
            finally:
                for item in to_unsubscribe:
                    subscribed.discard(self._key(item))

    def drop_session(self, account_id: str) -> None:
        session = self._sessions.pop(account_id, None)
        if not session:
            return
        feed = session.get("feed")
        nats_client = getattr(feed, "_nats_client", None)
        loop = getattr(nats_client, "_loop", None)
        socket = getattr(nats_client, "_socket", None)
        try:
            if socket is not None and loop is not None and loop.is_running():
                asyncio.run_coroutine_threadsafe(socket.close(), loop).result(timeout=2)
        except Exception:
            logger.debug("Groww feed socket cleanup failed for %s", account_id, exc_info=True)

    def _disable_feed(self, account_id: str) -> None:
        self._feed_disabled_not_before[account_id] = utc_now() + timedelta(seconds=LIVE_FEED_ACCESS_RETRY_SECONDS)
        self.drop_session(account_id)

    def _has_ltp(self, payload: dict[str, Any], instruments: list[dict[str, str]]) -> bool:
        for instrument in instruments:
            value = self.payload_value(payload, instrument)
            if not value:
                continue
            ltp = value.get("ltp")
            try:
                if float(ltp) > 0:
                    return True
            except (TypeError, ValueError):
                continue
        return False

    @staticmethod
    def _key(instrument: dict[str, str]) -> tuple[str, str, str]:
        return (instrument["exchange"], instrument["segment"], instrument["exchange_token"])


_ADAPTER = GrowwLivePriceAdapter()


def get_adapter() -> GrowwLivePriceAdapter:
    return _ADAPTER
