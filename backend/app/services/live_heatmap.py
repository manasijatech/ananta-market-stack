from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta
from typing import Any

import redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.live_heatmap import (
    HeatmapAlphaEventOut,
    HeatmapAlphaEventSummaryOut,
    HeatmapAlphaEventTagOut,
    HeatmapResponseOut,
    HeatmapSymbolOut,
)
from app.services import broker_data_preferences
from broker.core.redis_cache import _redis_client
from db.models import AlphaSymbolMetadataCache, AlphaWebSocketEvent, LiveSymbolSubscription


def _normal_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _quote_key(user_id: str, account_id: str, broker_code: str, symbol: str) -> str:
    return f"live:quote:{user_id}:{account_id}:{broker_code}:{symbol}"


def _loads_json(raw: Any, fallback: Any) -> Any:
    if raw is None:
        return fallback
    if isinstance(raw, bytes):
        raw = raw.decode()
    try:
        return json.loads(str(raw))
    except (TypeError, json.JSONDecodeError):
        return fallback


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _quote_live_price(payload: dict[str, Any]) -> float | None:
    for value in (
        payload.get("ltp"),
        payload.get("last_price"),
        ((payload.get("detail") or {}).get("raw") or {}).get("last_price"),
    ):
        numeric = _as_float(value)
        if numeric is not None and numeric > 0:
            return numeric
    return None


def _computed_change_fields(payload: dict[str, Any]) -> tuple[float | None, float | None]:
    day_change = _as_float(payload.get("day_change"))
    day_change_perc = _as_float(payload.get("day_change_perc"))
    if day_change is not None and day_change_perc is not None:
        return day_change, day_change_perc

    close_price = _as_float(payload.get("close"))
    ltp = _quote_live_price(payload)
    if close_price not in (None, 0) and ltp is not None:
        computed_change = round(ltp - close_price, 2)
        computed_pct = round((computed_change / close_price) * 100, 2)
        return day_change if day_change is not None else computed_change, day_change_perc if day_change_perc is not None else computed_pct
    return day_change, day_change_perc


def _normalize_live_payload(payload: dict[str, Any], fallback_exchange: str | None) -> dict[str, Any]:
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else {}
    raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else {}
    ohlc = raw.get("ohlc") if isinstance(raw.get("ohlc"), dict) else {}

    normalized = {
        "symbol": _normal_symbol(payload.get("symbol")),
        "exchange": payload.get("exchange") or detail.get("exchange") or fallback_exchange,
        "ltp": _quote_live_price(payload),
        "day_change": payload.get("day_change") if payload.get("day_change") is not None else raw.get("day_change"),
        "day_change_perc": payload.get("day_change_perc") if payload.get("day_change_perc") is not None else raw.get("day_change_perc"),
        "open": payload.get("open") if payload.get("open") is not None else ohlc.get("open"),
        "high": payload.get("high") if payload.get("high") is not None else ohlc.get("high"),
        "low": payload.get("low") if payload.get("low") is not None else ohlc.get("low"),
        "close": payload.get("close") if payload.get("close") is not None else ohlc.get("close"),
        "volume": payload.get("volume") if payload.get("volume") is not None else raw.get("volume"),
        "market_cap": payload.get("market_cap") if payload.get("market_cap") is not None else raw.get("market_cap"),
        "raw_payload": payload,
    }
    normalized["day_change"], normalized["day_change_perc"] = _computed_change_fields(normalized)
    return normalized


def _subscription_priority(row: LiveSymbolSubscription) -> tuple[int, int, int]:
    source_rank = {"workflow": 0, "watchlist": 1, "ui": 2}.get(row.source_kind or "", 3)
    has_quote = 0 if row.last_received_at else 1
    quote_size = -(len(row.last_quote_json or "{}"))
    return (source_rank, has_quote, quote_size)


def _pick_live_rows(rows: list[LiveSymbolSubscription]) -> list[LiveSymbolSubscription]:
    grouped: dict[tuple[str, str | None], list[LiveSymbolSubscription]] = defaultdict(list)
    for row in rows:
        grouped[(row.symbol, row.exchange)].append(row)
    selected: list[LiveSymbolSubscription] = []
    for duplicate_rows in grouped.values():
        duplicate_rows.sort(
            key=lambda row: (
                _subscription_priority(row),
                -(row.last_received_at.timestamp()) if row.last_received_at else float("inf"),
            )
        )
        selected.append(duplicate_rows[0])
    return selected


def _load_redis_quotes(
    client: redis.Redis | None,
    *,
    user_id: str,
    account_id: str,
    broker_code: str,
    symbols: list[str],
) -> dict[str, dict[str, Any]]:
    if client is None or not symbols:
        return {}
    pipe = client.pipeline()
    for symbol in symbols:
        pipe.get(_quote_key(user_id, account_id, broker_code, symbol))
    try:
        raw_rows = pipe.execute()
    except redis.RedisError:
        return {}
    quotes: dict[str, dict[str, Any]] = {}
    for symbol, raw in zip(symbols, raw_rows, strict=False):
        payload = _loads_json(raw, {})
        if isinstance(payload, dict) and _quote_live_price(payload) is not None:
            quotes[symbol] = payload
    return quotes


def _metadata_by_symbol(db: Session, symbols: list[str]) -> dict[str, AlphaSymbolMetadataCache]:
    if not symbols:
        return {}
    rows = db.scalars(select(AlphaSymbolMetadataCache).where(AlphaSymbolMetadataCache.symbol.in_(symbols))).all()
    return {row.symbol: row for row in rows}


def _alpha_events_by_symbol(
    db: Session,
    *,
    user_id: str,
    symbols: list[str],
    days: int | None,
) -> dict[str, list[AlphaWebSocketEvent]]:
    if not symbols:
        return {}
    stmt = select(AlphaWebSocketEvent).where(
        AlphaWebSocketEvent.user_id == user_id,
        AlphaWebSocketEvent.symbol.in_(symbols),
    )
    if days is not None:
        stmt = stmt.where(AlphaWebSocketEvent.received_at >= datetime_utc_now() - timedelta(days=days))
    rows = db.scalars(stmt.order_by(AlphaWebSocketEvent.received_at.desc())).all()
    grouped: dict[str, list[AlphaWebSocketEvent]] = defaultdict(list)
    for row in rows:
        if row.symbol:
            grouped[row.symbol].append(row)
    return grouped


def datetime_utc_now():
    from datetime import datetime

    return datetime.utcnow()


def get_live_heatmap(
    db: Session,
    *,
    user_id: str,
    limit: int,
    days: int | None = None,
) -> HeatmapResponseOut:
    account = broker_data_preferences.get_effective_default_broker_account(db, user_id)
    if account is None:
        account = broker_data_preferences.get_stream_default_broker_account(db, user_id)
    if account is None:
        return HeatmapResponseOut(requested_limit=limit, returned_count=0, tracked_symbol_count=0, days=days)

    rows = db.scalars(
        select(LiveSymbolSubscription).where(
            LiveSymbolSubscription.user_id == user_id,
            LiveSymbolSubscription.status == "active",
            LiveSymbolSubscription.account_id == account.id,
            LiveSymbolSubscription.broker_code == account.broker_code,
        )
    ).all()
    selected_rows = _pick_live_rows(rows)
    tracked_symbol_count = len(selected_rows)
    redis_quotes = _load_redis_quotes(
        _redis_client(),
        user_id=user_id,
        account_id=account.id,
        broker_code=account.broker_code,
        symbols=[row.symbol for row in selected_rows],
    )

    quote_rows: list[tuple[LiveSymbolSubscription, dict[str, Any]]] = []
    for row in selected_rows:
        payload = redis_quotes.get(row.symbol)
        if payload is None:
            payload = _loads_json(row.last_quote_json, {})
        if not isinstance(payload, dict):
            continue
        normalized = _normalize_live_payload(payload, row.exchange)
        if normalized.get("ltp") is None:
            continue
        quote_rows.append((row, normalized))

    quote_rows.sort(
        key=lambda item: (
            -abs(item[1].get("day_change_perc") or 0.0),
            item[0].symbol,
        )
    )
    limited_rows = quote_rows[:limit]
    symbols = [row.symbol for row, _ in limited_rows]
    metadata_map = _metadata_by_symbol(db, symbols)
    alpha_events_map = _alpha_events_by_symbol(db, user_id=user_id, symbols=symbols, days=days)

    items: list[HeatmapSymbolOut] = []
    source_kinds_by_key: dict[tuple[str, str | None], list[str]] = {}
    for subscription_row in rows:
        key = (subscription_row.symbol, subscription_row.exchange)
        values = source_kinds_by_key.setdefault(key, [])
        source_kind = subscription_row.source_kind
        if source_kind and source_kind not in values:
            values.append(source_kind)
    for row, live_data in limited_rows:
        metadata = metadata_map.get(row.symbol)
        event_rows = alpha_events_map.get(row.symbol, [])
        tag_counts: dict[str, int] = defaultdict(int)
        event_items: list[HeatmapAlphaEventOut] = []
        latest_received_at = None
        for event_row in event_rows:
            tag_counts[event_row.product] += 1
            if latest_received_at is None:
                latest_received_at = event_row.received_at
            event_items.append(
                HeatmapAlphaEventOut(
                    id=event_row.id,
                    product=event_row.product,
                    event_key=event_row.event_key,
                    received_at=event_row.received_at,
                    processed_at=event_row.processed_at,
                    payload=_loads_json(event_row.payload_json, {}),
                )
            )
        summary = HeatmapAlphaEventSummaryOut(
            total_count=len(event_items),
            tags=[
                HeatmapAlphaEventTagOut(tag=tag, count=count)
                for tag, count in sorted(tag_counts.items(), key=lambda item: (-item[1], item[0]))
            ],
            latest_received_at=latest_received_at,
        )
        items.append(
            HeatmapSymbolOut(
                symbol=row.symbol,
                exchange=row.exchange,
                broker_code=account.broker_code,
                account_id=account.id,
                ltp=float(live_data["ltp"]),
                day_change=_as_float(live_data.get("day_change")),
                day_change_perc=_as_float(live_data.get("day_change_perc")),
                open=_as_float(live_data.get("open")),
                high=_as_float(live_data.get("high")),
                low=_as_float(live_data.get("low")),
                close=_as_float(live_data.get("close")),
                volume=_as_float(live_data.get("volume")),
                market_cap=metadata.market_cap if metadata else live_data.get("market_cap"),
                company_name=metadata.company_name if metadata else None,
                logo=metadata.logo if metadata else None,
                sector=metadata.sector if metadata else None,
                basic_industry=metadata.basic_industry if metadata else None,
                industry=metadata.industry if metadata else None,
                theme=metadata.theme if metadata else None,
                health_status=row.health_status,
                health_reason=row.health_reason or "",
                last_received_at=row.last_received_at,
                source_kinds=sorted(source_kinds_by_key.get((row.symbol, row.exchange), [])),
                alpha_event_summary=summary,
                alpha_events=event_items,
                live_data=live_data["raw_payload"],
            )
        )

    return HeatmapResponseOut(
        broker_code=account.broker_code,
        account_id=account.id,
        requested_limit=limit,
        returned_count=len(items),
        tracked_symbol_count=tracked_symbol_count,
        days=days,
        items=items,
    )
