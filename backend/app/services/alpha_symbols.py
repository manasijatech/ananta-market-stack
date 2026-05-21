from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from market_stack_sdk import MarketStackClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.alpha import AlphaSymbolMetadata
from app.services import alpha_config
from db.models import AlphaSymbolMetadataCache

_ALPHA_SYMBOL_BATCH_SIZE = 20


def _now_utc_naive() -> datetime:
    return datetime.utcnow()


def _normalize_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for symbol in symbols:
        item = str(symbol or "").strip().upper()
        if not item or item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    return normalized


def _row_to_schema(row: AlphaSymbolMetadataCache) -> AlphaSymbolMetadata:
    market_cap: int | float | str | None = row.market_cap
    if row.market_cap is not None:
        try:
            parsed = float(row.market_cap)
            market_cap = int(parsed) if parsed.is_integer() else parsed
        except ValueError:
            market_cap = row.market_cap
    return AlphaSymbolMetadata(
        symbol=row.symbol,
        company_name=row.company_name,
        logo=row.logo,
        market_cap=market_cap,
        sector=row.sector,
        basic_industry=row.basic_industry,
        industry=row.industry,
        macro_economic_indicator=row.macro_economic_indicator,
        theme=row.theme,
        scrip_code=row.scrip_code,
    )


def _payload_to_schema(payload: dict[str, Any], symbol: str) -> AlphaSymbolMetadata:
    return AlphaSymbolMetadata(
        symbol=str(payload.get("symbol") or symbol).strip().upper(),
        company_name=_optional_str(payload.get("company_name")),
        logo=_optional_str(payload.get("logo")),
        market_cap=payload.get("market_cap"),
        sector=_optional_str(payload.get("sector")),
        basic_industry=_optional_str(payload.get("basic_industry")),
        industry=_optional_str(payload.get("industry")),
        macro_economic_indicator=_optional_str(payload.get("macro_economic_indicator")),
        theme=_optional_str(payload.get("theme")),
        scrip_code=_optional_str(payload.get("scrip_code")),
    )


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _upsert_metadata(db: Session, item: AlphaSymbolMetadata, raw_payload: dict[str, Any]) -> None:
    now = _now_utc_naive()
    row = db.get(AlphaSymbolMetadataCache, item.symbol)
    if row is None:
        row = AlphaSymbolMetadataCache(symbol=item.symbol, created_at=now)
    row.company_name = item.company_name
    row.logo = item.logo
    row.market_cap = str(item.market_cap) if item.market_cap is not None else None
    row.sector = item.sector
    row.basic_industry = item.basic_industry
    row.industry = item.industry
    row.macro_economic_indicator = item.macro_economic_indicator
    row.theme = item.theme
    row.scrip_code = item.scrip_code
    row.raw_payload_json = json.dumps(raw_payload, default=str)
    row.fetched_at = now
    row.updated_at = now
    db.add(row)


def _cached_rows(
    db: Session,
    symbols: list[str],
) -> dict[str, AlphaSymbolMetadataCache]:
    if not symbols:
        return {}
    stmt = select(AlphaSymbolMetadataCache).where(AlphaSymbolMetadataCache.symbol.in_(symbols))
    return {row.symbol: row for row in db.scalars(stmt).all()}


def _fetch_alpha_symbol_metadata(api_key: str, symbols: list[str]) -> list[AlphaSymbolMetadata]:
    if not symbols:
        return []
    settings = get_settings()
    query = ",".join(symbols)
    with MarketStackClient(api_key=api_key, base_url=settings.alpha_api_base_url.rstrip("/"), timeout=15) as client:
        payload = client.get_symbols_metadata({"symbols": query})
    data = payload.get("data") if isinstance(payload, dict) else []
    if not isinstance(data, list):
        return []
    rows: list[AlphaSymbolMetadata] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").strip().upper()
        if symbol:
            rows.append(_payload_to_schema(item, symbol))
    return rows


def get_symbol_metadata(
    db: Session,
    user_id: str,
    symbols: list[str],
    *,
    force_refresh: bool = False,
) -> list[AlphaSymbolMetadata]:
    requested = _normalize_symbols(symbols)
    if not requested:
        return []

    cached = {} if force_refresh else _cached_rows(db, requested)
    missing = [symbol for symbol in requested if symbol not in cached]
    if missing:
        api_key = alpha_config.get_alpha_api_key(db, user_id)
        for index in range(0, len(missing), _ALPHA_SYMBOL_BATCH_SIZE):
            batch = missing[index:index + _ALPHA_SYMBOL_BATCH_SIZE]
            fetched = _fetch_alpha_symbol_metadata(api_key, batch)
            for item in fetched:
                if item.symbol in batch:
                    _upsert_metadata(db, item, item.model_dump())
        db.commit()
        cached = _cached_rows(db, requested)

    by_symbol = {symbol: _row_to_schema(row) for symbol, row in cached.items()}
    return [by_symbol[symbol] for symbol in requested if symbol in by_symbol]
