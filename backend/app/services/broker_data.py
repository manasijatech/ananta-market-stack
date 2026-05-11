from __future__ import annotations

import csv
import json
from pathlib import Path
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.broker import DataCapabilityItem, InstrumentSearchRow, InstrumentSyncOut, QuoteRow
from broker.core.instrument_store import (
    clear_instruments,
    count_instruments,
    parse_expiry,
    SQLiteInstrumentResolver,
    create_sync_run,
    finish_sync_run,
    replace_instruments,
    search_instruments as search_cached_instruments,
)
from broker.core.registry import get_client_for_account
from db.models import BrokerAccount, BrokerInstrument

_INSTRUMENT_EXPORT_DIR = Path(__file__).resolve().parents[2] / "data" / "instruments"


def _resolver(db: Session, broker_code: str) -> SQLiteInstrumentResolver:
    return SQLiteInstrumentResolver(db, broker_code)


def _client(db: Session, acc: BrokerAccount):
    return get_client_for_account(acc, resolver=_resolver(db, acc.broker_code))


def _instrument_row_to_schema(row: BrokerInstrument) -> InstrumentSearchRow:
    return InstrumentSearchRow(
        symbol=row.symbol,
        source="db",
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
        csv_match = _csv_exact_match(broker_code, symbol=symbol, exchange=exchange)
        if csv_match:
            return {**csv_match, **instrument}
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


def _csv_exact_match(broker_code: str, *, symbol: str, exchange: str) -> dict[str, Any] | None:
    csv_path = _csv_path_for_broker(broker_code)
    if not csv_path.exists():
        return None
    normalized_symbol = symbol.strip().upper()
    normalized_exchange = exchange.strip().upper()
    with csv_path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            row_symbol = (_csv_value(row, "symbol") or "").upper()
            row_trading_symbol = (_csv_value(row, "trading_symbol") or "").upper()
            row_exchange = (_csv_value(row, "exchange") or "").upper()
            if normalized_exchange and row_exchange != normalized_exchange:
                continue
            if normalized_symbol not in {row_symbol, row_trading_symbol}:
                continue
            return {
                "symbol": _csv_value(row, "symbol"),
                "exchange": _csv_value(row, "exchange"),
                "segment": _csv_value(row, "segment"),
                "trading_symbol": _csv_value(row, "trading_symbol"),
                "instrument_type": _csv_value(row, "instrument_type"),
                "zerodha_instrument_token": _csv_value(row, "zerodha_instrument_token"),
                "upstox_instrument_key": _csv_value(row, "upstox_instrument_key"),
                "angel_token": _csv_value(row, "angel_token"),
                "angel_exchange": _csv_value(row, "exchange"),
                "dhan_security_id": _csv_value(row, "dhan_security_id"),
                "dhan_exchange_segment": _csv_value(row, "dhan_exchange_segment"),
                "groww_exchange": _csv_value(row, "groww_exchange") or _csv_value(row, "exchange"),
                "groww_segment": _csv_value(row, "groww_segment") or _csv_value(row, "segment"),
                "groww_trading_symbol": _csv_value(row, "groww_trading_symbol") or _csv_value(row, "trading_symbol"),
                "indmoney_scrip_code": _csv_value(row, "indmoney_scrip_code"),
                "kotak_query": _csv_value(row, "kotak_query"),
                "kotak_segment": _csv_value(row, "kotak_segment"),
                "kotak_psymbol": _csv_value(row, "kotak_psymbol"),
            }
    return None


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


def _csv_path_for_broker(broker_code: str) -> Path:
    return _INSTRUMENT_EXPORT_DIR / f"{broker_code}_instruments.csv"


def _csv_relpath(path: Path) -> str:
    return str(path.relative_to(Path(__file__).resolve().parents[3]))


def _instrument_sync_out(
    *,
    broker_code: str,
    sync_status: str,
    row_count: int,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
    error: str | None = None,
    storage_target: str,
    csv_path: str | None = None,
    deleted_db_rows: int | None = None,
    deleted_csv: bool | None = None,
) -> InstrumentSyncOut:
    return InstrumentSyncOut(
        broker=broker_code,
        sync_status=sync_status,
        row_count=row_count,
        started_at=started_at,
        finished_at=finished_at,
        error=error,
        storage_target=storage_target,
        csv_path=csv_path,
        deleted_db_rows=deleted_db_rows,
        deleted_csv=deleted_csv,
    )


def _fetch_instrument_rows(db: Session, acc: BrokerAccount) -> list[dict[str, Any]]:
    client = _client(db, acc)
    rows = client.sync_instruments()
    if not rows:
        rows = _snapshot_instruments_from_portfolio(acc, client)
    return rows


def _csv_value(row: dict[str, str], key: str) -> str | None:
    value = (row.get(key) or "").strip()
    return value or None


def _csv_search_rows(
    broker_code: str,
    *,
    query: str = "",
    exchange: str | None = None,
    segment: str | None = None,
    limit: int = 50,
) -> list[InstrumentSearchRow]:
    csv_path = _csv_path_for_broker(broker_code)
    if not csv_path.exists():
        return []
    normalized_query = query.strip().lower()
    normalized_exchange = (exchange or "").strip().lower()
    normalized_segment = (segment or "").strip().lower()
    results: list[InstrumentSearchRow] = []
    with csv_path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            row_exchange = _csv_value(row, "exchange")
            row_segment = _csv_value(row, "segment")
            if normalized_exchange and (row_exchange or "").lower() != normalized_exchange:
                continue
            if normalized_segment and (row_segment or "").lower() != normalized_segment:
                continue
            haystack = " ".join(
                filter(
                    None,
                    [
                        _csv_value(row, "symbol"),
                        _csv_value(row, "trading_symbol"),
                        _csv_value(row, "name"),
                        row_exchange,
                        row_segment,
                        _csv_value(row, "isin"),
                        _csv_value(row, "instrument_type"),
                        _csv_value(row, "option_type"),
                    ],
                )
            ).lower()
            if normalized_query and normalized_query not in haystack:
                continue
            results.append(
                InstrumentSearchRow(
                    symbol=_csv_value(row, "symbol") or "unknown",
                    source="csv",
                    exchange=row_exchange,
                    segment=row_segment,
                    trading_symbol=_csv_value(row, "trading_symbol"),
                    name=_csv_value(row, "name"),
                    isin=_csv_value(row, "isin"),
                    instrument_type=_csv_value(row, "instrument_type"),
                    expiry=parse_expiry(_csv_value(row, "expiry")),
                    strike=_csv_value(row, "strike"),
                    option_type=_csv_value(row, "option_type"),
                    lot_size=_csv_value(row, "lot_size"),
                    tick_size=_csv_value(row, "tick_size"),
                    identifiers={
                        "zerodha_instrument_token": _csv_value(row, "zerodha_instrument_token"),
                        "upstox_instrument_key": _csv_value(row, "upstox_instrument_key"),
                        "angel_token": _csv_value(row, "angel_token"),
                        "dhan_security_id": _csv_value(row, "dhan_security_id"),
                        "dhan_exchange_segment": _csv_value(row, "dhan_exchange_segment"),
                        "groww_trading_symbol": _csv_value(row, "groww_trading_symbol"),
                        "indmoney_scrip_code": _csv_value(row, "indmoney_scrip_code"),
                        "kotak_query": _csv_value(row, "kotak_query"),
                        "kotak_segment": _csv_value(row, "kotak_segment"),
                        "kotak_psymbol": _csv_value(row, "kotak_psymbol"),
                    },
                )
            )
            if len(results) >= max(1, min(limit, 200)):
                break
    return results


def _write_csv(rows: list[dict[str, Any]], csv_path: Path) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)
    if not fieldnames:
        fieldnames = ["symbol", "exchange"]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    key: json.dumps(value, default=str) if isinstance(value, (dict, list)) else value
                    for key, value in row.items()
                }
            )


def get_capabilities(db: Session, acc: BrokerAccount) -> dict[str, DataCapabilityItem]:
    cached_count = count_instruments(db, acc.broker_code)
    csv_available = _csv_path_for_broker(acc.broker_code).exists()
    capabilities: dict[str, DataCapabilityItem] = {
        "instruments_sync": DataCapabilityItem(
            supported=True,
            guidance="Default instrument sync stores broker instrument metadata in a local CSV export. SQLite sync remains available when you explicitly need indexed local search state.",
        ),
        "instrument_search": DataCapabilityItem(
            supported=cached_count > 0 or csv_available,
            guidance="Search uses the SQLite cache first and falls back to the local broker CSV export when needed.",
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
    return sync_instruments_to_csv(db, acc)


def sync_instruments_to_db(db: Session, acc: BrokerAccount) -> InstrumentSyncOut:
    run = create_sync_run(db, acc.broker_code)
    try:
        rows = _fetch_instrument_rows(db, acc)
        count = replace_instruments(db, acc.broker_code, rows)
        run = finish_sync_run(db, run, status="completed", row_count=count)
    except Exception as exc:
        run = finish_sync_run(db, run, status="failed", row_count=0, error=str(exc)[:2000])
    return _instrument_sync_out(
        broker_code=acc.broker_code,
        sync_status=run.status,
        row_count=run.row_count,
        started_at=run.started_at,
        finished_at=run.finished_at,
        error=run.error,
        storage_target="db",
    )


def sync_instruments_to_csv(db: Session, acc: BrokerAccount) -> InstrumentSyncOut:
    started_at = datetime.utcnow()
    csv_path = _csv_path_for_broker(acc.broker_code)
    try:
        rows = _fetch_instrument_rows(db, acc)
        _write_csv(rows, csv_path)
        return _instrument_sync_out(
            broker_code=acc.broker_code,
            sync_status="completed",
            row_count=len(rows),
            started_at=started_at,
            finished_at=datetime.utcnow(),
            storage_target="csv",
            csv_path=_csv_relpath(csv_path),
        )
    except Exception as exc:
        return _instrument_sync_out(
            broker_code=acc.broker_code,
            sync_status="failed",
            row_count=0,
            started_at=started_at,
            finished_at=datetime.utcnow(),
            error=str(exc)[:2000],
            storage_target="csv",
            csv_path=_csv_relpath(csv_path),
        )


def delete_instruments_storage(db: Session, acc: BrokerAccount) -> InstrumentSyncOut:
    started_at = datetime.utcnow()
    csv_path = _csv_path_for_broker(acc.broker_code)
    deleted_db_rows = clear_instruments(db, acc.broker_code)
    deleted_csv = False
    if csv_path.exists():
        csv_path.unlink()
        deleted_csv = True
    return _instrument_sync_out(
        broker_code=acc.broker_code,
        sync_status="deleted",
        row_count=0,
        started_at=started_at,
        finished_at=datetime.utcnow(),
        storage_target="db+csv",
        csv_path=_csv_relpath(csv_path),
        deleted_db_rows=deleted_db_rows,
        deleted_csv=deleted_csv,
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
    if rows:
        return [_instrument_row_to_schema(row) for row in rows]
    return _csv_search_rows(
        acc.broker_code,
        query=query,
        exchange=exchange,
        segment=segment,
        limit=limit,
    )


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
