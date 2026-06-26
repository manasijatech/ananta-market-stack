from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from common.datetime_compat import UTC
from app.schemas.broker import (
    MarketChartCacheStatusOut,
    MarketChartCandleOut,
    MarketChartSnapshotOut,
    QuoteRow,
)
from app.services import broker_data
from db.models import BrokerAccount, BrokerMarketCandleCache

IST = ZoneInfo("Asia/Kolkata")
INTRADAY_CACHE_STALE_AFTER = timedelta(minutes=3)


@dataclass(slots=True)
class NormalizedCandle:
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None
    source_payload: dict[str, Any]


def _utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _normalize_exchange(value: Any) -> str:
    return str(value or "").strip().upper()


def _float_or_none(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_time(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000.0
        return datetime.fromtimestamp(timestamp, tz=UTC)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.isdigit():
            return _parse_time(int(raw))
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
    return None


def _extract_candle_rows(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []

    for key in ("candles", "data", "payload", "result"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            nested = _extract_candle_rows(value)
            if nested:
                return nested

    for value in payload.values():
        if isinstance(value, dict):
            candles = value.get("candles")
            if isinstance(candles, list):
                return candles
    return []


def _normalize_single_candle(item: Any) -> NormalizedCandle | None:
    if isinstance(item, list):
        if len(item) < 5:
            return None
        candle_time = _parse_time(item[0])
        open_value = _float_or_none(item[1])
        high_value = _float_or_none(item[2])
        low_value = _float_or_none(item[3])
        close_value = _float_or_none(item[4])
        volume_value = _float_or_none(item[5] if len(item) > 5 else None)
        source_payload = {"row": item}
    elif isinstance(item, dict):
        candle_time = _parse_time(
            item.get("time") or item.get("timestamp") or item.get("ts") or item.get("date")
        )
        open_value = _float_or_none(item.get("open") or item.get("o"))
        high_value = _float_or_none(item.get("high") or item.get("h"))
        low_value = _float_or_none(item.get("low") or item.get("l"))
        close_value = _float_or_none(item.get("close") or item.get("c"))
        volume_value = _float_or_none(item.get("volume") or item.get("v"))
        source_payload = item
    else:
        return None

    if candle_time is None or None in (open_value, high_value, low_value, close_value):
        return None
    return NormalizedCandle(
        time=candle_time,
        open=open_value,
        high=high_value,
        low=low_value,
        close=close_value,
        volume=volume_value,
        source_payload=source_payload,
    )


def _normalize_payload_candles(payload: dict[str, Any]) -> list[NormalizedCandle]:
    rows = _extract_candle_rows(payload)
    if rows:
        out = [_normalize_single_candle(item) for item in rows]
        return sorted([item for item in out if item], key=lambda item: item.time)

    timestamps = payload.get("timestamp") or payload.get("timestamps")
    opens = payload.get("open")
    highs = payload.get("high")
    lows = payload.get("low")
    closes = payload.get("close")
    volumes = payload.get("volume") or payload.get("volumes")
    if all(isinstance(series, list) for series in (timestamps, opens, highs, lows, closes)):
        out: list[NormalizedCandle] = []
        for index, ts in enumerate(timestamps):
            candle_time = _parse_time(ts)
            open_value = _float_or_none(opens[index] if index < len(opens) else None)
            high_value = _float_or_none(highs[index] if index < len(highs) else None)
            low_value = _float_or_none(lows[index] if index < len(lows) else None)
            close_value = _float_or_none(closes[index] if index < len(closes) else None)
            if candle_time is None or None in (open_value, high_value, low_value, close_value):
                continue
            volume_value = None
            if isinstance(volumes, list) and index < len(volumes):
                volume_value = _float_or_none(volumes[index])
            out.append(
                NormalizedCandle(
                    time=candle_time,
                    open=open_value,
                    high=high_value,
                    low=low_value,
                    close=close_value,
                    volume=volume_value,
                    source_payload={
                        "timestamp": ts,
                        "open": opens[index],
                        "high": highs[index],
                        "low": lows[index],
                        "close": closes[index],
                        "volume": volumes[index] if isinstance(volumes, list) and index < len(volumes) else None,
                    },
                )
            )
        return sorted(out, key=lambda item: item.time)
    return []


def _load_cached_candles(
    db: Session,
    *,
    broker_code: str,
    symbol: str,
    exchange: str,
    interval: str,
    from_time: datetime,
    to_time: datetime,
) -> list[NormalizedCandle]:
    rows = db.scalars(
        select(BrokerMarketCandleCache)
        .where(BrokerMarketCandleCache.broker_code == broker_code)
        .where(BrokerMarketCandleCache.symbol == symbol)
        .where(BrokerMarketCandleCache.exchange == exchange)
        .where(BrokerMarketCandleCache.interval == interval)
        .where(BrokerMarketCandleCache.candle_time >= from_time.replace(tzinfo=None))
        .where(BrokerMarketCandleCache.candle_time <= to_time.replace(tzinfo=None))
        .order_by(BrokerMarketCandleCache.candle_time.asc())
    ).all()
    return [
        NormalizedCandle(
            time=row.candle_time.replace(tzinfo=UTC),
            open=row.open,
            high=row.high,
            low=row.low,
            close=row.close,
            volume=row.volume,
            source_payload=json.loads(row.source_payload_json or "{}"),
        )
        for row in rows
    ]


def _replace_cached_candles(
    db: Session,
    *,
    broker_code: str,
    symbol: str,
    exchange: str,
    interval: str,
    from_time: datetime,
    to_time: datetime,
    candles: list[NormalizedCandle],
) -> None:
    db.execute(
        delete(BrokerMarketCandleCache)
        .where(BrokerMarketCandleCache.broker_code == broker_code)
        .where(BrokerMarketCandleCache.symbol == symbol)
        .where(BrokerMarketCandleCache.exchange == exchange)
        .where(BrokerMarketCandleCache.interval == interval)
        .where(BrokerMarketCandleCache.candle_time >= from_time.replace(tzinfo=None))
        .where(BrokerMarketCandleCache.candle_time <= to_time.replace(tzinfo=None))
    )
    fetched_at = _utc_now().replace(tzinfo=None)
    for candle in candles:
        db.add(
            BrokerMarketCandleCache(
                broker_code=broker_code,
                symbol=symbol,
                exchange=exchange,
                interval=interval,
                candle_time=candle.time.replace(tzinfo=None),
                open=candle.open,
                high=candle.high,
                low=candle.low,
                close=candle.close,
                volume=candle.volume,
                source_payload_json=json.dumps(candle.source_payload),
                fetched_at=fetched_at,
            )
        )


def _fetch_historical_candles(
    db: Session,
    acc: BrokerAccount,
    *,
    instrument: dict[str, Any],
    interval: str,
    from_time: datetime,
    to_time: datetime,
) -> list[NormalizedCandle]:
    payload = broker_data.fetch_historical(
        db,
        acc,
        {
            "instrument": instrument,
            "interval": interval,
            "from_date": from_time.isoformat(),
            "to_date": to_time.isoformat(),
        },
    )
    if not isinstance(payload, dict):
        return []
    candles = _normalize_payload_candles(payload)
    return [candle for candle in candles if from_time <= candle.time <= to_time]


def _quote_row_to_dict(row: Any) -> dict[str, Any]:
    return row.model_dump(mode="json") if hasattr(row, "model_dump") else dict(row)


def _merge_live_quote(
    candles: list[NormalizedCandle],
    *,
    quote: QuoteRow | None,
    interval: str,
) -> tuple[list[NormalizedCandle], datetime | None]:
    if quote is None:
        return candles, None

    quote_dict = _quote_row_to_dict(quote)
    detail = quote_dict.get("detail") or {}
    raw = detail.get("raw") if isinstance(detail, dict) and isinstance(detail.get("raw"), dict) else detail
    ltp = _float_or_none(quote_dict.get("ltp"))
    if ltp is None:
        return candles, None

    timestamp = _parse_time(raw.get("timestamp") if isinstance(raw, dict) else None)
    if timestamp is None:
        timestamp = _parse_time(raw.get("last_trade_time") if isinstance(raw, dict) else None)
    if timestamp is None:
        timestamp = _utc_now()

    bucket = timestamp.replace(second=0, microsecond=0) if interval.endswith("minute") else timestamp
    volume = _float_or_none(raw.get("volume") if isinstance(raw, dict) else None)
    if candles and candles[-1].time == bucket:
        current = candles[-1]
        candles[-1] = NormalizedCandle(
            time=current.time,
            open=current.open,
            high=max(current.high, ltp),
            low=min(current.low, ltp),
            close=ltp,
            volume=volume if volume is not None else current.volume,
            source_payload=raw if isinstance(raw, dict) else {},
        )
    else:
        candles.append(
            NormalizedCandle(
                time=bucket,
                open=ltp,
                high=ltp,
                low=ltp,
                close=ltp,
                volume=volume,
                source_payload=raw if isinstance(raw, dict) else {},
            )
        )
    return candles, timestamp


def build_market_chart_snapshot(db: Session, acc: BrokerAccount, payload: dict[str, Any]) -> MarketChartSnapshotOut:
    instrument = dict(payload.get("instrument") or {})
    symbol = _normalize_symbol(instrument.get("symbol"))
    exchange = _normalize_exchange(instrument.get("exchange") or "NSE")
    if not symbol:
        raise ValueError("A symbol is required for chart data.")

    now_utc = _utc_now()
    now_ist = now_utc.astimezone(IST)
    intraday_lookback_days = max(1, int(payload.get("intraday_lookback_days") or 1))
    intraday_start_ist = (now_ist.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=intraday_lookback_days - 1))
    intraday_from_utc = intraday_start_ist.astimezone(UTC)
    daily_from_utc = (now_ist.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=max(1, int(payload.get("history_days") or 90)))).astimezone(UTC)
    daily_to_utc = intraday_from_utc - timedelta(seconds=1)
    daily_interval = str(payload.get("daily_interval") or "day")
    intraday_interval = str(payload.get("intraday_interval") or "1minute")

    cache_status = MarketChartCacheStatusOut()

    daily_candles = _load_cached_candles(
        db,
        broker_code=acc.broker_code,
        symbol=symbol,
        exchange=exchange,
        interval=daily_interval,
        from_time=daily_from_utc,
        to_time=daily_to_utc,
    )
    if daily_candles:
        cache_status.used_cached_daily = True
    else:
        daily_candles = _fetch_historical_candles(
            db,
            acc,
            instrument=instrument,
            interval=daily_interval,
            from_time=daily_from_utc,
            to_time=daily_to_utc,
        )
        if daily_candles:
            _replace_cached_candles(
                db,
                broker_code=acc.broker_code,
                symbol=symbol,
                exchange=exchange,
                interval=daily_interval,
                from_time=daily_from_utc,
                to_time=daily_to_utc,
                candles=daily_candles,
            )
            cache_status.fetched_daily = True

    intraday_candles = _load_cached_candles(
        db,
        broker_code=acc.broker_code,
        symbol=symbol,
        exchange=exchange,
        interval=intraday_interval,
        from_time=intraday_from_utc,
        to_time=now_utc,
    )
    latest_intraday_time = intraday_candles[-1].time if intraday_candles else None
    if intraday_candles and latest_intraday_time and now_utc - latest_intraday_time <= INTRADAY_CACHE_STALE_AFTER:
        cache_status.used_cached_intraday = True
    else:
        intraday_candles = _fetch_historical_candles(
            db,
            acc,
            instrument=instrument,
            interval=intraday_interval,
            from_time=intraday_from_utc,
            to_time=now_utc,
        )
        if intraday_candles:
            _replace_cached_candles(
                db,
                broker_code=acc.broker_code,
                symbol=symbol,
                exchange=exchange,
                interval=intraday_interval,
                from_time=intraday_from_utc,
                to_time=now_utc,
                candles=intraday_candles,
            )
            cache_status.fetched_intraday = True

    latest_quote: QuoteRow | None = None
    last_price_time: datetime | None = None
    if payload.get("include_live_quote", True):
        quote_rows = broker_data.fetch_quotes(db, acc, [instrument])
        if quote_rows:
            latest_quote = quote_rows[0]
            intraday_candles, last_price_time = _merge_live_quote(
                intraday_candles,
                quote=latest_quote,
                interval=intraday_interval,
            )

    combined = sorted(daily_candles + intraday_candles, key=lambda item: item.time)
    return MarketChartSnapshotOut(
        broker_code=acc.broker_code,
        symbol=symbol,
        exchange=exchange or None,
        candles=[
            MarketChartCandleOut(
                time=candle.time,
                open=candle.open,
                high=candle.high,
                low=candle.low,
                close=candle.close,
                volume=candle.volume,
                interval=intraday_interval if candle.time >= intraday_from_utc else daily_interval,
            )
            for candle in combined
        ],
        latest_quote=latest_quote,
        last_price_time=last_price_time,
        cache_status=cache_status,
    )
