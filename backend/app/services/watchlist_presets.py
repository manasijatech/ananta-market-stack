from __future__ import annotations

import csv
import io
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from common.datetime_compat import UTC
import httpx
from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from db.models import SystemWatchlistPreset, SystemWatchlistPresetSymbol, UserWatchlist

logger = logging.getLogger(__name__)

INDEX_MAPPING_URL = "https://iislliveblob.niftyindices.com/assets/json/IndexMapping.json"
INDEX_CONSTITUENT_URL_TEMPLATE = "https://www.niftyindices.com/IndexConstituent/{code}.csv"
DEFAULT_SYNC_INTERVAL = timedelta(days=1)
DEFAULT_FETCH_TIMEOUT_SECONDS = 20.0
POPULAR_PRESET_CODES = {
    "nifty50",
    "niftynext50",
    "nifty100",
    "nifty200",
    "nifty500",
    "niftybank",
    "niftyfinservice",
    "niftyit",
    "niftyauto",
    "niftyfmcg",
    "niftypharma",
    "niftymetal",
    "niftyrealty",
    "niftypsubank",
    "niftymidcap50",
    "niftymidcap100",
    "niftysmallcap100",
    "niftysmallcap250",
    "niftymidsmallcap400",
}


@dataclass(frozen=True)
class PresetCatalogEntry:
    trading_index_name: str
    name: str
    slug: str
    candidate_codes: list[str]
    constituent_csv_url: str | None
    is_popular: bool


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _normalize_symbol(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9_\-]", "", (value or "").strip().upper())


def _slugify(value: str | None) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return normalized or "watchlist-preset"


def _candidate_code(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def _candidate_codes(trading_index_name: str, name: str) -> list[str]:
    candidates = [
        _candidate_code(trading_index_name),
        _candidate_code(name),
        _candidate_code(name.replace(" and ", " ").replace("&", " ")),
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def _constituent_url_for_code(code: str) -> str:
    return INDEX_CONSTITUENT_URL_TEMPLATE.format(code=f"ind_{code}list")


def _search_text(trading_index_name: str, name: str, slug: str) -> str:
    return " ".join(part for part in [trading_index_name.lower(), name.lower(), slug.replace("-", " ")] if part)


def _http_client() -> httpx.Client:
    return httpx.Client(
        timeout=DEFAULT_FETCH_TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={
            "user-agent": "Mozilla/5.0 (compatible; Market-Stack Watchlist Sync/1.0)",
            "accept": "application/json,text/csv,text/plain,*/*",
        },
    )


def _fetch_json(url: str) -> Any:
    with _http_client() as client:
        response = client.get(url)
        response.raise_for_status()
        return response.json()


def _fetch_text(url: str) -> str:
    with _http_client() as client:
        response = client.get(url)
        response.raise_for_status()
        return response.text


def _mapping_entries(payload: Any) -> list[PresetCatalogEntry]:
    if not isinstance(payload, list):
        raise HTTPException(status_code=502, detail="Unexpected Nifty index mapping payload")
    entries: list[PresetCatalogEntry] = []
    seen_slugs: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        trading_index_name = _normalize_text(str(item.get("Trading_Index_Name") or ""))
        name = _normalize_text(str(item.get("Index_long_name") or trading_index_name))
        if not trading_index_name or not name:
            continue
        codes = _candidate_codes(trading_index_name, name)
        slug = _slugify(name)
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        constituent_csv_url = _constituent_url_for_code(codes[0]) if codes else None
        entries.append(
            PresetCatalogEntry(
                trading_index_name=trading_index_name,
                name=name,
                slug=slug,
                candidate_codes=codes,
                constituent_csv_url=constituent_csv_url,
                is_popular=any(code in POPULAR_PRESET_CODES for code in codes),
            )
        )
    return entries


def sync_preset_catalog(db: Session, *, force: bool = False) -> int:
    latest = db.scalar(
        select(func.max(SystemWatchlistPreset.last_catalog_sync_at))
    )
    if latest and not force and latest >= _utc_now() - DEFAULT_SYNC_INTERVAL:
        return 0

    payload = _fetch_json(INDEX_MAPPING_URL)
    entries = _mapping_entries(payload)
    now = _utc_now()
    existing = {
        row.slug: row
        for row in db.scalars(select(SystemWatchlistPreset)).all()
    }
    updated = 0
    for entry in entries:
        row = existing.get(entry.slug)
        if row is None:
            row = SystemWatchlistPreset(
                id=str(uuid.uuid4()),
                slug=entry.slug,
                name=entry.name,
                trading_index_name=entry.trading_index_name,
                constituent_csv_url=entry.constituent_csv_url,
                search_text=_search_text(entry.trading_index_name, entry.name, entry.slug),
                is_popular=entry.is_popular,
                auto_sync_enabled=entry.is_popular,
                sync_status="pending",
                last_catalog_sync_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            updated += 1
            continue
        row.name = entry.name
        row.trading_index_name = entry.trading_index_name
        row.constituent_csv_url = entry.constituent_csv_url
        row.search_text = _search_text(entry.trading_index_name, entry.name, entry.slug)
        row.is_popular = entry.is_popular
        row.auto_sync_enabled = bool(row.auto_sync_enabled or entry.is_popular)
        row.last_catalog_sync_at = now
        row.updated_at = now
        db.add(row)
        updated += 1
    db.commit()
    return updated


def ensure_preset_catalog(db: Session) -> None:
    has_rows = db.scalar(select(SystemWatchlistPreset.id).limit(1))
    if has_rows:
        latest = db.scalar(select(func.max(SystemWatchlistPreset.last_catalog_sync_at)))
        if latest and latest >= _utc_now() - DEFAULT_SYNC_INTERVAL:
            return
    sync_preset_catalog(db, force=not bool(has_rows))


def _symbol_column_name(fieldnames: list[str]) -> str | None:
    for name in fieldnames:
        normalized = re.sub(r"[^a-z]", "", name.lower())
        if "symbol" in normalized:
            return name
    return None


def _extract_preset_rows(csv_text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff")))
    fieldnames = list(reader.fieldnames or [])
    if not fieldnames:
        raise HTTPException(status_code=502, detail="Preset constituent CSV is missing headers")
    symbol_field = _symbol_column_name(fieldnames)
    if symbol_field is None:
        raise HTTPException(status_code=502, detail="Preset constituent CSV is missing a symbol column")

    company_field = next((name for name in fieldnames if "company" in name.lower()), None)
    industry_field = next((name for name in fieldnames if "industry" in name.lower()), None)
    isin_field = next((name for name in fieldnames if "isin" in name.lower()), None)
    series_field = next((name for name in fieldnames if name.lower() == "series"), None)
    weight_field = next((name for name in fieldnames if "weight" in name.lower()), None)

    rows: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw in reader:
        symbol = _normalize_symbol(raw.get(symbol_field))
        if not symbol:
            continue
        exchange = "NSE"
        key = (symbol, exchange)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "symbol": symbol,
                "exchange": exchange,
                "company_name": _normalize_text(raw.get(company_field) if company_field else ""),
                "industry": _normalize_text(raw.get(industry_field) if industry_field else ""),
                "isin": _normalize_text(raw.get(isin_field) if isin_field else ""),
                "series": _normalize_text(raw.get(series_field) if series_field else ""),
                "weight": _normalize_text(raw.get(weight_field) if weight_field else ""),
                "raw_row_json": json.dumps(raw, default=str),
            }
        )
    return rows


def refresh_preset_constituents(db: Session, preset: SystemWatchlistPreset) -> int:
    codes = _candidate_codes(preset.trading_index_name, preset.name)
    errors: list[str] = []
    rows: list[dict[str, str]] = []
    selected_url: str | None = None
    for code in codes:
        candidate_url = _constituent_url_for_code(code)
        try:
            rows = _extract_preset_rows(_fetch_text(candidate_url))
            selected_url = candidate_url
            break
        except Exception as exc:
            errors.append(f"{candidate_url}: {exc}")
            continue

    now = _utc_now()
    if not rows:
        preset.sync_status = "unavailable"
        preset.sync_error = "; ".join(errors)[:4000] if errors else "No constituent CSV available"
        preset.last_constituents_sync_at = now
        preset.updated_at = now
        db.add(preset)
        db.commit()
        raise HTTPException(status_code=404, detail=f"Could not fetch constituents for {preset.name}")

    db.query(SystemWatchlistPresetSymbol).filter(
        SystemWatchlistPresetSymbol.preset_id == preset.id
    ).delete(synchronize_session=False)
    for sort_order, row in enumerate(rows):
        db.add(
            SystemWatchlistPresetSymbol(
                id=str(uuid.uuid4()),
                preset_id=preset.id,
                symbol=row["symbol"],
                exchange=row["exchange"],
                company_name=row["company_name"] or None,
                industry=row["industry"] or None,
                isin=row["isin"] or None,
                series=row["series"] or None,
                weight=row["weight"] or None,
                sort_order=sort_order,
                raw_row_json=row["raw_row_json"],
                created_at=now,
            )
        )
    preset.constituent_csv_url = selected_url
    preset.constituent_count = len(rows)
    preset.sync_status = "ready"
    preset.sync_error = None
    preset.last_constituents_sync_at = now
    preset.updated_at = now
    db.add(preset)
    db.commit()
    return len(rows)


def refresh_due_presets(db: Session) -> int:
    ensure_preset_catalog(db)
    now = _utc_now()
    rows = db.scalars(
        select(SystemWatchlistPreset).where(
            or_(
                SystemWatchlistPreset.is_popular.is_(True),
                SystemWatchlistPreset.auto_sync_enabled.is_(True),
            )
        )
    ).all()
    refreshed = 0
    for row in rows:
        if row.last_constituents_sync_at and row.last_constituents_sync_at >= now - DEFAULT_SYNC_INTERVAL:
            continue
        try:
            refresh_preset_constituents(db, row)
            refreshed += 1
        except HTTPException:
            refreshed += 0
        except Exception:
            logger.exception("Preset sync failed for %s", row.slug)
    return refreshed


def list_preset_catalog(
    db: Session,
    user_id: str,
    *,
    query: str = "",
    limit: int = 30,
) -> list[dict[str, Any]]:
    ensure_preset_catalog(db)
    normalized_query = _normalize_text(query).lower()
    stmt = select(SystemWatchlistPreset)
    if normalized_query:
        stmt = stmt.where(SystemWatchlistPreset.search_text.contains(normalized_query))
    rows = db.scalars(
        stmt.order_by(
            SystemWatchlistPreset.is_popular.desc(),
            SystemWatchlistPreset.name.asc(),
        ).limit(max(1, min(limit, 100)))
    ).all()
    added_by_preset_id = {
        row.system_preset_id: row.id
        for row in db.scalars(
            select(UserWatchlist).where(
                UserWatchlist.user_id == user_id,
                UserWatchlist.kind == "preset",
                UserWatchlist.system_preset_id.is_not(None),
            )
        ).all()
        if row.system_preset_id
    }
    return [
        {
            "id": row.id,
            "slug": row.slug,
            "name": row.name,
            "trading_index_name": row.trading_index_name,
            "constituent_csv_url": row.constituent_csv_url,
            "constituent_count": row.constituent_count,
            "is_popular": bool(row.is_popular),
            "auto_sync_enabled": bool(row.auto_sync_enabled),
            "sync_status": row.sync_status,
            "sync_error": row.sync_error,
            "last_catalog_sync_at": row.last_catalog_sync_at,
            "last_constituents_sync_at": row.last_constituents_sync_at,
            "is_added": row.id in added_by_preset_id,
            "user_watchlist_id": added_by_preset_id.get(row.id),
        }
        for row in rows
    ]


def add_preset_to_user_watchlists(db: Session, user_id: str, preset_id: str) -> UserWatchlist:
    ensure_preset_catalog(db)
    preset = db.get(SystemWatchlistPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset index not found")
    existing = db.scalar(
        select(UserWatchlist).where(
            UserWatchlist.user_id == user_id,
            UserWatchlist.kind == "preset",
            UserWatchlist.system_preset_id == preset.id,
        )
    )
    if existing is not None:
        return existing
    if not preset.last_constituents_sync_at or preset.sync_status != "ready":
        refresh_preset_constituents(db, preset)
    now = _utc_now()
    watchlist = UserWatchlist(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=preset.name,
        kind="preset",
        system_preset_id=preset.id,
        created_at=now,
        updated_at=now,
    )
    preset.auto_sync_enabled = True
    preset.updated_at = now
    db.add(preset)
    db.add(watchlist)
    db.commit()
    db.refresh(watchlist)
    return watchlist


def refresh_user_preset_watchlist(db: Session, user_id: str, watchlist_id: str) -> UserWatchlist:
    watchlist = db.scalar(
        select(UserWatchlist).where(
            UserWatchlist.id == watchlist_id,
            UserWatchlist.user_id == user_id,
            UserWatchlist.kind == "preset",
            UserWatchlist.system_preset_id.is_not(None),
        )
    )
    if watchlist is None or watchlist.system_preset is None:
        raise HTTPException(status_code=404, detail="Preset watchlist not found")
    refresh_preset_constituents(db, watchlist.system_preset)
    watchlist.updated_at = _utc_now()
    db.add(watchlist)
    db.commit()
    db.refresh(watchlist)
    return watchlist
