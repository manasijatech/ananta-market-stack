from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from common.datetime_compat import UTC
from db.models import BrokerAccount, LiveSymbolSubscription

LIVE_FEED_ACCESS_RETRY_SECONDS = 15 * 60
REST_FALLBACK_POLL_SECONDS = 30
REST_FALLBACK_SYMBOL_LIMIT = 200


def utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def is_access_forbidden_reason(reason: str) -> bool:
    normalized = reason.lower()
    return "403" in reason or "access forbidden" in normalized or "forbidden" in normalized


def live_feed_access_reason(broker_code: str, reason: str) -> str:
    broker_label = broker_code.upper()
    detail = reason.strip() or "Broker live feed access is unavailable."
    return (
        f"{broker_label} live websocket/feed access is not available for this account or token. "
        f"The app will try the throttled REST quote fallback when available. Broker response: {detail}"
    )


@dataclass(frozen=True)
class LiveFeedFetchResult:
    status: str
    payload: dict[str, Any]
    reason: str = ""


class LivePriceAdapter(Protocol):
    broker_code: str
    adapter_name: str
    capacity: int
    fallback_symbol_limit: int

    def capacity_wait_reason(self) -> str: ...

    def disabled_reason(self, account_id: str) -> str | None: ...

    def rest_fallback_allowed(self, account_id: str) -> bool: ...

    def schedule_rest_fallback(self, account_id: str) -> None: ...

    def feed_instrument(self, row: LiveSymbolSubscription, hydrated: dict[str, Any]) -> dict[str, str] | None: ...

    async def fetch_payload(self, acc: BrokerAccount, instruments: list[dict[str, str]]) -> LiveFeedFetchResult: ...

    def payload_value(self, payload: dict[str, Any], instrument: dict[str, str]) -> dict[str, Any] | None: ...
