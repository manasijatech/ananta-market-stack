from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from common.datetime_compat import UTC
import redis
from sqlalchemy.orm import Session

from app.services import broker_data
from app.services import broker_data_preferences
from broker.core.redis_cache import _redis_client

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _loads_json(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, bytes):
        raw = raw.decode()
    if isinstance(raw, dict):
        return raw
    try:
        payload = json.loads(str(raw))
    except (TypeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _positive_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _change_pct_from_payload(payload: dict[str, Any]) -> float | None:
    for key in ("change_pct", "day_change_perc", "day_change_percentage"):
        try:
            if payload.get(key) not in (None, ""):
                return float(payload[key])
        except (TypeError, ValueError):
            continue
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else {}
    detail_raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else {}
    for source in (raw, detail_raw):
        for key in ("day_change_perc", "day_change_percentage", "change_pct"):
            try:
                if source.get(key) not in (None, ""):
                    return float(source[key])
            except (TypeError, ValueError):
                continue
        ohlc = source.get("ohlc") if isinstance(source.get("ohlc"), dict) else {}
        close = ohlc.get("close")
        ltp = _positive_float(payload.get("ltp") or payload.get("last_price") or source.get("last_price"))
        close_value = _positive_float(close)
        if ltp is not None and close_value:
            return round(((ltp - close_value) / close_value) * 100, 2)
    return None


def _snapshot_from_quote_payload(
    payload: dict[str, Any],
    *,
    source: str,
    broker_code: str | None = None,
) -> dict[str, Any] | None:
    ltp = _positive_float(payload.get("ltp") or payload.get("last_price"))
    if ltp is None:
        raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
        detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else {}
        detail_raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else {}
        ltp = _positive_float(raw.get("last_price") or detail_raw.get("last_price") or raw.get("ltp"))
    if ltp is None:
        return None
    return {
        "price_ltp": ltp,
        "price_change_pct": _change_pct_from_payload(payload),
        "price_as_of": _utc_now(),
        "price_source": source,
        "price_broker_code": broker_code or payload.get("broker_code"),
    }


def _read_redis_quote(
    client: redis.Redis | None,
    *,
    user_id: str,
    account_id: str | None,
    broker_code: str | None,
    symbol: str,
) -> dict[str, Any] | None:
    if client is None:
        return None
    keys: list[str] = []
    if account_id and broker_code:
        keys.append(f"live:quote:{user_id}:{account_id}:{broker_code}:{symbol}")
    if broker_code:
        keys.append(f"live:quote:market:{broker_code}:{symbol}")
    for key in keys:
        try:
            raw = client.get(key)
        except redis.RedisError:
            continue
        payload = _loads_json(raw)
        snapshot = _snapshot_from_quote_payload(payload, source="live_redis", broker_code=broker_code)
        if snapshot is not None:
            return snapshot
    return None


def resolve_symbol_price_snapshot(
    db: Session,
    user_id: str,
    symbol: str | None,
    *,
    allow_rest_fallback: bool = True,
) -> dict[str, Any] | None:
    normalized = (symbol or "").strip().upper()
    if not normalized:
        return None

    account = broker_data_preferences.get_stream_default_broker_account(db, user_id)
    account_id = account.id if account else None
    broker_code = account.broker_code if account else None
    redis_client = _redis_client()
    live = _read_redis_quote(
        redis_client,
        user_id=user_id,
        account_id=account_id,
        broker_code=broker_code,
        symbol=normalized,
    )
    if live is not None:
        return live

    if not allow_rest_fallback or account is None:
        return None

    try:
        quotes = broker_data.fetch_quotes(
            db,
            account,
            [{"symbol": normalized, "exchange": "NSE"}],
        )
    except Exception as exc:
        logger.debug("Price snapshot REST fallback failed for %s: %s", normalized, exc)
        return None
    if not quotes:
        return None
    quote = quotes[0]
    payload = quote.model_dump(mode="json") if hasattr(quote, "model_dump") else dict(quote)
    return _snapshot_from_quote_payload(
        payload if isinstance(payload, dict) else {},
        source="broker_rest",
        broker_code=broker_code,
    )
