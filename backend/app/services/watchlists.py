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
    WatchlistPresetCatalogEntryOut,
    WatchlistSymbolCreateIn,
    WatchlistSymbolOut,
    WatchlistSymbolsBulkIn,
    WatchlistSymbolsBulkOut,
    WatchlistSymbolsReplaceIn,
    WatchlistUpdateIn,
)
from app.services.alerts_engine.reconcile import reconcile_user_subscriptions
from app.services import watchlist_presets as preset_svc
from db.models import (
    BrokerAccount,
    LiveSymbolSubscription,
    SystemWatchlistPreset,
    SystemWatchlistPresetSymbol,
    UserBrokerDataPreference,
    UserWatchlist,
    UserWatchlistSymbol,
)


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
    ordered_symbols: list[UserWatchlistSymbol | SystemWatchlistPresetSymbol]
    preset = watchlist.system_preset if watchlist.kind == "preset" else None
    if watchlist.kind == "preset" and preset is not None:
        ordered_symbols = sorted(preset.symbols, key=lambda item: item.sort_order)
    else:
        ordered_symbols = sorted(watchlist.symbols, key=lambda item: item.sort_order)
    items = [
        WatchlistSymbolOut(
            id=item.id,
            symbol=item.symbol,
            exchange=item.exchange or None,
            instrument_ref=_instrument_ref(
                _json_loads(getattr(item, "instrument_ref_json", None), {}),
                item.symbol,
                item.exchange,
            ),
            sort_order=item.sort_order,
            created_at=item.created_at,
        )
        for item in ordered_symbols
    ]
    return WatchlistOut(
        id=watchlist.id,
        user_id=watchlist.user_id,
        name=watchlist.name,
        kind=watchlist.kind,
        is_editable=watchlist.kind == "manual",
        preset_id=preset.id if preset else None,
        preset_slug=preset.slug if preset else None,
        preset_sync_status=preset.sync_status if preset else None,
        preset_last_synced_at=preset.last_constituents_sync_at if preset else None,
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


def _ensure_manual_watchlist(watchlist: UserWatchlist) -> None:
    if watchlist.kind != "manual":
        raise HTTPException(status_code=400, detail="Preset watchlists cannot be modified")


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


def _dedupe_subscription_items(
    items: list[tuple[str, str, InstrumentRef, str | None, str | None]],
) -> list[tuple[str, str, InstrumentRef, str | None, str | None]]:
    seen: set[tuple[str, str, str | None, str | None]] = set()
    normalized: list[tuple[str, str, InstrumentRef, str | None, str | None]] = []
    for symbol, exchange, ref, account_id, broker_code in items:
        key = (symbol, exchange, account_id, broker_code)
        if not symbol or key in seen:
            continue
        seen.add(key)
        normalized.append((symbol, exchange, ref, account_id, broker_code))
    return normalized


def _default_broker_account(db: Session, user_id: str, broker_code: str | None = None) -> BrokerAccount | None:
    stmt = (
        select(BrokerAccount)
        .where(BrokerAccount.user_id == user_id, BrokerAccount.is_active.is_(True))
        .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
    )
    if broker_code:
        stmt = stmt.where(BrokerAccount.broker_code == broker_code)
    accounts = list(db.scalars(stmt).all())
    if not accounts:
        return None

    pref = db.get(UserBrokerDataPreference, user_id)
    preferred_account_id = pref.preferred_search_account_id if pref else None
    if preferred_account_id:
        for account in accounts:
            if account.id == preferred_account_id:
                return account

    verified = [account for account in accounts if account.last_verified_at]
    return (verified or accounts)[0]


def _resolve_subscription_account(
    db: Session,
    user_id: str,
    account_id: str | None,
    broker_code: str | None,
) -> tuple[str | None, str | None]:
    normalized_account_id = (account_id or "").strip() or None
    normalized_broker_code = (broker_code or "").strip().lower() or None
    account: BrokerAccount | None = None
    if normalized_account_id:
        account = db.get(BrokerAccount, normalized_account_id)
        if not account or account.user_id != user_id or not account.is_active:
            account = None
    if account is None:
        account = _default_broker_account(db, user_id, normalized_broker_code)
    if account is None:
        return normalized_account_id, normalized_broker_code
    return account.id, account.broker_code


def _ensure_watchlist_subscriptions(
    db: Session,
    user_id: str,
    items: list[tuple[str, str, InstrumentRef, str | None, str | None]],
) -> None:
    now = _now()
    for symbol, exchange, ref, account_id, broker_code in _dedupe_subscription_items(items):
        resolved_account_id, resolved_broker_code = _resolve_subscription_account(
            db,
            user_id,
            account_id,
            broker_code,
        )
        subscription_exchange = exchange or None
        row = db.scalar(
            select(LiveSymbolSubscription).where(
                LiveSymbolSubscription.user_id == user_id,
                LiveSymbolSubscription.account_id == resolved_account_id,
                LiveSymbolSubscription.workflow_id.is_(None),
                LiveSymbolSubscription.symbol == symbol,
                LiveSymbolSubscription.exchange == subscription_exchange,
            )
        )
        if row is None:
            row = LiveSymbolSubscription(
                id=str(uuid.uuid4()),
                user_id=user_id,
                workflow_id=None,
                account_id=resolved_account_id,
                broker_code=resolved_broker_code,
                symbol=symbol,
                exchange=subscription_exchange,
                source_kind="watchlist",
                created_at=now,
            )
        row.instrument_ref_json = _json_dumps(ref.model_dump(exclude_none=True))
        row.broker_code = resolved_broker_code
        row.status = "active"
        row.updated_at = now
        db.add(row)


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
        kind="manual",
        created_at=now,
        updated_at=now,
    )
    db.add(watchlist)
    db.flush()

    subscription_items: list[tuple[str, str, InstrumentRef, str | None, str | None]] = []
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
        subscription_items.append((symbol, exchange, ref, None, None))

    db.commit()
    reconcile_user_subscriptions(db, user_id)
    created = _get_owned_watchlist(db, user_id, watchlist.id)
    return _watchlist_to_out(created or watchlist)


def get_watchlist(db: Session, user_id: str, watchlist_id: str) -> WatchlistOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return None
    return _watchlist_to_out(watchlist)


def update_watchlist(db: Session, user_id: str, watchlist_id: str, payload: WatchlistUpdateIn) -> WatchlistOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return None
    _ensure_manual_watchlist(watchlist)

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
    reconcile_user_subscriptions(db, user_id)
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
    _ensure_manual_watchlist(watchlist)

    exchange = _normalize_exchange(payload.exchange)
    existing = {(item.symbol, item.exchange) for item in watchlist.symbols}
    requested_items: list[tuple[str, str, InstrumentRef, str | None, str | None]] = [
        (symbol, normalized_exchange, _instrument_ref(None, symbol, normalized_exchange), None, None)
        for symbol, normalized_exchange in _dedupe_symbol_strings(payload.symbols, exchange)
    ]
    requested_items.extend(
        (
            symbol,
            normalized_exchange,
            _instrument_ref(item.instrument_ref, symbol, normalized_exchange),
            item.account_id,
            item.broker_code,
        )
        for item in payload.items
        for symbol, normalized_exchange in [(_normalize_symbol(item.symbol), _normalize_exchange(item.exchange))]
        if symbol
    )
    added: list[str] = []
    skipped: list[str] = []
    next_sort_order = max((item.sort_order for item in watchlist.symbols), default=-1) + 1
    now = _now()

    subscription_items: list[tuple[str, str, InstrumentRef, str | None, str | None]] = []
    for symbol, normalized_exchange, ref, account_id, broker_code in _dedupe_subscription_items(requested_items):
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
        subscription_items.append((symbol, normalized_exchange, ref, account_id, broker_code))
        next_sort_order += 1

    watchlist.updated_at = now
    db.commit()
    reconcile_user_subscriptions(db, user_id)
    updated = _get_owned_watchlist(db, user_id, watchlist.id)
    out = _watchlist_to_out(updated or watchlist)
    return WatchlistSymbolsBulkOut(
        watchlist=out,
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
    _ensure_manual_watchlist(watchlist)

    now = _now()
    for item in list(watchlist.symbols):
        db.delete(item)
    db.flush()

    requested_items = [
        (
            symbol,
            exchange,
            _instrument_ref(item.instrument_ref, symbol, exchange),
            item.account_id,
            item.broker_code,
        )
        for item in payload.symbols
        for symbol, exchange in [(_normalize_symbol(item.symbol), _normalize_exchange(item.exchange))]
        if symbol
    ]
    subscription_items: list[tuple[str, str, InstrumentRef, str | None, str | None]] = []
    for sort_order, (symbol, exchange, ref, account_id, broker_code) in enumerate(
        _dedupe_subscription_items(requested_items)
    ):
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
        subscription_items.append((symbol, exchange, ref, account_id, broker_code))

    watchlist.updated_at = now
    db.commit()
    reconcile_user_subscriptions(db, user_id)
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
    _ensure_manual_watchlist(watchlist)

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
    reconcile_user_subscriptions(db, user_id)
    updated = _get_owned_watchlist(db, user_id, watchlist.id)
    return _watchlist_to_out(updated or watchlist)


def list_preset_catalog(
    db: Session,
    user_id: str,
    *,
    query: str = "",
    limit: int = 30,
) -> list[WatchlistPresetCatalogEntryOut]:
    return [WatchlistPresetCatalogEntryOut(**item) for item in preset_svc.list_preset_catalog(db, user_id, query=query, limit=limit)]


def add_preset_watchlist(db: Session, user_id: str, preset_id: str) -> WatchlistOut:
    watchlist = preset_svc.add_preset_to_user_watchlists(db, user_id, preset_id)
    reconcile_user_subscriptions(db, user_id)
    updated = _get_owned_watchlist(db, user_id, watchlist.id)
    return _watchlist_to_out(updated or watchlist)


def refresh_watchlist(db: Session, user_id: str, watchlist_id: str) -> WatchlistOut | None:
    watchlist = _get_owned_watchlist(db, user_id, watchlist_id)
    if watchlist is None:
        return None
    if watchlist.kind != "preset":
        raise HTTPException(status_code=400, detail="Only preset watchlists can be refreshed")
    refreshed = preset_svc.refresh_user_preset_watchlist(db, user_id, watchlist_id)
    reconcile_user_subscriptions(db, user_id)
    updated = _get_owned_watchlist(db, user_id, refreshed.id)
    return _watchlist_to_out(updated or refreshed)
