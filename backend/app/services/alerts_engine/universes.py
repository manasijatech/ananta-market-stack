from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.broker import InstrumentRef
from app.services.alerts_engine.ast import AlertUniverseNode
from db.models import BrokerInstrument, UserWatchlist, UserWatchlistSymbol


@dataclass(frozen=True)
class ResolvedSymbol:
    symbol: str
    exchange: str | None = None
    instrument_ref: InstrumentRef | None = None
    source_type: str = "static_symbols"
    source_id: str | None = None
    source_label: str | None = None


def _json_loads(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}


def _key(item: ResolvedSymbol) -> tuple[str, str | None]:
    return (item.symbol, item.exchange)


def _static(node: AlertUniverseNode) -> list[ResolvedSymbol]:
    result: list[ResolvedSymbol] = []
    for item in node.symbols:
        symbol = str(item.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        exchange = str(item.get("exchange") or "").strip().upper() or None
        result.append(
            ResolvedSymbol(
                symbol=symbol,
                exchange=exchange,
                instrument_ref=InstrumentRef(**(item.get("instrument_ref") or {})),
                source_type="static_symbols",
                source_label=node.label,
            )
        )
    return result


def _watchlist(db: Session, user_id: str, node: AlertUniverseNode) -> list[ResolvedSymbol]:
    if not node.watchlist_id:
        return []
    watchlist = db.scalar(select(UserWatchlist).where(UserWatchlist.id == node.watchlist_id, UserWatchlist.user_id == user_id))
    if not watchlist:
        return []
    rows = db.scalars(select(UserWatchlistSymbol).where(UserWatchlistSymbol.watchlist_id == watchlist.id)).all()
    return [
        ResolvedSymbol(
            symbol=row.symbol,
            exchange=row.exchange or None,
            instrument_ref=InstrumentRef(**_json_loads(row.instrument_ref_json)),
            source_type="watchlist",
            source_id=watchlist.id,
            source_label=watchlist.name,
        )
        for row in rows
    ]


PRESETS: dict[str, dict[str, Any]] = {
    "all-equity": {"id": "all-equity", "label": "All equity instruments", "filters": {"instrument_type": "EQ"}},
    "nse-equity": {"id": "nse-equity", "label": "NSE equity instruments", "filters": {"exchange": "NSE", "instrument_type": "EQ"}},
    "derivatives": {"id": "derivatives", "label": "Derivative instruments", "filters": {"segment_contains": "FO"}},
}


def list_presets() -> list[dict[str, Any]]:
    return list(PRESETS.values())


def _metadata_filter(db: Session, node: AlertUniverseNode) -> list[ResolvedSymbol]:
    filters = node.filters or {}
    stmt = select(BrokerInstrument)
    if filters.get("exchange"):
        stmt = stmt.where(BrokerInstrument.exchange == str(filters["exchange"]).upper())
    if filters.get("instrument_type"):
        stmt = stmt.where(BrokerInstrument.instrument_type == str(filters["instrument_type"]).upper())
    if filters.get("segment"):
        stmt = stmt.where(BrokerInstrument.segment == str(filters["segment"]))
    if filters.get("segment_contains"):
        stmt = stmt.where(BrokerInstrument.segment.ilike(f"%{filters['segment_contains']}%"))
    rows = db.scalars(stmt.limit(int(filters.get("limit") or 1000))).all()
    return [
        ResolvedSymbol(
            symbol=row.symbol,
            exchange=row.exchange,
            instrument_ref=InstrumentRef(
                symbol=row.symbol,
                exchange=row.exchange,
                zerodha_instrument_token=int(row.zerodha_instrument_token) if row.zerodha_instrument_token and str(row.zerodha_instrument_token).isdigit() else None,
                upstox_instrument_key=row.upstox_instrument_key,
                angel_token=int(row.angel_token) if row.angel_token and str(row.angel_token).isdigit() else None,
                dhan_security_id=row.dhan_security_id,
                groww_trading_symbol=row.groww_trading_symbol,
                indmoney_scrip_code=row.indmoney_scrip_code,
                kotak_query=row.kotak_query,
                kotak_segment=row.kotak_segment,
                kotak_psymbol=row.kotak_psymbol,
            ),
            source_type=node.kind,
            source_id=node.preset_id,
            source_label=node.label,
        )
        for row in rows
        if row.symbol
    ]


def resolve_universe(db: Session, user_id: str, node: AlertUniverseNode) -> list[ResolvedSymbol]:
    if node.kind == "static_symbols":
        result = _static(node)
    elif node.kind == "watchlist":
        result = _watchlist(db, user_id, node)
    elif node.kind == "curated_preset":
        preset = PRESETS.get(node.preset_id or "")
        merged = {**(preset or {}).get("filters", {}), **(node.filters or {})}
        result = _metadata_filter(db, AlertUniverseNode(kind="curated_preset", preset_id=node.preset_id, label=(preset or {}).get("label") or node.label, filters=merged))
    elif node.kind == "metadata_filter":
        result = _metadata_filter(db, node)
    elif node.kind == "set_expression":
        child_sets = [resolve_universe(db, user_id, child) for child in node.children]
        if not child_sets:
            result = []
        elif node.op == "intersection":
            keys = set(_key(item) for item in child_sets[0])
            for items in child_sets[1:]:
                keys &= {_key(item) for item in items}
            result = [item for item in child_sets[0] if _key(item) in keys]
        elif node.op == "exclusion":
            excluded = set()
            for items in child_sets[1:]:
                excluded |= {_key(item) for item in items}
            result = [item for item in child_sets[0] if _key(item) not in excluded]
        else:
            merged: dict[tuple[str, str | None], ResolvedSymbol] = {}
            for items in child_sets:
                for item in items:
                    merged.setdefault(_key(item), item)
            result = list(merged.values())
    else:
        result = []
    deduped: dict[tuple[str, str | None], ResolvedSymbol] = {}
    for item in result:
        deduped.setdefault(_key(item), item)
    return list(deduped.values())

