from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.schemas.broker import InstrumentRef
from app.schemas.watchlist import (
    WatchlistCreateIn,
    WatchlistOut,
    WatchlistSymbolCreateIn,
    WatchlistSymbolOut,
    WatchlistSymbolsBulkIn,
    WatchlistSymbolsBulkOut,
    WatchlistSymbolsReplaceIn,
    WatchlistUpdateIn,
)
from db.models import UserWatchlist, UserWatchlistSymbol


def _now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _normalize_name(name: str | None) -> str:
    normalized = (name or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Watchlist name cannot be blank")
    if len(normalized) > 128:
        raise HTTPException(status_code=400, detail="Watchlist name must be 128 characters or fewer")
    return normalized


def _normalize_symbol(symbol: str | None) -> str:
    return (symbol or "").strip().upper()


def _normalize_exchange(exchange: str | None) -> str:
    return (exchange or "").strip().upper()


def _instrument_ref(ref: InstrumentRef | dict[str, Any] | None, symbol: str, exchange: str) -> InstrumentRef:
    normalized = ref if isinstance(ref, InstrumentRef) else InstrumentRef(**(ref or {}))
    normalized.symbol = symbol
    normalized.exchange = exchange or None
    return normalized


def _watchlist_to_out(watchlist: UserWatchlist) -> WatchlistOut:
    ordered_symbols = sorted(watchlist.symbols, key=lambda item: item.sort_order)
    items = [
        WatchlistSymbolOut(
            id=item.id,
            symbol=item.symbol,
            exchange=item.exchange or None,
            instrument_ref=_instrument_ref(_json_loads(item.instrument_ref_json, {}), item.symbol, item.exchange),
            sort_order=item.sort_order,
            created_at=item.created_at,
        )
        for item in ordered_symbols
    ]
    return WatchlistOut(
        id=watchlist.id,
        user_id=watchlist.user_id,
        name=watchlist.name,
        symbols=[item.symbol for item in ordered_symbols],
        items=items,
        created_at=watchlist.created_at,
        updated_at=watchlist.updated_at,
    )


def _get_owned_watchlist(db: Session, user_id: str, watchlist_id: str) -> UserWatchlist | None:
    return db.scalar(
        select(UserWatchlist).where(
            UserWatchlist.id == watchlist_id,
            UserWatchlist.user_id == user_id,
        )
    )


def _watchlist_name_exists(db: Session, user_id: str, name: str, exclude_id: str | None = None) -> bool:
    stmt = select(UserWatchlist.id).where(UserWatchlist.user_id == user_id, UserWatchlist.name == name)
    if exclude_id:
        stmt = stmt.where(UserWatchlist.id != exclude_id)
    return db.scalar(stmt) is not None


def _dedupe_symbol_strings(symbols: list[str], exchange: str = "") -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    normalized: list[tuple[str, str]] = []
    for raw_symbol in symbols:
        symbol = _normalize_symbol(raw_symbol)
        if not symbol:
            continue
        key = (symbol, exchange)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


def _dedupe_symbol_items(items: list[WatchlistSymbolCreateIn]) -> list[tuple[str, str, InstrumentRef]]:
    seen: set[tuple[str, str]] = set()
    normalized: list[tuple[str, str, InstrumentRef]] = []
    for item in items:
        symbol = _normalize_symbol(item.symbol)
        if not symbol:
            continue
        exchange = _normalize_exchange(item.exchange)
        key = (symbol, exchange)
        if key in seen:
            continue
        seen.add(key)
        normalized.append((symbol, exchange, _instrument_ref(item.instrument_ref, symbol, exchange)))
    return normalized


def list_watchlists(db: Session, user_id: str) -> list[WatchlistOut]:
    rows = db.scalars(
        select(UserWatchlist)
        .where(UserWatchlist.user_id == user_id)
        .order_by(desc(UserWatchlist.updated_at))
    ).all()
    return [_watchlist_to_out(row) for row in rows]


def create_watchlist(db: Session, user_id: str, payload: WatchlistCreateIn) -> WatchlistOut:
    name = _normalize_name(payload.name)
    if _watchlist_name_exists(db, user_id, name):
        raise HTTPException(status_code=400, detail="A watchlist with this name already exists")

    now = _now()
    watchlist = UserWatchlist(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=name,
        created_at=now,
        updated_at=now,
    )
    db.add(watchlist)
    db.flush()

    for sort_order, (symbol, exchange) in enumerate(_dedupe_symbol_strings(payload.symbols)):
        ref = _instrument_ref(None, symbol, exchange)
        db.add(
            UserWatchlistSymbol(
                id=str(uuid.uuid4()),
                watchlist_id=watchlist.id,
                symbol=symbol,
                exchange=exchange,
                instrument_ref_json=_json_dumps(ref.model_dump(exclude_none=True)),
                sort_order=sort_order,
                created_at=now,
            )
        )

    db.commit()
    created = _get_owned_watchlist(db, user_id, watchlist.id)
    return _watchlist_to_out(created or watchlist)


def get_watchlist(db: Session, user_id: str, watchlist_id: str) -> WatchlistOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    return _watchlist_to_out(watchlist) if watchlist else None


def update_watchlist(db: Session, user_id: str, watchlist_id: str, payload: WatchlistUpdateIn) -> WatchlistOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return None

    name = _normalize_name(payload.name)
    if _watchlist_name_exists(db, user_id, name, exclude_id=watchlist.id):
        raise HTTPException(status_code=400, detail="A watchlist with this name already exists")

    watchlist.name = name
    watchlist.updated_at = _now()
    db.commit()
    updated = _get_owned_watchlist(db, user_id, watchlist.id)
    return _watchlist_to_out(updated or watchlist)


def delete_watchlist(db: Session, user_id: str, watchlist_id: str) -> bool:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return False
    db.delete(watchlist)
    db.commit()
    return True


def add_symbols_to_watchlist(
    db: Session,
    user_id: str,
    watchlist_id: str,
    payload: WatchlistSymbolsBulkIn,
) -> WatchlistSymbolsBulkOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return None

    exchange = _normalize_exchange(payload.exchange)
    existing = {(item.symbol, item.exchange) for item in watchlist.symbols}
    requested_items = [
        (symbol, normalized_exchange, _instrument_ref(None, symbol, normalized_exchange))
        for symbol, normalized_exchange in _dedupe_symbol_strings(payload.symbols, exchange)
    ]
    requested_items.extend(_dedupe_symbol_items(payload.items))
    added: list[str] = []
    skipped: list[str] = []
    next_sort_order = max((item.sort_order for item in watchlist.symbols), default=-1) + 1
    now = _now()

    for symbol, normalized_exchange, ref in requested_items:
        key = (symbol, normalized_exchange)
        if key in existing:
            skipped.append(symbol)
            continue
        db.add(
            UserWatchlistSymbol(
                id=str(uuid.uuid4()),
                watchlist_id=watchlist.id,
                symbol=symbol,
                exchange=normalized_exchange,
                instrument_ref_json=_json_dumps(ref.model_dump(exclude_none=True)),
                sort_order=next_sort_order,
                created_at=now,
            )
        )
        existing.add(key)
        added.append(symbol)
        next_sort_order += 1

    watchlist.updated_at = now
    db.commit()
    updated = _get_owned_watchlist(db, user_id, watchlist.id)
    return WatchlistSymbolsBulkOut(
        watchlist=_watchlist_to_out(updated or watchlist),
        added_symbols=added,
        skipped_symbols=skipped,
    )


def replace_watchlist_symbols(
    db: Session,
    user_id: str,
    watchlist_id: str,
    payload: WatchlistSymbolsReplaceIn,
) -> WatchlistOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return None

    now = _now()
    for item in list(watchlist.symbols):
        db.delete(item)
    db.flush()

    for sort_order, (symbol, exchange, ref) in enumerate(_dedupe_symbol_items(payload.symbols)):
        db.add(
            UserWatchlistSymbol(
                id=str(uuid.uuid4()),
                watchlist_id=watchlist.id,
                symbol=symbol,
                exchange=exchange,
                instrument_ref_json=_json_dumps(ref.model_dump(exclude_none=True)),
                sort_order=sort_order,
                created_at=now,
            )
        )

    watchlist.updated_at = now
    db.commit()
    updated = _get_owned_watchlist(db, user_id, watchlist.id)
    return _watchlist_to_out(updated or watchlist)


def remove_symbol_from_watchlist(
    db: Session,
    user_id: str,
    watchlist_id: str,
    symbol: str,
    exchange: str | None = None,
) -> WatchlistOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return None

    normalized_symbol = _normalize_symbol(symbol)
    normalized_exchange = _normalize_exchange(exchange)
    if not normalized_symbol:
        return None

    row = db.scalar(
        select(UserWatchlistSymbol).where(
            UserWatchlistSymbol.watchlist_id == watchlist.id,
            UserWatchlistSymbol.symbol == normalized_symbol,
            UserWatchlistSymbol.exchange == normalized_exchange,
        )
    )
    if row is None:
        return None

    db.delete(row)
    watchlist.updated_at = _now()
    db.commit()
    updated = _get_owned_watchlist(db, user_id, watchlist.id)
    return _watchlist_to_out(updated or watchlist)
