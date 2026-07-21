from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any

from common.datetime_compat import UTC
from sqlalchemy import delete, desc, or_, select
from sqlalchemy.orm import Session

from db.models import BrokerInstrument, BrokerInstrumentSyncRun


def _as_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def parse_expiry(value: Any) -> datetime | None:
    if value in (None, "", 0):
        return None
    if isinstance(value, datetime):
        return _as_utc_naive(value)
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=UTC).replace(tzinfo=None)
        except Exception:
            return None
    raw = str(value).strip()
    if not raw:
        return None
    candidates = [raw.replace("Z", "+00:00"), raw]
    for candidate in candidates:
        try:
            return _as_utc_naive(datetime.fromisoformat(candidate))
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d%b%Y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _build_searchable_text(payload: dict[str, Any]) -> str:
    parts = [
        payload.get("symbol"),
        payload.get("trading_symbol"),
        payload.get("name"),
        payload.get("exchange"),
        payload.get("segment"),
        payload.get("isin"),
        payload.get("instrument_type"),
        payload.get("option_type"),
    ]
    return " ".join(part.lower() for part in parts if part)


def create_sync_run(db: Session, broker_code: str) -> BrokerInstrumentSyncRun:
    row = BrokerInstrumentSyncRun(
        id=str(uuid.uuid4()),
        broker_code=broker_code,
        status="running",
        started_at=datetime.utcnow(),
        row_count=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def finish_sync_run(
    db: Session,
    run: BrokerInstrumentSyncRun,
    *,
    status: str,
    row_count: int,
    error: str | None = None,
) -> BrokerInstrumentSyncRun:
    run.status = status
    run.row_count = row_count
    run.error = error
    run.finished_at = datetime.utcnow()
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def latest_sync_run(db: Session, broker_code: str) -> BrokerInstrumentSyncRun | None:
    stmt = (
        select(BrokerInstrumentSyncRun)
        .where(BrokerInstrumentSyncRun.broker_code == broker_code)
        .order_by(desc(BrokerInstrumentSyncRun.started_at))
        .limit(1)
    )
    return db.scalars(stmt).first()


_STALE_SYNC_RUNNING = timedelta(minutes=45)
_STALE_SYNC_ORPHAN = timedelta(minutes=3)


def reconcile_stale_sync_run(
    db: Session,
    broker_code: str,
    *,
    inflight: bool,
) -> BrokerInstrumentSyncRun | None:
    """Mark abandoned or timed-out sync runs so new work can be scheduled."""
    last_run = latest_sync_run(db, broker_code)
    if last_run is None or last_run.status != "running" or last_run.started_at is None:
        return last_run
    age = datetime.utcnow() - last_run.started_at
    if inflight and age < _STALE_SYNC_RUNNING:
        return last_run
    if not inflight and age < _STALE_SYNC_ORPHAN:
        return last_run
    reason = (
        "Instrument sync timed out before completion."
        if age >= _STALE_SYNC_RUNNING
        else "Instrument sync stopped unexpectedly; retrying."
    )
    return finish_sync_run(db, last_run, status="failed", row_count=0, error=reason)


def count_instruments(db: Session, broker_code: str) -> int:
    stmt = select(BrokerInstrument).where(BrokerInstrument.broker_code == broker_code)
    return len(list(db.scalars(stmt).all()))


def clear_instruments(db: Session, broker_code: str) -> int:
    rows = list(
        db.scalars(select(BrokerInstrument.id).where(BrokerInstrument.broker_code == broker_code)).all()
    )
    db.execute(delete(BrokerInstrument).where(BrokerInstrument.broker_code == broker_code))
    db.commit()
    return len(rows)


def replace_instruments(db: Session, broker_code: str, rows: list[dict[str, Any]]) -> int:
    db.execute(delete(BrokerInstrument).where(BrokerInstrument.broker_code == broker_code))
    now = datetime.utcnow()
    for payload in rows:
        row = BrokerInstrument(
            id=str(uuid.uuid4()),
            broker_code=broker_code,
            exchange=_clean(payload.get("exchange")),
            segment=_clean(payload.get("segment")),
            symbol=_clean(payload.get("symbol")) or "unknown",
            trading_symbol=_clean(payload.get("trading_symbol")),
            name=_clean(payload.get("name")),
            isin=_clean(payload.get("isin")),
            instrument_type=_clean(payload.get("instrument_type")),
            expiry=parse_expiry(payload.get("expiry")),
            strike=_clean(payload.get("strike")),
            option_type=_clean(payload.get("option_type")),
            lot_size=_clean(payload.get("lot_size")),
            tick_size=_clean(payload.get("tick_size")),
            price_precision=_clean(payload.get("price_precision")),
            zerodha_instrument_token=_clean(payload.get("zerodha_instrument_token")),
            arrow_token=_clean(payload.get("arrow_token")),
            upstox_instrument_key=_clean(payload.get("upstox_instrument_key")),
            angel_token=_clean(payload.get("angel_token")),
            dhan_security_id=_clean(payload.get("dhan_security_id")),
            dhan_exchange_segment=_clean(payload.get("dhan_exchange_segment")),
            groww_exchange=_clean(payload.get("groww_exchange")),
            groww_segment=_clean(payload.get("groww_segment")),
            groww_trading_symbol=_clean(payload.get("groww_trading_symbol")),
            indmoney_scrip_code=_clean(payload.get("indmoney_scrip_code")),
            kotak_query=_clean(payload.get("kotak_query")),
            kotak_segment=_clean(payload.get("kotak_segment")),
            kotak_psymbol=_clean(payload.get("kotak_psymbol")),
            searchable_text=_build_searchable_text(payload),
            native_payload_json=json.dumps(payload.get("native_payload") or {}, default=str),
            raw_payload_json=json.dumps(payload.get("raw_payload") or payload, default=str),
            fetched_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    db.commit()
    return len(rows)


def search_instruments(
    db: Session,
    broker_code: str,
    *,
    query: str = "",
    exchange: str | None = None,
    segment: str | None = None,
    limit: int = 50,
) -> list[BrokerInstrument]:
    stmt = select(BrokerInstrument).where(BrokerInstrument.broker_code == broker_code)
    if exchange:
        stmt = stmt.where(BrokerInstrument.exchange == exchange)
    if segment:
        stmt = stmt.where(BrokerInstrument.segment == segment)
    normalized = query.strip().lower()
    if normalized:
        like = f"%{normalized}%"
        stmt = stmt.where(
            or_(
                BrokerInstrument.searchable_text.like(like),
                BrokerInstrument.symbol.like(f"%{query.strip()}%"),
                BrokerInstrument.trading_symbol.like(f"%{query.strip()}%"),
            )
        )
    stmt = stmt.order_by(BrokerInstrument.symbol.asc()).limit(max(1, min(limit, 200)))
    return list(db.scalars(stmt).all())


class SQLiteInstrumentResolver:
    def __init__(self, db: Session, broker_code: str) -> None:
        self.db = db
        self.broker_code = broker_code

    def _lookup(self, symbol: str, exchange: str) -> BrokerInstrument | None:
        normalized_symbol = symbol.strip()
        normalized_exchange = exchange.strip() if exchange else ""
        stmt = select(BrokerInstrument).where(BrokerInstrument.broker_code == self.broker_code)
        if normalized_exchange:
            stmt = stmt.where(
                or_(
                    BrokerInstrument.exchange == normalized_exchange,
                    BrokerInstrument.groww_exchange == normalized_exchange,
                    BrokerInstrument.dhan_exchange_segment == normalized_exchange,
                )
            )
        if normalized_symbol:
            stmt = stmt.where(
                or_(
                    BrokerInstrument.symbol == normalized_symbol,
                    BrokerInstrument.trading_symbol == normalized_symbol,
                    BrokerInstrument.groww_trading_symbol == normalized_symbol,
                    BrokerInstrument.kotak_query == normalized_symbol,
                )
            )
        stmt = stmt.order_by(desc(BrokerInstrument.fetched_at)).limit(1)
        return self.db.scalars(stmt).first()

    def broker_symbol(self, symbol: str, exchange: str) -> str:
        row = self._lookup(symbol, exchange)
        return row.trading_symbol or row.groww_trading_symbol or row.symbol if row else symbol

    def oa_symbol(self, broker_symbol: str, exchange: str) -> str:
        row = self._lookup(broker_symbol, exchange)
        return row.symbol if row else broker_symbol

    def instrument_token(self, symbol: str, exchange: str) -> int | None:
        row = self._lookup(symbol, exchange)
        if not row or not row.zerodha_instrument_token:
            return None
        try:
            return int(row.zerodha_instrument_token)
        except ValueError:
            return None

    def arrow_token(self, symbol: str, exchange: str) -> str | None:
        row = self._lookup(symbol, exchange)
        return row.arrow_token if row else None

    def angel_token(self, symbol: str, exchange: str) -> str | None:
        row = self._lookup(symbol, exchange)
        return row.angel_token if row else None

    def dhan_security(self, symbol: str, exchange: str) -> tuple[str | None, str | None]:
        row = self._lookup(symbol, exchange)
        if not row:
            return None, None
        return row.dhan_exchange_segment, row.dhan_security_id

    def upstox_instrument_key(self, symbol: str, exchange: str) -> str | None:
        row = self._lookup(symbol, exchange)
        return row.upstox_instrument_key if row else None

    def kotak_psymbol(self, symbol: str, exchange: str) -> tuple[str | None, str | None]:
        row = self._lookup(symbol, exchange)
        if not row:
            return None, None
        return row.kotak_segment, row.kotak_psymbol
