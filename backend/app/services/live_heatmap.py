from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal

import redis
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.alert import LiveSubscriptionCreateIn
from app.schemas.broker import InstrumentRef
from app.schemas.live_heatmap import (
    HeatmapAlphaEventOut,
    HeatmapAlphaEventSummaryOut,
    HeatmapAlphaEventTagOut,
    HeatmapResponseOut,
    HeatmapSymbolOut,
)
from app.services import alerts as alert_svc
from app.services import broker_accounts, broker_data, broker_data_preferences, watchlists as watchlist_svc
from app.services.live_price_scope import publish_scope_change
from broker.core.redis_cache import _redis_client
from db.models import AlphaSymbolMetadataCache, AlphaWebSocketEvent, BrokerAccount, LiveSymbolSubscription

HeatmapScope = Literal["tracked", "watchlist", "portfolio_holdings"]


@dataclass
class HeatmapSourceRow:
    symbol: str
    exchange: str | None = None
    instrument_ref: InstrumentRef = field(default_factory=InstrumentRef)
    source_kinds: list[str] = field(default_factory=list)
    health_status: str = "unknown"
    health_reason: str = ""
    last_received_at: datetime | None = None
    fallback_quote_json: str | None = None
    stale_payload: dict[str, Any] | None = None


def _normal_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _normal_exchange(value: Any) -> str | None:
    exchange = str(value or "").strip().upper()
    return exchange or None


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
        return (
            day_change if day_change is not None else computed_change,
            day_change_perc if day_change_perc is not None else computed_pct,
        )
    return day_change, day_change_perc


def _has_change_context(payload: dict[str, Any]) -> bool:
    day_change, day_change_perc = _computed_change_fields(payload)
    return day_change is not None or day_change_perc is not None


def _normalize_live_payload(payload: dict[str, Any], fallback_exchange: str | None) -> dict[str, Any]:
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else {}
    raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else {}
    ohlc = raw.get("ohlc") if isinstance(raw.get("ohlc"), dict) else {}

    normalized = {
        "symbol": _normal_symbol(payload.get("symbol")),
        "exchange": payload.get("exchange") or detail.get("exchange") or fallback_exchange,
        "ltp": _quote_live_price(payload),
        "day_change": payload.get("day_change") if payload.get("day_change") is not None else raw.get("day_change"),
        "day_change_perc": payload.get("day_change_perc")
        if payload.get("day_change_perc") is not None
        else raw.get("day_change_perc"),
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


def _first_rows_from_payload(payload: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            for nested_key in keys:
                nested = value.get(nested_key)
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
    data_rows = payload.get("data")
    if isinstance(data_rows, list):
        return [item for item in data_rows if isinstance(item, dict)]
    payload_rows = payload.get("payload")
    if isinstance(payload_rows, list):
        return [item for item in payload_rows if isinstance(item, dict)]
    return []


def _subscription_maps(
    rows: list[LiveSymbolSubscription],
) -> tuple[dict[tuple[str, str | None], list[str]], dict[tuple[str, str | None], LiveSymbolSubscription]]:
    source_kinds_by_key: dict[tuple[str, str | None], list[str]] = {}
    for subscription_row in rows:
        key = (subscription_row.symbol, subscription_row.exchange)
        values = source_kinds_by_key.setdefault(key, [])
        source_kind = subscription_row.source_kind
        if source_kind and source_kind not in values:
            values.append(source_kind)
    selected_by_key = {(row.symbol, row.exchange): row for row in _pick_live_rows(rows)}
    return source_kinds_by_key, selected_by_key


def _build_source_row(
    *,
    symbol: str,
    exchange: str | None,
    instrument_ref: InstrumentRef | None = None,
    source_kinds: list[str] | None = None,
    health_status: str = "unknown",
    health_reason: str = "",
    last_received_at: datetime | None = None,
    fallback_quote_json: str | None = None,
    stale_payload: dict[str, Any] | None = None,
) -> HeatmapSourceRow:
    ref = instrument_ref or InstrumentRef()
    ref.symbol = symbol
    ref.exchange = exchange
    return HeatmapSourceRow(
        symbol=symbol,
        exchange=exchange,
        instrument_ref=ref,
        source_kinds=sorted(source_kinds or []),
        health_status=health_status,
        health_reason=health_reason,
        last_received_at=last_received_at,
        fallback_quote_json=fallback_quote_json,
        stale_payload=stale_payload,
    )


def _has_broker_identifiers(ref: InstrumentRef | None) -> bool:
    if ref is None:
        return False
    payload = ref.model_dump(exclude_none=True)
    return any(
        key not in {"symbol", "exchange"} and bool(value)
        for key, value in payload.items()
    )


def _default_account(db: Session, user_id: str) -> BrokerAccount | None:
    account = broker_data_preferences.get_effective_default_broker_account(db, user_id)
    if account is None:
        account = broker_data_preferences.get_stream_default_broker_account(db, user_id)
    return account


def _resolve_tracked_source(
    db: Session,
    *,
    user_id: str,
    account: BrokerAccount,
) -> tuple[list[HeatmapSourceRow], str, str | None]:
    rows = db.scalars(
        select(LiveSymbolSubscription).where(
            LiveSymbolSubscription.user_id == user_id,
            LiveSymbolSubscription.status == "active",
            LiveSymbolSubscription.account_id == account.id,
            LiveSymbolSubscription.broker_code == account.broker_code,
        )
    ).all()
    selected_rows = _pick_live_rows(rows)
    source_rows = [
        _build_source_row(
            symbol=row.symbol,
            exchange=row.exchange,
            instrument_ref=InstrumentRef(symbol=row.symbol, exchange=row.exchange),
            health_status=row.health_status,
            health_reason=row.health_reason or "",
            last_received_at=row.last_received_at,
            fallback_quote_json=row.last_quote_json,
        )
        for row in selected_rows
    ]
    return source_rows, "Tracked symbols", account.id


def _resolve_watchlist_source(
    db: Session,
    *,
    user_id: str,
    watchlist_id: str | None,
    account: BrokerAccount,
) -> tuple[list[HeatmapSourceRow], str, str]:
    if not watchlist_id:
        raise HTTPException(status_code=400, detail="watchlist_id is required for watchlist scope")
    watchlist = watchlist_svc.get_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        raise HTTPException(status_code=404, detail="watchlist not found")

    symbols = [_normal_symbol(item.symbol) for item in watchlist.items] or [_normal_symbol(symbol) for symbol in watchlist.symbols]
    symbols = [symbol for symbol in symbols if symbol]
    subscription_rows = db.scalars(
        select(LiveSymbolSubscription).where(
            LiveSymbolSubscription.user_id == user_id,
            LiveSymbolSubscription.account_id == account.id,
            LiveSymbolSubscription.broker_code == account.broker_code,
            LiveSymbolSubscription.status == "active",
            LiveSymbolSubscription.symbol.in_(symbols),
        )
    ).all()
    source_kinds_by_key, selected_by_key = _subscription_maps(subscription_rows)

    source_rows: list[HeatmapSourceRow] = []
    seen: set[tuple[str, str | None]] = set()
    for item in watchlist.items:
        symbol = _normal_symbol(item.symbol)
        exchange = _normal_exchange(item.exchange)
        if not symbol:
            continue
        key = (symbol, exchange)
        if key in seen:
            continue
        seen.add(key)
        selected = selected_by_key.get(key) or selected_by_key.get((symbol, None))
        selected_ref = (
            InstrumentRef(**_loads_json(selected.instrument_ref_json, {}))
            if selected and selected.instrument_ref_json
            else None
        )
        watchlist_ref = InstrumentRef(**item.instrument_ref.model_dump(exclude_none=True))
        resolved_ref = selected_ref if _has_broker_identifiers(selected_ref) else watchlist_ref
        source_rows.append(
            _build_source_row(
                symbol=symbol,
                exchange=exchange,
                instrument_ref=resolved_ref,
                source_kinds=source_kinds_by_key.get(key) or source_kinds_by_key.get((symbol, None), []),
                health_status=selected.health_status if selected else "unknown",
                health_reason=selected.health_reason or "" if selected else "",
                last_received_at=selected.last_received_at if selected else None,
                fallback_quote_json=selected.last_quote_json if selected else None,
            )
        )

    if not source_rows:
        for symbol in symbols:
            key = (symbol, None)
            if key in seen:
                continue
            seen.add(key)
            selected = selected_by_key.get(key)
            source_rows.append(
                _build_source_row(
                    symbol=symbol,
                    exchange=None,
                    instrument_ref=InstrumentRef(symbol=symbol),
                    source_kinds=source_kinds_by_key.get(key, []),
                    health_status=selected.health_status if selected else "unknown",
                    health_reason=selected.health_reason or "" if selected else "",
                    last_received_at=selected.last_received_at if selected else None,
                    fallback_quote_json=selected.last_quote_json if selected else None,
                )
            )

    return source_rows, watchlist.name, watchlist.id


def _holding_exchange(row: dict[str, Any]) -> str | None:
    return _normal_exchange(row.get("exchange") or row.get("exchange_segment") or row.get("segment"))


def _holding_symbol(row: dict[str, Any]) -> str:
    return _normal_symbol(
        row.get("tradingsymbol")
        or row.get("trading_symbol")
        or row.get("symbol")
        or row.get("securityId")
        or row.get("isin")
    )


def _holding_instrument_ref(row: dict[str, Any], symbol: str, exchange: str | None) -> InstrumentRef:
    return InstrumentRef(
        symbol=symbol,
        exchange=exchange,
        zerodha_instrument_token=int(row["instrument_token"]) if str(row.get("instrument_token") or "").isdigit() else None,
        upstox_instrument_key=str(row.get("instrument_key")) if row.get("instrument_key") else None,
        angel_exchange=exchange,
        angel_token=int(row["symboltoken"]) if str(row.get("symboltoken") or "").isdigit() else None,
        dhan_exchange_segment=str(row.get("exchange_segment")) if row.get("exchange_segment") else None,
        dhan_security_id=str(row.get("security_id")) if row.get("security_id") else None,
        groww_exchange=exchange,
        groww_segment=str(row.get("segment")) if row.get("segment") else None,
        groww_trading_symbol=str(row.get("trading_symbol") or row.get("tradingsymbol") or symbol),
        groww_exchange_token=str(row.get("exchange_token")) if row.get("exchange_token") else None,
        indmoney_scrip_code=str(row.get("scrip_code")) if row.get("scrip_code") else None,
        kotak_query=str(row.get("instrument_token") or row.get("token") or symbol),
        kotak_segment=str(row.get("segment") or row.get("exchange_segment")) if row.get("segment") or row.get("exchange_segment") else None,
        kotak_psymbol=str(row.get("psymbol") or row.get("trading_symbol") or row.get("tradingsymbol") or symbol),
    )


def _resolve_holdings_source(
    db: Session,
    *,
    user_id: str,
    account_id: str | None,
) -> tuple[list[HeatmapSourceRow], str, str, BrokerAccount]:
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required for portfolio holdings scope")
    account = db.get(BrokerAccount, account_id)
    if account is None or account.user_id != user_id:
        raise HTTPException(status_code=404, detail="broker account not found")

    payload = broker_data.fetch_holdings(db, account)
    holding_rows = _first_rows_from_payload(payload, ("holdings", "holding", "data"))
    symbols = [_holding_symbol(row) for row in holding_rows]
    symbols = [symbol for symbol in symbols if symbol]
    subscription_rows = (
        db.scalars(
            select(LiveSymbolSubscription).where(
                LiveSymbolSubscription.user_id == user_id,
                LiveSymbolSubscription.account_id == account.id,
                LiveSymbolSubscription.broker_code == account.broker_code,
                LiveSymbolSubscription.status == "active",
                LiveSymbolSubscription.symbol.in_(symbols),
            )
        ).all()
        if symbols
        else []
    )
    source_kinds_by_key, selected_by_key = _subscription_maps(subscription_rows)

    source_rows: list[HeatmapSourceRow] = []
    seen: set[tuple[str, str | None]] = set()
    for row in holding_rows:
        symbol = _holding_symbol(row)
        exchange = _holding_exchange(row)
        if not symbol:
            continue
        key = (symbol, exchange)
        if key in seen:
            continue
        seen.add(key)
        selected = selected_by_key.get(key) or selected_by_key.get((symbol, None))
        stale_price = _as_float(row.get("last_price") or row.get("ltp") or row.get("lastPrice"))
        stale_payload = {"symbol": symbol, "exchange": exchange, "ltp": stale_price, "detail": {"raw": row}} if stale_price else None
        source_rows.append(
            _build_source_row(
                symbol=symbol,
                exchange=exchange,
                instrument_ref=_holding_instrument_ref(row, symbol, exchange),
                source_kinds=source_kinds_by_key.get(key) or source_kinds_by_key.get((symbol, None), []),
                health_status=selected.health_status if selected else "unknown",
                health_reason=selected.health_reason or "" if selected else "",
                last_received_at=selected.last_received_at if selected else None,
                fallback_quote_json=selected.last_quote_json if selected else None,
                stale_payload=stale_payload,
            )
        )

    return source_rows, f"{account.label} holdings", account.id, account


def _resolve_source(
    db: Session,
    *,
    user_id: str,
    scope: HeatmapScope,
    watchlist_id: str | None,
    account_id: str | None,
) -> tuple[list[HeatmapSourceRow], BrokerAccount | None, str, str | None]:
    if scope == "tracked":
        account = _default_account(db, user_id)
        if account is None:
            return [], None, "Tracked symbols", None
        rows, label, selection_id = _resolve_tracked_source(db, user_id=user_id, account=account)
        return rows, account, label, selection_id

    if scope == "watchlist":
        if not watchlist_id:
            raise HTTPException(status_code=400, detail="watchlist_id is required for watchlist scope")
        watchlist = watchlist_svc.get_watchlist(db, user_id, watchlist_id)
        if watchlist is None:
            raise HTTPException(status_code=404, detail="watchlist not found")
        account = _default_account(db, user_id)
        if account is None:
            return [], None, watchlist.name, watchlist.id
        rows, label, selection_id = _resolve_watchlist_source(
            db,
            user_id=user_id,
            watchlist_id=watchlist_id,
            account=account,
        )
        return rows, account, label, selection_id

    if scope == "portfolio_holdings":
        rows, label, selection_id, account = _resolve_holdings_source(db, user_id=user_id, account_id=account_id)
        return rows, account, label, selection_id

    raise HTTPException(status_code=400, detail="invalid heatmap scope")


def _quote_payload_from_quote_row(row: Any, exchange: str | None) -> dict[str, Any]:
    detail = row.detail if isinstance(getattr(row, "detail", None), dict) else {}
    payload: dict[str, Any] = {
        "symbol": row.symbol,
        "exchange": exchange,
        "ltp": float(row.ltp or 0),
        "detail": detail,
    }
    raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else None
    if raw:
        for field in ("day_change", "day_change_perc", "open", "high", "low", "close", "volume", "market_cap"):
            if raw.get(field) is not None:
                payload[field] = raw.get(field)
    return payload


def _load_quote_payloads(
    db: Session,
    *,
    user_id: str,
    account: BrokerAccount | None,
    source_rows: list[HeatmapSourceRow],
    fetch_missing: bool,
) -> dict[tuple[str, str | None], dict[str, Any]]:
    if account is None or not source_rows:
        return {}
    redis_quotes = _load_redis_quotes(
        _redis_client(),
        user_id=user_id,
        account_id=account.id,
        broker_code=account.broker_code,
        symbols=[row.symbol for row in source_rows],
    )

    payloads: dict[tuple[str, str | None], dict[str, Any]] = {}
    missing_rows: list[HeatmapSourceRow] = []
    for row in source_rows:
        payload = redis_quotes.get(row.symbol)
        if payload is None and row.fallback_quote_json:
            parsed = _loads_json(row.fallback_quote_json, {})
            payload = parsed if isinstance(parsed, dict) else None
        if payload is not None:
            normalized = _normalize_live_payload(payload, row.exchange)
            if normalized.get("ltp") is not None:
                if fetch_missing and not _has_change_context(normalized):
                    missing_rows.append(row)
                    continue
                payloads[(row.symbol, row.exchange)] = normalized
                continue
        missing_rows.append(row)

    if fetch_missing and missing_rows:
        try:
            fetched = broker_accounts.fetch_quotes_for_account(
                db,
                account,
                [row.instrument_ref for row in missing_rows],
                push_redis=True,
            )
        except Exception:
            fetched = []
        fetched_by_symbol = {_normal_symbol(row.symbol): row for row in fetched if row.symbol}
        for row in missing_rows:
            fetched_row = fetched_by_symbol.get(row.symbol)
            if fetched_row is not None:
                payload = _quote_payload_from_quote_row(fetched_row, row.exchange)
                normalized = _normalize_live_payload(payload, row.exchange)
                if normalized.get("ltp") is not None:
                    payloads[(row.symbol, row.exchange)] = normalized
                    continue
            if row.stale_payload:
                normalized = _normalize_live_payload(row.stale_payload, row.exchange)
                if normalized.get("ltp") is not None:
                    payloads[(row.symbol, row.exchange)] = normalized

    return payloads


def _touch_heatmap_live_subscriptions(
    db: Session,
    *,
    user_id: str,
    account: BrokerAccount,
    source_rows: list[HeatmapSourceRow],
    scope: str,
    scope_label: str,
    selection_id: str | None,
) -> None:
    if not source_rows:
        return
    source_id = f"heatmap:{scope}:{selection_id or account.id}"
    payloads: list[LiveSubscriptionCreateIn] = []
    seen: set[tuple[str, str | None]] = set()
    for row in source_rows:
        symbol = _normal_symbol(row.symbol)
        if not symbol:
            continue
        exchange = _normal_exchange(row.exchange)
        key = (symbol, exchange)
        if key in seen:
            continue
        seen.add(key)
        ref = InstrumentRef(**row.instrument_ref.model_dump(exclude_none=True))
        ref.symbol = symbol
        if ref.exchange is None and exchange:
            ref.exchange = exchange
        payloads.append(
            LiveSubscriptionCreateIn(
                account_id=account.id,
                broker_code=account.broker_code,
                symbol=symbol,
                exchange=exchange,
                instrument_ref=ref,
                source_kind="ui",
                source_type="heatmap",
                source_id=source_id,
                source_label=f"{scope_label} heatmap",
                owner_kind="ui",
                owner_id=source_id,
            )
        )
    if not payloads:
        return
    rows = alert_svc.touch_ui_live_subscriptions(db, user_id, payloads)
    if rows:
        publish_scope_change(user_id, reason="heatmap_demand")


def datetime_utc_now():
    return datetime.utcnow()


def get_live_heatmap(
    db: Session,
    *,
    user_id: str,
    limit: int,
    days: int | None = None,
    scope: str = "tracked",
    watchlist_id: str | None = None,
    account_id: str | None = None,
) -> HeatmapResponseOut:
    normalized_scope = scope.strip().lower()
    if normalized_scope not in {"tracked", "watchlist", "portfolio_holdings"}:
        raise HTTPException(status_code=400, detail="invalid heatmap scope")

    source_rows, account, scope_label, selection_id = _resolve_source(
        db,
        user_id=user_id,
        scope=normalized_scope,  # type: ignore[arg-type]
        watchlist_id=watchlist_id,
        account_id=account_id,
    )
    tracked_symbol_count = len(source_rows)
    if account is None:
        return HeatmapResponseOut(
            scope=normalized_scope,  # type: ignore[arg-type]
            scope_label=scope_label,
            selection_id=selection_id,
            requested_limit=limit,
            returned_count=0,
            tracked_symbol_count=tracked_symbol_count,
            days=days,
        )

    _touch_heatmap_live_subscriptions(
        db,
        user_id=user_id,
        account=account,
        source_rows=source_rows,
        scope=normalized_scope,
        scope_label=scope_label,
        selection_id=selection_id,
    )

    payload_map = _load_quote_payloads(
        db,
        user_id=user_id,
        account=account,
        source_rows=source_rows,
        fetch_missing=normalized_scope in {"watchlist", "portfolio_holdings"},
    )

    quote_rows: list[tuple[HeatmapSourceRow, dict[str, Any]]] = []
    for row in source_rows:
        normalized = payload_map.get((row.symbol, row.exchange)) or payload_map.get((row.symbol, None))
        if normalized is None or normalized.get("ltp") is None:
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
                health_reason=row.health_reason,
                last_received_at=row.last_received_at,
                source_kinds=row.source_kinds,
                alpha_event_summary=summary,
                alpha_events=event_items,
                live_data=live_data["raw_payload"],
            )
        )

    return HeatmapResponseOut(
        scope=normalized_scope,  # type: ignore[arg-type]
        scope_label=scope_label,
        selection_id=selection_id,
        broker_code=account.broker_code,
        account_id=account.id,
        requested_limit=limit,
        returned_count=len(items),
        tracked_symbol_count=tracked_symbol_count,
        days=days,
        items=items,
    )
