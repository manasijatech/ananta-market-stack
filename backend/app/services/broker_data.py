from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.broker import DataCapabilityItem, InstrumentSearchRow, InstrumentSyncOut, QuoteRow
from broker.core.instrument_store import (
    SQLiteInstrumentResolver,
    create_sync_run,
    finish_sync_run,
    latest_sync_run,
    replace_instruments,
    search_instruments as search_cached_instruments,
)
from broker.core.registry import get_client_for_account
from db.models import BrokerAccount, BrokerInstrument


def _resolver(db: Session, broker_code: str) -> SQLiteInstrumentResolver:
    return SQLiteInstrumentResolver(db, broker_code)


def _client(db: Session, acc: BrokerAccount):
    return get_client_for_account(acc, resolver=_resolver(db, acc.broker_code))


def _instrument_row_to_schema(row: BrokerInstrument) -> InstrumentSearchRow:
    return InstrumentSearchRow(
        symbol=row.symbol,
        exchange=row.exchange,
        segment=row.segment,
        trading_symbol=row.trading_symbol,
        name=row.name,
        isin=row.isin,
        instrument_type=row.instrument_type,
        expiry=row.expiry,
        strike=row.strike,
        option_type=row.option_type,
        lot_size=row.lot_size,
        tick_size=row.tick_size,
        identifiers={
            "zerodha_instrument_token": row.zerodha_instrument_token,
            "upstox_instrument_key": row.upstox_instrument_key,
            "angel_token": row.angel_token,
            "dhan_security_id": row.dhan_security_id,
            "dhan_exchange_segment": row.dhan_exchange_segment,
            "groww_trading_symbol": row.groww_trading_symbol,
            "indmoney_scrip_code": row.indmoney_scrip_code,
            "kotak_query": row.kotak_query,
            "kotak_segment": row.kotak_segment,
            "kotak_psymbol": row.kotak_psymbol,
        },
    )


def _hydrate_exact_match(
    db: Session,
    broker_code: str,
    instrument: dict[str, Any],
) -> dict[str, Any]:
    symbol = str(instrument.get("symbol") or "").strip()
    exchange = str(instrument.get("exchange") or "").strip()
    if not symbol:
        return instrument
    stmt = select(BrokerInstrument).where(BrokerInstrument.broker_code == broker_code)
    stmt = stmt.where(BrokerInstrument.symbol == symbol)
    if exchange:
        stmt = stmt.where(BrokerInstrument.exchange == exchange)
    row = db.scalars(stmt.limit(1)).first()
    if not row:
        return instrument
    merged = dict(instrument)
    merged.setdefault("exchange", row.exchange)
    merged.setdefault("segment", row.segment)
    merged.setdefault("trading_symbol", row.trading_symbol)
    merged.setdefault("instrument_type", row.instrument_type)
    merged.setdefault("zerodha_instrument_token", row.zerodha_instrument_token)
    merged.setdefault("upstox_instrument_key", row.upstox_instrument_key)
    merged.setdefault("angel_token", row.angel_token)
    merged.setdefault("angel_exchange", row.exchange)
    merged.setdefault("dhan_security_id", row.dhan_security_id)
    merged.setdefault("dhan_exchange_segment", row.dhan_exchange_segment)
    merged.setdefault("groww_exchange", row.groww_exchange or row.exchange)
    merged.setdefault("groww_segment", row.groww_segment or row.segment)
    merged.setdefault("groww_trading_symbol", row.groww_trading_symbol or row.trading_symbol)
    merged.setdefault("groww_symbol", _native_payload_value(row, "groww_symbol"))
    merged.setdefault("indmoney_scrip_code", row.indmoney_scrip_code)
    merged.setdefault("kotak_query", row.kotak_query)
    merged.setdefault("kotak_segment", row.kotak_segment)
    merged.setdefault("kotak_psymbol", row.kotak_psymbol)
    return merged


def _native_payload_value(row: BrokerInstrument, key: str) -> str | None:
    try:
        payload = json.loads(row.native_payload_json or "{}")
    except json.JSONDecodeError:
        return None
    value = payload.get(key)
    return str(value) if value is not None else None


def _snapshot_instruments_from_portfolio(acc: BrokerAccount, client: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    payloads = [
        client.holdings(),
        client.positions(),
        client.order_book(),
        client.trade_book(),
    ]
    for payload in payloads:
        candidates: list[dict[str, Any]] = []
        if isinstance(payload, dict):
            for key in ("data", "payload", "holdings", "positions", "orders", "trades", "net"):
                value = payload.get(key)
                if isinstance(value, list):
                    candidates.extend(item for item in value if isinstance(item, dict))
        elif isinstance(payload, list):
            candidates.extend(item for item in payload if isinstance(item, dict))
        for item in candidates:
            symbol = str(
                item.get("tradingsymbol")
                or item.get("trading_symbol")
                or item.get("symbol")
                or item.get("securityId")
                or ""
            ).strip()
            exchange = str(item.get("exchange") or item.get("exchange_segment") or "NSE").strip()
            if not symbol or (symbol, exchange) in seen:
                continue
            seen.add((symbol, exchange))
            rows.append(
                {
                    "symbol": symbol,
                    "exchange": exchange,
                    "segment": item.get("segment") or item.get("producttype"),
                    "trading_symbol": item.get("tradingsymbol") or item.get("trading_symbol") or symbol,
                    "name": item.get("company_name") or item.get("name"),
                    "instrument_type": item.get("instrumenttype") or item.get("instrument_type"),
                    "zerodha_instrument_token": item.get("instrument_token"),
                    "upstox_instrument_key": item.get("instrument_key"),
                    "angel_token": item.get("symboltoken") or item.get("symbolToken"),
                    "dhan_security_id": item.get("securityId"),
                    "dhan_exchange_segment": item.get("exchangeSegment"),
                    "groww_trading_symbol": item.get("trading_symbol"),
                    "indmoney_scrip_code": item.get("scrip_code"),
                    "kotak_query": item.get("neo_symbol"),
                    "raw_payload": item,
                }
            )
    return rows


def get_capabilities(db: Session, acc: BrokerAccount) -> dict[str, DataCapabilityItem]:
    last_sync = latest_sync_run(db, acc.broker_code)
    capabilities: dict[str, DataCapabilityItem] = {
        "instruments_sync": DataCapabilityItem(
            supported=True,
            guidance="Instrument sync stores broker instrument metadata in SQLite. Some brokers may fall back to portfolio-derived symbols if a master download is unavailable.",
        ),
        "instrument_search": DataCapabilityItem(
            supported=bool(last_sync and last_sync.row_count > 0),
            guidance="Search becomes useful after at least one instrument sync completes.",
        ),
        "quotes": DataCapabilityItem(supported=True, guidance="Real-time quote fetch is wired for all supported brokers."),
        "ohlc": DataCapabilityItem(supported=True, guidance="OHLC uses broker OHLC endpoints where available and quote-derived snapshots otherwise."),
        "historical": DataCapabilityItem(
            supported=acc.broker_code in {"groww", "zerodha", "upstox", "dhan", "angel", "indmoney"},
            guidance="Historical data support varies by broker and endpoint maturity.",
        ),
        "option_chain": DataCapabilityItem(
            supported=acc.broker_code in {"groww", "dhan"},
            guidance="Option chain is currently wired for Groww and Dhan.",
        ),
        "greeks": DataCapabilityItem(
            supported=acc.broker_code == "groww",
            guidance="Greeks are currently derived from Groww option chain responses.",
        ),
        "stream": DataCapabilityItem(supported=True, guidance="WebSocket v1 is an on-demand test manager that uses a uniform read-only flow."),
    }
    return capabilities


def sync_instruments_for_account(db: Session, acc: BrokerAccount) -> InstrumentSyncOut:
    client = _client(db, acc)
    run = create_sync_run(db, acc.broker_code)
    try:
        rows = client.sync_instruments()
        if not rows:
            rows = _snapshot_instruments_from_portfolio(acc, client)
        count = replace_instruments(db, acc.broker_code, rows)
        run = finish_sync_run(db, run, status="completed", row_count=count)
    except Exception as exc:
        run = finish_sync_run(db, run, status="failed", row_count=0, error=str(exc)[:2000])
    return InstrumentSyncOut(
        broker=acc.broker_code,
        sync_status=run.status,
        row_count=run.row_count,
        started_at=run.started_at,
        finished_at=run.finished_at,
        error=run.error,
    )


def search_instruments(
    db: Session,
    acc: BrokerAccount,
    *,
    query: str = "",
    exchange: str | None = None,
    segment: str | None = None,
    limit: int = 50,
) -> list[InstrumentSearchRow]:
    rows = search_cached_instruments(
        db,
        acc.broker_code,
        query=query,
        exchange=exchange,
        segment=segment,
        limit=limit,
    )
    return [_instrument_row_to_schema(row) for row in rows]


def fetch_quotes(
    db: Session,
    acc: BrokerAccount,
    instruments: list[dict[str, Any]],
) -> list[QuoteRow]:
    client = _client(db, acc)
    hydrated = [_hydrate_exact_match(db, acc.broker_code, item) for item in instruments]
    rows = client.fetch_quotes(hydrated)
    return [
        QuoteRow(
            symbol=row.get("symbol"),
            ltp=float(row.get("ltp") or 0),
            broker_code=acc.broker_code,
            account_id=acc.id,
            detail={k: v for k, v in row.items() if k not in {"symbol", "ltp"}},
        )
        for row in rows
    ]


def fetch_ohlc(
    db: Session,
    acc: BrokerAccount,
    instruments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    client = _client(db, acc)
    hydrated = [_hydrate_exact_match(db, acc.broker_code, item) for item in instruments]
    return client.fetch_ohlc(hydrated)


def fetch_historical(db: Session, acc: BrokerAccount, payload: dict[str, Any]) -> dict[str, Any]:
    client = _client(db, acc)
    request = dict(payload)
    request["instrument"] = _hydrate_exact_match(db, acc.broker_code, dict(payload.get("instrument") or {}))
    return client.fetch_historical(request)


def fetch_option_chain(db: Session, acc: BrokerAccount, payload: dict[str, Any]) -> dict[str, Any]:
    client = _client(db, acc)
    request = dict(payload)
    request = _hydrate_exact_match(db, acc.broker_code, request)
    return client.option_chain(request)


def fetch_greeks(db: Session, acc: BrokerAccount, payload: dict[str, Any]) -> dict[str, Any]:
    client = _client(db, acc)
    request = dict(payload)
    request = _hydrate_exact_match(db, acc.broker_code, request)
    return client.greeks(request)


def stream_status(db: Session, acc: BrokerAccount) -> dict[str, Any]:
    _ = db
    client = _client(db, acc)
    return client.stream_capabilities()
