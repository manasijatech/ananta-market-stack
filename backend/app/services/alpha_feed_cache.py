from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from common.datetime_compat import UTC
from drishti_sdk import DrishtiApiError, DrishtiClient
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from broker.crypto import decrypt_value
from db.models import AlphaFeedItem, AlphaFeedSymbolSync, UserAlphaApiCredential

logger = logging.getLogger(__name__)

ALPHA_FEED_PRODUCTS = ("news", "announcements", "earnings", "concalls", "alerts")
# Drishti accepts ≤20 symbols per request; we batch the full watchlist, not a hard subset.
_FEED_BATCH_SIZE = 20
_FEED_SYNC_TTL = timedelta(minutes=30)
_FEED_PAGE_FETCH_LIMIT = 20
# Cap Drishti refresh work per HTTP request so large watchlists return cached DB rows immediately.
_FEED_MAX_REFRESH_BATCHES = 4
# One REST page per symbol batch — avoids replaying deep history (credit-heavy).
_FEED_MAX_DRISHTI_PAGES_PER_BATCH = 1
# Incremental REST backfill window when symbols were synced before.
_FEED_REFRESH_LOOKBACK_DAYS = {
    "news": 14,
    "announcements": 14,
    "alerts": 14,
    "earnings": 180,
    "concalls": 365,
}
# Market-wide websocket rows (N/A) only belong in very large watchlist scopes.
_FEED_INCLUDE_MARKET_WIDE_MIN_SYMBOLS = 50
_INVALID_FEED_SYMBOLS = frozenset({"N/A", "NA", "NONE", ""})
_EXCHANGE_TOKENS = frozenset({"NSE", "BSE", "NFO", "BFO", "MCX", "NCDEX", "CDS", "BSEFO", "NSECM", "BSECM"})


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def _json_loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _lookback_days(product: str) -> int:
    return int(_FEED_REFRESH_LOOKBACK_DAYS.get(product, 14))


def _cash_equity_symbol(value: str) -> str:
    """Drishti REST takes NSE/BSE tickers only — drop exchange/segment qualifiers."""
    item = str(value or "").strip().upper().replace(".NS", "").replace(".BO", "")
    if not item or item in _INVALID_FEED_SYMBOLS or item in _EXCHANGE_TOKENS:
        return ""
    parts = [part for part in item.replace("/", ":").split(":") if part]
    parts = [part for part in parts if part not in _EXCHANGE_TOKENS]
    return parts[0] if parts else ""


def _normalize_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for symbol in symbols:
        item = _cash_equity_symbol(str(symbol or ""))
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _item_key(product: str, payload: dict[str, Any]) -> str:
    for key in ("id", "_id", "event_id", "announcement_id", "news_id", "alert_id", "concall_id"):
        value = payload.get(key)
        if value not in (None, ""):
            return f"{product}:{value}"
    parts = [
        product,
        str(payload.get("symbol") or payload.get("nse") or ""),
        str(payload.get("date") or payload.get("timestamp") or payload.get("published_at") or ""),
        str(payload.get("headline") or payload.get("title") or payload.get("type") or "")[:120],
    ]
    return ":".join(part for part in parts if part)


def _published_at(payload: dict[str, Any], fallback: datetime | None = None) -> datetime | None:
    for key in ("published_at", "timestamp", "date", "datetime", "created_at", "announcement_date"):
        raw = payload.get(key)
        if raw in (None, ""):
            continue
        if isinstance(raw, datetime):
            return raw.replace(tzinfo=None) if raw.tzinfo else raw
        text = str(raw).strip()
        if not text:
            continue
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            parsed = datetime.fromisoformat(text)
            return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
        except ValueError:
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d"):
                try:
                    return datetime.strptime(text[:10], fmt)
                except ValueError:
                    continue
    return fallback


def _normalize_feed_symbol(value: str | None) -> str | None:
    return _cash_equity_symbol(value or "") or None


def _payload_symbol(payload: dict[str, Any], fallback: str | None = None) -> str | None:
    for key in ("symbol", "nse"):
        raw = payload.get(key)
        if isinstance(raw, str):
            symbol = _normalize_feed_symbol(raw)
            if symbol:
                return symbol
        if isinstance(raw, list) and raw:
            symbol = _normalize_feed_symbol(str(raw[0] or ""))
            if symbol:
                return symbol
    return _normalize_feed_symbol(fallback)


def _credential_api_key(db: Session, user_id: str) -> str:
    from app.services import rbac

    owner_user_id = rbac.workspace_config_owner_user_id(db, user_id)
    row = db.get(UserAlphaApiCredential, owner_user_id)
    if row is None or not row.is_enabled or not row.api_key_cipher:
        raise ValueError("Drishti API key is required")
    return decrypt_value(row.api_key_cipher)


def _drishti_client(api_key: str) -> DrishtiClient:
    settings = get_settings()
    return DrishtiClient(
        api_key=api_key,
        base_url=settings.alpha_api_base_url.rstrip("/"),
        timeout=20.0,
    )


def _fetch_product_page(
    client: DrishtiClient,
    product: str,
    *,
    symbols: list[str],
    from_date: str | None,
    to_date: str | None,
    page: int,
    limit: int,
) -> list[dict[str, Any]]:
    common = {
        "symbols": symbols,
        "from_": from_date,
        "to": to_date,
        "page": page,
        "limit": limit,
    }
    if product == "news":
        response = client.get_news(**common)
    elif product == "announcements":
        response = client.get_announcements(**common, detailed=True)
    elif product == "earnings":
        response = client.get_earnings(**common, detailed=True)
    elif product == "concalls":
        response = client.get_concalls(**common, detailed=True)
    elif product == "alerts":
        response = client.get_alerts(**common)
    else:
        raise ValueError(f"Unsupported product: {product}")
    if isinstance(response, dict):
        data = response.get("data")
    else:
        data = getattr(response, "data", None)
    if not isinstance(data, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in data:
        if hasattr(item, "model_dump"):
            rows.append(item.model_dump(mode="json"))
        elif isinstance(item, dict):
            rows.append(item)
    return rows


def upsert_feed_item_from_event(
    db: Session,
    *,
    user_id: str,
    product: str,
    payload: dict[str, Any],
    symbol: str | None,
    event_key: str,
    received_at: datetime | None = None,
    price_snapshot: dict[str, Any] | None = None,
    commit: bool = True,
) -> AlphaFeedItem:
    now = _utc_now()
    item_key = event_key or _item_key(product, payload)
    existing = db.scalar(
        select(AlphaFeedItem).where(
            AlphaFeedItem.user_id == user_id,
            AlphaFeedItem.product == product,
            AlphaFeedItem.item_key == item_key,
        )
    )
    row = existing or AlphaFeedItem(
        id=str(uuid.uuid4()),
        user_id=user_id,
        product=product,
        item_key=item_key,
        created_at=now,
    )
    row.symbol = _payload_symbol(payload, symbol)
    row.source = "ws"
    row.published_at = _published_at(payload, received_at or now)
    row.payload_json = _json_dumps(payload)
    row.fetched_at = now
    row.updated_at = now
    if price_snapshot:
        row.price_ltp = price_snapshot.get("price_ltp")
        row.price_change_pct = price_snapshot.get("price_change_pct")
        row.price_as_of = price_snapshot.get("price_as_of")
        row.price_source = price_snapshot.get("price_source")
        row.price_broker_code = price_snapshot.get("price_broker_code")
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        existing = db.scalar(
            select(AlphaFeedItem).where(
                AlphaFeedItem.user_id == user_id,
                AlphaFeedItem.product == product,
                AlphaFeedItem.item_key == item_key,
            )
        )
        if existing is not None:
            row = existing
            row.symbol = _payload_symbol(payload, symbol)
            row.source = "ws"
            row.published_at = _published_at(payload, received_at or now)
            row.payload_json = _json_dumps(payload)
            row.fetched_at = now
            row.updated_at = now
            if price_snapshot:
                row.price_ltp = price_snapshot.get("price_ltp")
                row.price_change_pct = price_snapshot.get("price_change_pct")
                row.price_as_of = price_snapshot.get("price_as_of")
                row.price_source = price_snapshot.get("price_source")
                row.price_broker_code = price_snapshot.get("price_broker_code")
            db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    return row


def _mark_symbols_synced(
    db: Session,
    *,
    user_id: str,
    product: str,
    symbols: list[str],
) -> None:
    now = _utc_now()
    for symbol in symbols:
        row = db.scalar(
            select(AlphaFeedSymbolSync).where(
                AlphaFeedSymbolSync.user_id == user_id,
                AlphaFeedSymbolSync.product == product,
                AlphaFeedSymbolSync.symbol == symbol,
            )
        )
        if row is None:
            row = AlphaFeedSymbolSync(
                id=str(uuid.uuid4()),
                user_id=user_id,
                product=product,
                symbol=symbol,
                created_at=now,
            )
        row.last_synced_at = now
        row.last_error = None
        row.updated_at = now
        db.add(row)


def _mark_symbols_sync_failed(
    db: Session,
    *,
    user_id: str,
    product: str,
    symbols: list[str],
    error: str,
) -> None:
    """Record a failed Drishti refresh without advancing last_synced_at."""
    now = _utc_now()
    for symbol in symbols:
        row = db.scalar(
            select(AlphaFeedSymbolSync).where(
                AlphaFeedSymbolSync.user_id == user_id,
                AlphaFeedSymbolSync.product == product,
                AlphaFeedSymbolSync.symbol == symbol,
            )
        )
        if row is None:
            row = AlphaFeedSymbolSync(
                id=str(uuid.uuid4()),
                user_id=user_id,
                product=product,
                symbol=symbol,
                created_at=now,
            )
        row.last_error = error[:500]
        row.updated_at = now
        db.add(row)


def _symbols_needing_sync(
    db: Session,
    *,
    user_id: str,
    product: str,
    symbols: list[str],
    force_refresh: bool,
) -> list[str]:
    """Return every symbol that should be refreshed — full watchlist, no subset cap."""
    if not symbols:
        return []

    if force_refresh:
        return list(symbols)

    cutoff = _utc_now() - _FEED_SYNC_TTL
    rows = db.scalars(
        select(AlphaFeedSymbolSync).where(
            AlphaFeedSymbolSync.user_id == user_id,
            AlphaFeedSymbolSync.product == product,
            AlphaFeedSymbolSync.symbol.in_(symbols),
        )
    ).all()
    sync_by_symbol = {row.symbol: row for row in rows}

    never_synced: list[str] = []
    stale: list[tuple[datetime, str]] = []
    for symbol in symbols:
        row = sync_by_symbol.get(symbol)
        if row is None or row.last_synced_at is None:
            never_synced.append(symbol)
            continue
        if row.last_error or row.last_synced_at < cutoff:
            stale.append((row.last_synced_at, symbol))

    stale.sort(key=lambda item: item[0])  # oldest first
    return [*never_synced, *[symbol for _ts, symbol in stale]]


def _refresh_from_date_for_batch(
    db: Session,
    *,
    user_id: str,
    product: str,
    batch: list[str],
    force_refresh: bool,
    requested_from: str | None = None,
) -> str | None:
    """Narrow Drishti REST `from` to the sync gap instead of a too-short UI window."""
    lookback = timedelta(days=_lookback_days(product))
    floor = _utc_now() - lookback
    if requested_from:
        try:
            requested = datetime.strptime(requested_from[:10], "%Y-%m-%d")
            if requested < floor:
                floor = requested
        except ValueError:
            pass
    if force_refresh:
        return floor.strftime("%Y-%m-%d")

    rows = db.scalars(
        select(AlphaFeedSymbolSync).where(
            AlphaFeedSymbolSync.user_id == user_id,
            AlphaFeedSymbolSync.product == product,
            AlphaFeedSymbolSync.symbol.in_(batch),
        )
    ).all()
    sync_by_symbol = {row.symbol: row for row in rows}
    never_synced = [symbol for symbol in batch if sync_by_symbol.get(symbol) is None]
    if never_synced:
        return floor.strftime("%Y-%m-%d")

    synced_times = [
        row.last_synced_at
        for row in sync_by_symbol.values()
        if row.last_synced_at is not None
    ]
    if not synced_times:
        return floor.strftime("%Y-%m-%d")

    oldest_sync = min(synced_times)
    cutoff = oldest_sync - timedelta(hours=1)
    if cutoff < floor:
        cutoff = floor
    return cutoff.strftime("%Y-%m-%d")


def _symbol_match_clauses(normalized: list[str]) -> Any:
    if not normalized:
        return False
    # SQLite caps OR expression depth (~1000); large watchlists use exact IN only.
    if len(normalized) > _FEED_INCLUDE_MARKET_WIDE_MIN_SYMBOLS:
        return AlphaFeedItem.symbol.in_(normalized)
    clauses: list[Any] = []
    for symbol in normalized:
        clauses.append(AlphaFeedItem.symbol == symbol)
        clauses.append(AlphaFeedItem.symbol.like(f"{symbol}:%"))
        clauses.append(AlphaFeedItem.symbol.like(f"%:{symbol}:%"))
        clauses.append(AlphaFeedItem.symbol.like(f"%:{symbol}"))
    return or_(*clauses)


def _should_include_market_wide_feed(normalized: list[str]) -> bool:
    return len(normalized) >= _FEED_INCLUDE_MARKET_WIDE_MIN_SYMBOLS


def _symbol_has_cached_items(
    db: Session,
    *,
    user_id: str,
    product: str,
    symbol: str,
) -> bool:
    return bool(
        db.scalar(
            select(AlphaFeedItem.id).where(
                AlphaFeedItem.user_id == user_id,
                AlphaFeedItem.product == product,
                _symbol_match_clauses([symbol]),
            ).limit(1)
        )
    )


def _upsert_rest_rows(
    db: Session,
    *,
    user_id: str,
    product: str,
    batch: list[str],
    rows: list[dict[str, Any]],
    now: datetime,
) -> int:
    upserted = 0
    batch_fallback = batch[0] if len(batch) == 1 else None
    for payload in rows:
        item_key = _item_key(product, payload)
        existing = db.scalar(
            select(AlphaFeedItem).where(
                AlphaFeedItem.user_id == user_id,
                AlphaFeedItem.product == product,
                AlphaFeedItem.item_key == item_key,
            )
        )
        row = existing or AlphaFeedItem(
            id=str(uuid.uuid4()),
            user_id=user_id,
            product=product,
            item_key=item_key,
            created_at=now,
        )
        row.symbol = _payload_symbol(payload, batch_fallback)
        row.source = "rest"
        row.published_at = _published_at(payload, now)
        row.payload_json = _json_dumps(payload)
        row.fetched_at = now
        row.updated_at = now
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
            upserted += 1
        except IntegrityError:
            logger.debug(
                "Alpha feed row already exists for %s/%s/%s",
                user_id,
                product,
                item_key,
            )
    return upserted


def refresh_feed_cache_for_symbols(
    db: Session,
    user_id: str,
    product: str,
    symbols: list[str],
    *,
    from_date: str | None = None,
    to_date: str | None = None,
    force_refresh: bool = False,
    max_batches: int | None = _FEED_MAX_REFRESH_BATCHES,
) -> dict[str, Any]:
    if product not in ALPHA_FEED_PRODUCTS:
        raise ValueError(f"Unsupported product: {product}")
    normalized = _normalize_symbols(symbols)
    if not normalized:
        return {"refreshed_symbols": 0, "upserted": 0, "pending_remaining": 0}

    empty_symbols = [
        symbol
        for symbol in normalized
        if not _symbol_has_cached_items(db, user_id=user_id, product=product, symbol=symbol)
    ]

    pending = _symbols_needing_sync(
        db,
        user_id=user_id,
        product=product,
        symbols=normalized,
        force_refresh=force_refresh,
    )
    if not force_refresh:
        for symbol in empty_symbols:
            if symbol not in pending:
                pending.append(symbol)
    if not pending:
        return {"refreshed_symbols": 0, "upserted": 0, "pending_remaining": 0}

    api_key = _credential_api_key(db, user_id)
    client = _drishti_client(api_key)
    upserted = 0
    now = _utc_now()
    batches_processed = 0
    symbols_refreshed = 0
    batch_limit = max_batches if max_batches is not None else len(pending)

    for start in range(0, len(pending), _FEED_BATCH_SIZE):
        if batches_processed >= batch_limit:
            break
        batch = pending[start : start + _FEED_BATCH_SIZE]
        batches_processed += 1
        batch_from_date = _refresh_from_date_for_batch(
            db,
            user_id=user_id,
            product=product,
            batch=batch,
            force_refresh=force_refresh or bool(empty_symbols),
            requested_from=from_date,
        )
        try:
            page = 1
            batch_upserted = 0
            page_cap = 2 if (force_refresh or bool(empty_symbols)) else _FEED_MAX_DRISHTI_PAGES_PER_BATCH
            while page <= page_cap:
                rows = _fetch_product_page(
                    client,
                    product,
                    symbols=batch,
                    from_date=batch_from_date,
                    to_date=to_date,
                    page=page,
                    limit=_FEED_PAGE_FETCH_LIMIT,
                )
                if not rows:
                    break
                batch_upserted += _upsert_rest_rows(
                    db,
                    user_id=user_id,
                    product=product,
                    batch=batch,
                    rows=rows,
                    now=now,
                )
                if len(rows) < _FEED_PAGE_FETCH_LIMIT:
                    break
                page += 1
            upserted += batch_upserted
            _mark_symbols_synced(db, user_id=user_id, product=product, symbols=batch)
            symbols_refreshed += len(batch)
        except DrishtiApiError as exc:
            logger.warning("Drishti feed refresh failed for %s/%s: %s", user_id, product, exc)
            _mark_symbols_sync_failed(
                db,
                user_id=user_id,
                product=product,
                symbols=batch,
                error=str(exc),
            )
        except Exception:
            logger.exception("Unexpected feed refresh failure for %s/%s", user_id, product)
            _mark_symbols_sync_failed(
                db,
                user_id=user_id,
                product=product,
                symbols=batch,
                error="unexpected refresh failure",
            )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.warning("Alpha feed refresh commit failed for %s/%s: %s", user_id, product, exc)
    pending_remaining = max(0, len(pending) - symbols_refreshed)
    return {
        "refreshed_symbols": symbols_refreshed,
        "upserted": upserted,
        "pending_remaining": pending_remaining,
    }


def _feed_query_filters(
    user_id: str,
    product: str,
    normalized: list[str],
    *,
    from_date: str | None,
    to_date: str | None,
) -> list[Any]:
    symbol_clause = _symbol_match_clauses(normalized)
    if _should_include_market_wide_feed(normalized):
        market_wide_symbols = list(_INVALID_FEED_SYMBOLS)
        symbol_clause = or_(
            symbol_clause,
            AlphaFeedItem.symbol.is_(None),
            AlphaFeedItem.symbol.in_(market_wide_symbols),
        )
    filters: list[Any] = [
        AlphaFeedItem.user_id == user_id,
        AlphaFeedItem.product == product,
        symbol_clause,
    ]
    if from_date and product not in {"earnings", "concalls"}:
        try:
            start = datetime.strptime(from_date[:10], "%Y-%m-%d")
            filters.append(or_(AlphaFeedItem.published_at.is_(None), AlphaFeedItem.published_at >= start))
        except ValueError:
            pass
    if to_date:
        try:
            end = datetime.strptime(to_date[:10], "%Y-%m-%d") + timedelta(days=1)
            filters.append(or_(AlphaFeedItem.published_at.is_(None), AlphaFeedItem.published_at < end))
        except ValueError:
            pass
    return filters


def _query_cached_feed_page(
    db: Session,
    user_id: str,
    product: str,
    normalized: list[str],
    *,
    from_date: str | None,
    to_date: str | None,
    page: int,
    limit: int,
) -> dict[str, Any]:
    page = max(int(page or 1), 1)
    limit = max(1, min(int(limit or 20), 100))
    offset = (page - 1) * limit
    filters = _feed_query_filters(user_id, product, normalized, from_date=from_date, to_date=to_date)

    total = db.scalar(select(func.count()).select_from(AlphaFeedItem).where(and_(*filters))) or 0
    rows = db.scalars(
        select(AlphaFeedItem)
        .where(and_(*filters))
        .order_by(desc(AlphaFeedItem.published_at), desc(AlphaFeedItem.fetched_at))
        .offset(offset)
        .limit(limit)
    ).all()
    data: list[dict[str, Any]] = []
    for row in rows:
        payload = _json_loads(row.payload_json, {})
        if not isinstance(payload, dict):
            payload = {}
        if row.price_ltp is not None:
            payload.setdefault("price_at_event", {
                "ltp": row.price_ltp,
                "change_pct": row.price_change_pct,
                "as_of": row.price_as_of.isoformat() if row.price_as_of else None,
                "source": row.price_source,
                "broker_code": row.price_broker_code,
            })
        data.append(payload)
    return {
        "data": data,
        "page": page,
        "limit": limit,
        "has_next": offset + len(rows) < total,
        "total": int(total),
        "from_cache": True,
    }


def list_cached_feed_items(
    db: Session,
    user_id: str,
    product: str,
    symbols: list[str],
    *,
    from_date: str | None = None,
    to_date: str | None = None,
    page: int = 1,
    limit: int = 20,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if product not in ALPHA_FEED_PRODUCTS:
        raise ValueError(f"Unsupported product: {product}")
    normalized = _normalize_symbols(symbols)
    if not normalized:
        return {
            "data": [],
            "page": page,
            "limit": limit,
            "has_next": False,
            "total": 0,
            "from_cache": True,
            "synced_symbols": 0,
            "pending_symbols": 0,
        }

    page = max(int(page or 1), 1)
    limit = max(1, min(int(limit or 20), 100))

    # Serve cached rows immediately; load-more pages must not block on Drishti refresh.
    result = _query_cached_feed_page(
        db,
        user_id,
        product,
        normalized,
        from_date=from_date,
        to_date=to_date,
        page=page,
        limit=limit,
    )

    refresh_stats = {"refreshed_symbols": 0, "upserted": 0, "pending_remaining": 0}
    if page == 1:
        try:
            refresh_stats = refresh_feed_cache_for_symbols(
                db,
                user_id,
                product,
                normalized,
                from_date=from_date,
                to_date=to_date,
                force_refresh=force_refresh,
            )
            if refresh_stats.get("upserted"):
                result = _query_cached_feed_page(
                    db,
                    user_id,
                    product,
                    normalized,
                    from_date=from_date,
                    to_date=to_date,
                    page=page,
                    limit=limit,
                )
        except Exception as exc:
            logger.warning(
                "Alpha feed refresh failed for %s/%s; serving cached rows: %s",
                user_id,
                product,
                exc,
            )
    else:
        pending = _symbols_needing_sync(
            db,
            user_id=user_id,
            product=product,
            symbols=normalized,
            force_refresh=False,
        )
        refresh_stats["pending_remaining"] = len(pending)

    return {
        **result,
        "from_cache": bool(result.get("from_cache")) and int(refresh_stats.get("upserted") or 0) == 0,
        "synced_symbols": int(refresh_stats.get("refreshed_symbols") or 0),
        "pending_symbols": int(refresh_stats.get("pending_remaining") or 0),
    }
