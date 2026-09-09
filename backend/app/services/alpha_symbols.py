from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx
from drishti_sdk import DrishtiApiError, DrishtiClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.alpha import AlphaSymbolMetadata
from app.services import alpha_config
from db.models import AlphaSymbolMetadataCache

_ALPHA_SYMBOL_BATCH_SIZE = 20
_UNAVAILABLE_RETRY_INTERVAL = timedelta(hours=6)
_HOLLOW_RETRY_INTERVAL = timedelta(minutes=15)
# Drishti / NSE ticker renames that still appear on legacy watchlists.
_METADATA_SYMBOL_ALIASES = {
    "TATAMOTORS": "TMPV",
}
logger = logging.getLogger(__name__)


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


def _fallback_schema(symbol: str) -> AlphaSymbolMetadata:
    return AlphaSymbolMetadata(
        symbol=symbol,
        company_name=None,
        logo=None,
        market_cap=None,
        sector=None,
        basic_industry=None,
        industry=None,
        macro_economic_indicator=None,
        theme=None,
        scrip_code=None,
    )


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _raw_payload(row: AlphaSymbolMetadataCache) -> dict[str, Any]:
    try:
        payload = json.loads(row.raw_payload_json or "{}")
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _is_usable_metadata_row(row: AlphaSymbolMetadataCache) -> bool:
    """True when the cache row has at least one user-visible identity field."""
    return bool(_optional_str(row.company_name) or _optional_str(row.logo))


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


def _unavailable_retry_due(row: AlphaSymbolMetadataCache, now: datetime) -> bool:
    payload = _raw_payload(row)
    if payload.get("metadata_status") != "unavailable":
        return False
    return not row.fetched_at or row.fetched_at <= now - _UNAVAILABLE_RETRY_INTERVAL


def _needs_metadata_refresh(row: AlphaSymbolMetadataCache | None, now: datetime, *, force_refresh: bool) -> bool:
    if force_refresh or row is None:
        return True
    if _is_usable_metadata_row(row):
        return False
    payload = _raw_payload(row)
    if payload.get("metadata_status") == "unavailable":
        return _unavailable_retry_due(row, now)
    # Hollow / partial cache (empty name+logo without a durable negative marker).
    # Retry on a short interval so a recovered API key self-heals the UI.
    return not row.fetched_at or row.fetched_at <= now - _HOLLOW_RETRY_INTERVAL


def invalidate_unavailable_metadata_cache(db: Session) -> int:
    """Remove negative metadata entries after a Drishti credential is verified."""
    rows = db.scalars(select(AlphaSymbolMetadataCache)).all()
    unavailable_rows: list[AlphaSymbolMetadataCache] = []
    for row in rows:
        payload = _raw_payload(row)
        if payload.get("metadata_status") == "unavailable":
            unavailable_rows.append(row)
    for row in unavailable_rows:
        db.delete(row)
    return len(unavailable_rows)


def _fetch_alpha_symbol_metadata(api_key: str, symbols: list[str]) -> list[AlphaSymbolMetadata]:
    if not symbols:
        return []
    settings = get_settings()
    with DrishtiClient(api_key=api_key, base_url=settings.alpha_api_base_url.rstrip("/"), timeout=15) as client:
        payload = client.get_symbols_metadata(symbols=symbols)
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

    cached = _cached_rows(db, requested)
    now = _now_utc_naive()
    missing = [
        symbol
        for symbol in requested
        if _needs_metadata_refresh(cached.get(symbol), now, force_refresh=force_refresh)
    ]
    if missing:
        try:
            api_key = alpha_config.get_alpha_api_key(db, user_id)
        except Exception as exc:
            logger.warning(
                "Alpha symbol metadata backfill skipped for %s symbol(s); no usable API key: %s: %s",
                len(missing),
                type(exc).__name__,
                exc,
            )
            by_symbol = {symbol: _row_to_schema(row) for symbol, row in cached.items()}
            results = [by_symbol.get(symbol) or _fallback_schema(symbol) for symbol in requested]
            return _fill_from_symbol_aliases(db, user_id, results, force_refresh=False)
        for index in range(0, len(missing), _ALPHA_SYMBOL_BATCH_SIZE):
            batch = missing[index:index + _ALPHA_SYMBOL_BATCH_SIZE]
            fetch_failed = False
            try:
                fetched = _fetch_alpha_symbol_metadata(api_key, batch)
            except (DrishtiApiError, httpx.HTTPError) as exc:
                fetch_failed = True
                logger.warning("Alpha symbol metadata fetch failed for %s: %s", ",".join(batch), exc)
                fetched = []
                for symbol in batch:
                    _upsert_metadata(
                        db,
                        _fallback_schema(symbol),
                        {
                            "symbol": symbol,
                            "metadata_status": "unavailable",
                            "metadata_error": str(exc),
                        },
                    )
            fetched_symbols = {item.symbol for item in fetched}
            for item in fetched:
                if item.symbol in batch:
                    raw = item.model_dump()
                    if not (item.company_name or item.logo):
                        raw["metadata_status"] = "unavailable"
                        raw["metadata_error"] = "Alpha metadata response was empty for this symbol."
                    _upsert_metadata(db, item, raw)
            if not fetch_failed:
                for symbol in batch:
                    if symbol not in fetched_symbols:
                        _upsert_metadata(
                            db,
                            _fallback_schema(symbol),
                            {
                                "symbol": symbol,
                                "metadata_status": "unavailable",
                                "metadata_error": "Alpha metadata response did not include this symbol.",
                            },
                        )
        db.commit()
        cached = _cached_rows(db, requested)

    by_symbol = {symbol: _row_to_schema(row) for symbol, row in cached.items()}
    results = [by_symbol.get(symbol) or _fallback_schema(symbol) for symbol in requested]
    return _fill_from_symbol_aliases(db, user_id, results, force_refresh=force_refresh)


def _fill_from_symbol_aliases(
    db: Session,
    user_id: str,
    rows: list[AlphaSymbolMetadata],
    *,
    force_refresh: bool,
) -> list[AlphaSymbolMetadata]:
    """Copy metadata from renamed tickers onto legacy symbols still used in UI lists."""
    need_alias = [
        row.symbol
        for row in rows
        if not (row.company_name or row.logo) and row.symbol in _METADATA_SYMBOL_ALIASES
    ]
    if not need_alias:
        return rows

    alias_targets = [_METADATA_SYMBOL_ALIASES[symbol] for symbol in need_alias]
    alias_rows = get_symbol_metadata(
        db,
        user_id,
        alias_targets,
        force_refresh=force_refresh,
    )
    alias_by_symbol = {row.symbol: row for row in alias_rows}
    filled: list[AlphaSymbolMetadata] = []
    for row in rows:
        if row.company_name or row.logo or row.symbol not in _METADATA_SYMBOL_ALIASES:
            filled.append(row)
            continue
        alias = alias_by_symbol.get(_METADATA_SYMBOL_ALIASES[row.symbol])
        if alias is None or not (alias.company_name or alias.logo):
            filled.append(row)
            continue
        merged = alias.model_copy(update={"symbol": row.symbol})
        _upsert_metadata(db, merged, {**alias.model_dump(), "symbol": row.symbol, "metadata_alias_of": alias.symbol})
        filled.append(merged)
    if any(row.symbol in need_alias for row in filled):
        db.commit()
    return filled
