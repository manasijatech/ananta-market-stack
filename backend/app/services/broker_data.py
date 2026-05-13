from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from datetime import UTC, datetime, timedelta
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
_CSV_CACHE_TTL = timedelta(minutes=1)
_CSV_SEARCH_CACHE: dict[str, dict[str, Any]] = {}

try:
    csv.field_size_limit(sys.maxsize)
except OverflowError:
    csv.field_size_limit(2**31 - 1)


def _resolver(db: Session, broker_code: str) -> SQLiteInstrumentResolver:
    return SQLiteInstrumentResolver(db, broker_code)


def _client(db: Session, acc: BrokerAccount):
    return get_client_for_account(acc, resolver=_resolver(db, acc.broker_code))


def _instrument_row_to_schema(
    row: BrokerInstrument,
    *,
    account_id: str | None = None,
    account_label: str | None = None,
) -> InstrumentSearchRow:
    return InstrumentSearchRow(
        symbol=row.symbol,
        source="db",
        broker_code=row.broker_code,
        account_id=account_id,
        account_label=account_label,
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
    normalized_symbol = symbol.strip().upper()
    normalized_exchange = exchange.strip().upper()
    _csv_rows_cached(broker_code)
    cached = _CSV_SEARCH_CACHE.get(broker_code)
    exact_index = cached.get("exact_index", {}) if cached else {}
    row = exact_index.get((normalized_exchange, normalized_symbol))
    if row is None and not normalized_exchange:
        row = exact_index.get(("", normalized_symbol))
    return _csv_exact_payload(row) if row else None


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


def count_holdings_rows(payload: Any) -> int:
    if isinstance(payload, list):
        return len([item for item in payload if isinstance(item, dict)])
    if not isinstance(payload, dict):
        return 0
    for key in ("data", "payload", "holdings", "positions", "orders", "trades", "net"):
        value = payload.get(key)
        if isinstance(value, list):
            return len([item for item in value if isinstance(item, dict)])
        if isinstance(value, dict):
            for nested_key in ("positions", "holdings", "orders", "trades", "net"):
                nested = value.get(nested_key)
                if isinstance(nested, list):
                    return len([item for item in nested if isinstance(item, dict)])
    return 0


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
    account_id: str | None = None,
    account_label: str | None = None,
    query: str = "",
    exchange: str | None = None,
    segment: str | None = None,
    limit: int = 50,
) -> list[InstrumentSearchRow]:
    rows = _csv_rows_cached(broker_code)
    if not rows:
        return []
    normalized_query = query.strip().lower()
    normalized_exchange = (exchange or "").strip().lower()
    normalized_segment = (segment or "").strip().lower()
    matches: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        row_exchange = str(row.get("exchange") or "")
        row_segment = str(row.get("segment") or "")
        if normalized_exchange and row_exchange.lower() != normalized_exchange:
            continue
        if normalized_segment and row_segment.lower() != normalized_segment:
            continue
        haystack = str(row.get("_search_blob") or "")
        if normalized_query and normalized_query not in haystack:
            continue
        matches.append((_csv_match_rank(row, normalized_query), row))
    matches.sort(key=lambda item: (item[0], str(item[1].get("symbol") or ""), str(item[1].get("trading_symbol") or "")))
    results: list[InstrumentSearchRow] = []
    for _, row in matches[: max(1, min(limit, 200))]:
        results.append(
            _csv_row_to_schema(
                row,
                broker_code=broker_code,
                account_id=account_id,
                account_label=account_label,
            )
        )
    return results


def _csv_exact_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": row.get("symbol"),
        "exchange": row.get("exchange"),
        "segment": row.get("segment"),
        "trading_symbol": row.get("trading_symbol"),
        "instrument_type": row.get("instrument_type"),
        "zerodha_instrument_token": row.get("zerodha_instrument_token"),
        "upstox_instrument_key": row.get("upstox_instrument_key"),
        "angel_token": row.get("angel_token"),
        "angel_exchange": row.get("exchange"),
        "dhan_security_id": row.get("dhan_security_id"),
        "dhan_exchange_segment": row.get("dhan_exchange_segment"),
        "groww_exchange": row.get("groww_exchange") or row.get("exchange"),
        "groww_segment": row.get("groww_segment") or row.get("segment"),
        "groww_trading_symbol": row.get("groww_trading_symbol") or row.get("trading_symbol"),
        "indmoney_scrip_code": row.get("indmoney_scrip_code"),
        "kotak_query": row.get("kotak_query"),
        "kotak_segment": row.get("kotak_segment"),
        "kotak_psymbol": row.get("kotak_psymbol"),
    }


def _csv_row_to_schema(
    row: dict[str, Any],
    *,
    broker_code: str,
    account_id: str | None = None,
    account_label: str | None = None,
) -> InstrumentSearchRow:
    return InstrumentSearchRow(
        symbol=str(row.get("symbol") or "unknown"),
        source="csv",
        broker_code=broker_code,
        account_id=account_id,
        account_label=account_label,
        exchange=row.get("exchange"),
        segment=row.get("segment"),
        trading_symbol=row.get("trading_symbol"),
        name=row.get("name"),
        isin=row.get("isin"),
        instrument_type=row.get("instrument_type"),
        expiry=parse_expiry(row.get("expiry")),
        strike=row.get("strike"),
        option_type=row.get("option_type"),
        lot_size=row.get("lot_size"),
        tick_size=row.get("tick_size"),
        identifiers={
            "zerodha_instrument_token": row.get("zerodha_instrument_token"),
            "upstox_instrument_key": row.get("upstox_instrument_key"),
            "angel_token": row.get("angel_token"),
            "dhan_security_id": row.get("dhan_security_id"),
            "dhan_exchange_segment": row.get("dhan_exchange_segment"),
            "groww_trading_symbol": row.get("groww_trading_symbol"),
            "indmoney_scrip_code": row.get("indmoney_scrip_code"),
            "kotak_query": row.get("kotak_query"),
            "kotak_segment": row.get("kotak_segment"),
            "kotak_psymbol": row.get("kotak_psymbol"),
        },
    )


def _csv_cache_cleanup(now: datetime) -> None:
    expired = [
        broker_code
        for broker_code, cached in _CSV_SEARCH_CACHE.items()
        if now - cached["last_accessed_at"] > _CSV_CACHE_TTL
    ]
    for broker_code in expired:
        _CSV_SEARCH_CACHE.pop(broker_code, None)


def _csv_rows_cached(broker_code: str) -> list[dict[str, Any]]:
    now = datetime.now(tz=UTC).replace(tzinfo=None)
    _csv_cache_cleanup(now)
    csv_path = _csv_path_for_broker(broker_code)
    if not csv_path.exists():
        _CSV_SEARCH_CACHE.pop(broker_code, None)
        return []
    stat = csv_path.stat()
    cached = _CSV_SEARCH_CACHE.get(broker_code)
    if cached and cached["mtime_ns"] == stat.st_mtime_ns:
        cached["last_accessed_at"] = now
        return cached["rows"]
    rows: list[dict[str, Any]] = []
    exact_index: dict[tuple[str, str], dict[str, Any]] = {}
    with csv_path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for raw_row in reader:
            row = {key: _csv_value(raw_row, key) for key in raw_row.keys()}
            row["_search_blob"] = " ".join(
                filter(
                    None,
                    [
                        row.get("symbol"),
                        row.get("trading_symbol"),
                        row.get("name"),
                        row.get("exchange"),
                        row.get("segment"),
                        row.get("isin"),
                        row.get("instrument_type"),
                        row.get("option_type"),
                    ],
                )
            ).lower()
            rows.append(row)
            row_exchange = str(row.get("exchange") or "").upper()
            for candidate in {str(row.get("symbol") or "").upper(), str(row.get("trading_symbol") or "").upper()}:
                if not candidate:
                    continue
                exact_index.setdefault((row_exchange, candidate), row)
                exact_index.setdefault(("", candidate), row)
    _CSV_SEARCH_CACHE[broker_code] = {
        "mtime_ns": stat.st_mtime_ns,
        "rows": rows,
        "exact_index": exact_index,
        "last_accessed_at": now,
    }
    return rows


def _csv_match_rank(row: dict[str, Any], normalized_query: str) -> int:
    symbol = str(row.get("symbol") or "").lower()
    trading_symbol = str(row.get("trading_symbol") or "").lower()
    name = str(row.get("name") or "").lower()
    segment = str(row.get("segment") or "").upper()
    score = 100
    if normalized_query:
        if symbol == normalized_query or trading_symbol == normalized_query:
            score -= 60
        elif symbol.startswith(normalized_query) or trading_symbol.startswith(normalized_query):
            score -= 40
        elif name.startswith(normalized_query):
            score -= 20
        elif normalized_query in symbol or normalized_query in trading_symbol:
            score -= 10
    if segment == "EQ":
        score -= 30
    elif segment == "NSE_EQ":
        score -= 25
    instrument_type = str(row.get("instrument_type") or "").upper()
    if instrument_type == "EQ":
        score -= 15
    return score


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


def cached_instrument_count(db: Session, broker_code: str) -> int:
    return count_instruments(db, broker_code)


def instrument_cache_available(db: Session, broker_code: str) -> bool:
    return cached_instrument_count(db, broker_code) > 0 or _csv_path_for_broker(broker_code).exists()


def _preserve_existing_instrument_cache(
    db: Session,
    acc: BrokerAccount,
    *,
    storage_target: str,
    started_at: datetime | None = None,
) -> InstrumentSyncOut:
    row_count = cached_instrument_count(db, acc.broker_code)
    csv_path = _csv_path_for_broker(acc.broker_code)
    csv_available = csv_path.exists()
    if row_count <= 0 and not csv_available:
        raise ValueError("instrument refresh returned no rows and no existing cache is available")
    message = "Instrument refresh returned no rows. Preserved the last successful instrument cache."
    return _instrument_sync_out(
        broker_code=acc.broker_code,
        sync_status="preserved",
        row_count=row_count,
        started_at=started_at,
        finished_at=datetime.utcnow(),
        error=message,
        storage_target=storage_target,
        csv_path=_csv_relpath(csv_path) if csv_available else None,
    )


def sync_instruments_for_account(db: Session, acc: BrokerAccount) -> InstrumentSyncOut:
    return sync_instruments_to_csv(db, acc)


def sync_instruments_to_db(db: Session, acc: BrokerAccount) -> InstrumentSyncOut:
    run = create_sync_run(db, acc.broker_code)
    try:
        rows = _fetch_instrument_rows(db, acc)
        if not rows:
            preserved = _preserve_existing_instrument_cache(db, acc, storage_target="db", started_at=run.started_at)
            run = finish_sync_run(
                db,
                run,
                status=preserved.sync_status,
                row_count=preserved.row_count,
                error=preserved.error,
            )
            return preserved
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
        if not rows:
            return _preserve_existing_instrument_cache(db, acc, storage_target="csv", started_at=started_at)
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
        return [
            _instrument_row_to_schema(
                row,
                account_id=acc.id,
                account_label=acc.label,
            )
            for row in rows
        ]
    return _csv_search_rows(
        acc.broker_code,
        account_id=acc.id,
        account_label=acc.label,
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


def fetch_holdings(db: Session, acc: BrokerAccount) -> dict[str, Any]:
    client = _client(db, acc)
    return client.holdings()


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
