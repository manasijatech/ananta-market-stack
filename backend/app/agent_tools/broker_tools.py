"""Broker data and watchlist tools for future AI chat agents.

The functions in this module intentionally wrap the same service/client paths
used by the HTTP APIs. They do not accept broker secrets and they do not bypass
stored account ownership, session expiry, encryption, instrument hydration, or
broker-specific client construction.
"""

from __future__ import annotations

import fnmatch
import json
import re
from datetime import date, datetime
from typing import Any, Literal

import redis
from agents import RunContextWrapper, function_tool
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.broker import (
    HistoricalRequest,
    InstrumentSearchRow,
    InstrumentRef,
    OptionChainRequest,
    OhlcRequest,
    QuoteRequest,
)
from app.schemas.watchlist import (
    WatchlistCreateIn,
    WatchlistSymbolCreateIn,
    WatchlistSymbolsBulkIn,
    WatchlistSymbolsReplaceIn,
    WatchlistUpdateIn,
)
from app.services import broker_accounts, broker_data, broker_data_preferences, broker_sessions, rbac
from app.services import watchlists as watchlist_svc
from broker.core.instrument_store import SQLiteInstrumentResolver
from broker.core.redis_cache import cache_quotes
from broker.core.registry import get_client_for_account
from db.models import BrokerAccount, SystemWatchlistPresetSymbol, User, UserWatchlist, UserWatchlistSymbol
from db.session import SessionLocal

DEFAULT_AGENT_USER_ID = "local-dev-user"

PortfolioSection = Literal["orders", "trades", "positions", "holdings", "funds"]
InstrumentStorageTarget = Literal["csv", "db"]
_SYMBOL_LIKE_RE = re.compile(r"^[A-Z0-9&.\-]+$")


class BrokerAgentContext(BaseModel):
    """Runtime context passed to broker tools by the future chat runner."""

    user_id: str | None = Field(
        default=None,
        description="Ananta Market Stack user id whose broker accounts should be used.",
    )
    default_account_id: str | None = Field(
        default=None,
        description="Optional broker account id to prefer for portfolio and market-data tools.",
    )
    search_account_id: str | None = Field(
        default=None,
        description="Optional broker account id to prefer for instrument search tools.",
    )


class BrokerToolActionRequired(Exception):
    def __init__(self, message: str, *, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.detail = detail or {}


def _context_value(ctx: RunContextWrapper[BrokerAgentContext], field: str) -> str | None:
    context = getattr(ctx, "context", None)
    if isinstance(context, dict):
        value = context.get(field)
    else:
        value = getattr(context, field, None)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _user_id(ctx: RunContextWrapper[BrokerAgentContext]) -> str:
    return _context_value(ctx, "user_id") or DEFAULT_AGENT_USER_ID


def _db() -> Session:
    return SessionLocal()


def _ensure_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user:
        return user
    user = User(id=user_id, display_name=None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _principal(db: Session, user_id: str) -> rbac.Principal:
    return rbac.ensure_principal(db, _ensure_user(db, user_id))


def _serialize(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if isinstance(value, tuple):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _serialize(item) for key, item in value.items()}
    return value


def _ok(**payload: Any) -> dict[str, Any]:
    return {"ok": True, **_serialize(payload)}


def _error(message: str, *, code: str = "broker_tool_error", **payload: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, **_serialize(payload)}


def _tool_call(fn):
    try:
        return fn()
    except BrokerToolActionRequired as exc:
        return _error(str(exc), code="action_required", **exc.detail)
    except HTTPException as exc:
        message = str(exc.detail) if exc.detail else "Request failed."
        return _error(message, code=f"http_{exc.status_code}")
    except ValueError as exc:
        return _error(str(exc), code="invalid_request")
    except Exception as exc:
        return _error(str(exc), code=exc.__class__.__name__)


def _account_summary(acc: BrokerAccount) -> dict[str, Any]:
    return {
        "account_id": acc.id,
        "broker_code": acc.broker_code,
        "label": acc.label,
        "is_active": acc.is_active,
        "last_verified_at": acc.last_verified_at,
        "last_error": acc.last_error,
        "session_status": acc.session_status,
        "session_expires_at": acc.session_expires_at,
        "automation_enabled": acc.automation_enabled,
        "automation_mode": acc.automation_mode,
    }


def _session_status(acc: BrokerAccount) -> dict[str, Any]:
    return broker_sessions.get_broker_session_status(acc).model_dump(mode="json")


def _accessible_account(
    db: Session,
    principal: rbac.Principal,
    account_id: str,
    *,
    permission: str,
) -> BrokerAccount:
    acc = db.get(BrokerAccount, account_id)
    if not acc or permission not in rbac.account_permissions(db, principal, acc):
        raise BrokerToolActionRequired(
            "Broker account not found for this user.",
            detail={"account_id": account_id},
        )
    if not acc.is_active:
        raise BrokerToolActionRequired(
            "Broker account is inactive.",
            detail={"account": _account_summary(acc)},
        )
    return acc


def _first_accessible_account(
    db: Session,
    principal: rbac.Principal,
    *,
    broker_code: str | None = None,
    permission: str,
) -> BrokerAccount | None:
    return next(
        (
            acc
            for acc in rbac.accessible_broker_accounts(db, principal)
            if acc.is_active
            and permission in rbac.account_permissions(db, principal, acc)
            and (not broker_code or acc.broker_code == broker_code)
        ),
        None,
    )


def _context_account_id(
    ctx: RunContextWrapper[BrokerAgentContext],
    *,
    purpose: Literal["default", "search"],
) -> str | None:
    return _context_value(ctx, "search_account_id" if purpose == "search" else "default_account_id")


def _configured_account_id(
    db: Session,
    user_id: str,
    principal: rbac.Principal,
    *,
    purpose: Literal["default", "search"],
) -> str | None:
    if purpose == "search":
        config = broker_data_preferences.get_broker_data_search_config(db, user_id, principal)
        return config.effective_search_account_id or config.preferred_search_account_id
    config = broker_data_preferences.get_broker_data_default_config(db, user_id, principal)
    return config.effective_default_account_id or config.preferred_default_account_id


def _resolve_account(
    db: Session,
    ctx: RunContextWrapper[BrokerAgentContext],
    *,
    account_id: str | None = None,
    broker_code: str | None = None,
    purpose: Literal["default", "search"] = "default",
    require_session: bool = True,
    auto_refresh_session: bool = True,
    permission: str = rbac.BROKER_USE_DATA,
) -> BrokerAccount:
    user_id = _user_id(ctx)
    principal = _principal(db, user_id)

    selected_id = account_id or _context_account_id(ctx, purpose=purpose)
    if not selected_id:
        selected_id = _configured_account_id(db, user_id, principal, purpose=purpose)

    acc = (
        _accessible_account(db, principal, selected_id, permission=permission)
        if selected_id
        else None
    )
    if acc and broker_code and acc.broker_code != broker_code:
        acc = None
    if acc is None:
        acc = _first_accessible_account(
            db,
            principal,
            broker_code=broker_code,
            permission=permission,
        )

    if acc is None:
        raise BrokerToolActionRequired(
            "No active broker account is connected for this user.",
            detail={"user_id": user_id, "broker_code": broker_code},
        )

    if not require_session:
        return acc

    status = _session_status(acc)
    can_manage_session = (
        rbac.BROKER_MANAGE_SESSIONS in rbac.account_permissions(db, principal, acc)
    )
    if (
        not status.get("session_active")
        and auto_refresh_session
        and acc.automation_enabled
        and can_manage_session
    ):
        broker_sessions.process_account_maintenance(db, acc)
        db.refresh(acc)
        status = _session_status(acc)

    if not status.get("session_active"):
        raise BrokerToolActionRequired(
            "Broker session is not active. Refresh or reconnect the broker account before requesting live broker data.",
            detail={
                "account": _account_summary(acc),
                "session": status,
            },
        )
    return acc


def _client(db: Session, acc: BrokerAccount):
    return get_client_for_account(acc, resolver=SQLiteInstrumentResolver(db, acc.broker_code))


def _filter_rows_payload(
    payload: dict[str, Any],
    *,
    symbol: str | None = None,
    exchange: str | None = None,
) -> dict[str, Any]:
    if not symbol and not exchange:
        return payload
    symbol_upper = symbol.upper() if symbol else None
    exchange_upper = exchange.upper() if exchange else None

    def row_matches(row: dict[str, Any]) -> bool:
        row_symbol = str(
            row.get("tradingsymbol")
            or row.get("trading_symbol")
            or row.get("symbol")
            or row.get("securityId")
            or ""
        ).upper()
        row_exchange = str(row.get("exchange") or row.get("exchange_segment") or "").upper()
        if symbol_upper and symbol_upper not in row_symbol:
            return False
        if exchange_upper and exchange_upper != row_exchange:
            return False
        return True

    out = dict(payload)
    for key in ("data", "payload", "positions", "holdings", "orders", "trades", "net"):
        value = out.get(key)
        if isinstance(value, list):
            out[key] = [row for row in value if isinstance(row, dict) and row_matches(row)]
            return out
        if isinstance(value, dict):
            nested = dict(value)
            for nested_key in ("positions", "holdings", "orders", "trades", "net"):
                nested_value = nested.get(nested_key)
                if isinstance(nested_value, list):
                    nested[nested_key] = [
                        row for row in nested_value if isinstance(row, dict) and row_matches(row)
                    ]
                    out[key] = nested
                    return out
    return out


def _normalize_instruments(instruments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    QuoteRequest(instruments=[InstrumentRef.model_validate(item) for item in instruments])
    return [dict(item) for item in instruments]


def _redis_client() -> redis.Redis | None:
    settings = get_settings()
    try:
        return redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            username=settings.redis_username or None,
            password=settings.redis_password or None,
            db=settings.redis_db,
            ssl=settings.redis_ssl,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    except redis.RedisError:
        return None


def _read_cached_quotes(
    *,
    user_id: str,
    account_id: str,
    broker_code: str,
    symbols: list[str] | None,
    limit: int,
) -> list[dict[str, Any]]:
    client = _redis_client()
    if client is None:
        return []
    prefix = f"quote:{user_id}:{account_id}:{broker_code}:"
    keys: list[str] = []
    if symbols:
        keys = [prefix + symbol for symbol in symbols]
    else:
        pattern = prefix + "*"
        for key in client.scan_iter(match=pattern, count=100):
            keys.append(key)
            if len(keys) >= limit:
                break
    rows: list[dict[str, Any]] = []
    for key in keys[:limit]:
        raw = client.get(key)
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            payload.setdefault("redis_key", key)
            rows.append(payload)
    return rows


def _watchlist_source(watchlist: UserWatchlist) -> dict[str, Any]:
    preset = watchlist.system_preset if watchlist.kind == "preset" else None
    return {
        "watchlist_id": watchlist.id,
        "name": watchlist.name,
        "kind": watchlist.kind,
        "is_user_created": watchlist.kind == "manual",
        "is_imported_preset": watchlist.kind == "preset",
        "is_editable": watchlist.kind == "manual",
        "preset_id": preset.id if preset else None,
        "preset_slug": preset.slug if preset else None,
        "preset_name": preset.name if preset else None,
        "preset_trading_index_name": preset.trading_index_name if preset else None,
        "preset_sync_status": preset.sync_status if preset else None,
        "preset_last_synced_at": preset.last_constituents_sync_at if preset else None,
        "created_at": watchlist.created_at,
        "updated_at": watchlist.updated_at,
    }


def _watchlist_symbol_rows(
    db: Session,
    watchlist: UserWatchlist,
    *,
    limit: int,
) -> list[UserWatchlistSymbol | SystemWatchlistPresetSymbol]:
    safe_limit = max(1, min(int(limit), 2000))
    if watchlist.kind == "preset" and watchlist.system_preset_id:
        return list(
            db.scalars(
                select(SystemWatchlistPresetSymbol)
                .where(SystemWatchlistPresetSymbol.preset_id == watchlist.system_preset_id)
                .order_by(SystemWatchlistPresetSymbol.sort_order.asc(), SystemWatchlistPresetSymbol.symbol.asc())
                .limit(safe_limit)
            ).all()
        )
    return list(
        db.scalars(
            select(UserWatchlistSymbol)
            .where(UserWatchlistSymbol.watchlist_id == watchlist.id)
            .order_by(UserWatchlistSymbol.sort_order.asc(), UserWatchlistSymbol.symbol.asc())
            .limit(safe_limit)
        ).all()
    )


def _watchlist_symbol_payload(row: UserWatchlistSymbol | SystemWatchlistPresetSymbol) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "symbol": row.symbol,
        "exchange": row.exchange or None,
        "sort_order": row.sort_order,
    }
    if isinstance(row, UserWatchlistSymbol):
        try:
            ref = json.loads(row.instrument_ref_json or "{}")
        except json.JSONDecodeError:
            ref = {}
        payload["instrument_ref"] = ref if isinstance(ref, dict) else {}
        payload["created_at"] = row.created_at
    else:
        payload.update(
            {
                "company_name": row.company_name,
                "industry": row.industry,
                "isin": row.isin,
                "series": row.series,
                "weight": row.weight,
                "created_at": row.created_at,
            }
        )
    return payload


def _watchlist_summary(
    db: Session,
    watchlist: UserWatchlist,
    *,
    include_symbols: bool,
    symbol_limit: int,
) -> dict[str, Any]:
    rows = _watchlist_symbol_rows(db, watchlist, limit=symbol_limit if include_symbols else 1)
    if watchlist.kind == "preset" and watchlist.system_preset:
        symbol_count = len(watchlist.system_preset.symbols)
    else:
        symbol_count = len(watchlist.symbols)
    payload = {
        **_watchlist_source(watchlist),
        "symbol_count": symbol_count,
    }
    if include_symbols:
        payload["symbols"] = [_watchlist_symbol_payload(row) for row in rows]
        payload["symbols_truncated"] = symbol_count > len(rows)
    return payload


def _owned_watchlists(db: Session, user_id: str) -> list[UserWatchlist]:
    return list(
        db.scalars(
            select(UserWatchlist)
            .where(UserWatchlist.user_id == user_id)
            .order_by(UserWatchlist.updated_at.desc(), UserWatchlist.name.asc(), UserWatchlist.id.asc())
        ).all()
    )


def _match_watchlists(
    watchlists: list[UserWatchlist],
    *,
    watchlist_id: str | None,
    name: str | None,
    kind: Literal["manual", "preset"] | None,
) -> list[UserWatchlist]:
    rows = watchlists
    if watchlist_id:
        rows = [watchlist for watchlist in rows if watchlist.id == watchlist_id]
    if kind:
        rows = [watchlist for watchlist in rows if watchlist.kind == kind]
    if name:
        query = name.strip().casefold()
        rows = [
            watchlist
            for watchlist in rows
            if query in watchlist.name.casefold()
            or (
                watchlist.system_preset is not None
                and (
                    query in watchlist.system_preset.name.casefold()
                    or query in watchlist.system_preset.slug.casefold()
                    or query in watchlist.system_preset.trading_index_name.casefold()
                )
            )
        ]
    return rows


def _instrument_ref_from_search_row(row: InstrumentSearchRow) -> InstrumentRef:
    identifiers = row.identifiers or {}
    payload = {
        "symbol": row.symbol,
        "exchange": row.exchange,
        "zerodha_instrument_token": identifiers.get("zerodha_instrument_token"),
        "upstox_instrument_key": identifiers.get("upstox_instrument_key"),
        "angel_exchange": row.exchange,
        "angel_token": identifiers.get("angel_token"),
        "dhan_exchange_segment": identifiers.get("dhan_exchange_segment"),
        "dhan_security_id": identifiers.get("dhan_security_id"),
        "groww_exchange": row.exchange,
        "groww_segment": row.segment,
        "groww_trading_symbol": identifiers.get("groww_trading_symbol") or row.trading_symbol,
        "indmoney_scrip_code": identifiers.get("indmoney_scrip_code"),
        "kotak_query": identifiers.get("kotak_query"),
        "kotak_segment": identifiers.get("kotak_segment"),
        "kotak_psymbol": identifiers.get("kotak_psymbol"),
    }
    return InstrumentRef.model_validate({key: value for key, value in payload.items() if value not in (None, "")})


def _symbol_match_rank(query: str, row: InstrumentSearchRow, preferred_exchange: str | None) -> tuple[int, int, int, str]:
    normalized_query = query.strip().upper()
    row_symbol = (row.symbol or "").strip().upper()
    row_trading_symbol = (row.trading_symbol or "").strip().upper()
    row_exchange = (row.exchange or "").strip().upper()
    row_segment = (row.segment or "").strip().upper()
    exact_rank = 0 if normalized_query in {row_symbol, row_trading_symbol} else 1
    exchange_rank = 0 if preferred_exchange and row_exchange == preferred_exchange else 1
    if not preferred_exchange and row_exchange == "NSE":
        exchange_rank = 0
    segment_rank = 0 if row_segment in {"NSE", "CASH", "EQ", "EQUITY"} else 1
    return (exact_rank, exchange_rank, segment_rank, row_symbol or row_trading_symbol)


def _is_exact_symbol_match(query: str, row: InstrumentSearchRow) -> bool:
    normalized_query = query.strip().upper()
    return normalized_query in {
        (row.symbol or "").strip().upper(),
        (row.trading_symbol or "").strip().upper(),
    }


def _resolve_watchlist_symbol_items(
    db: Session,
    ctx: RunContextWrapper[BrokerAgentContext],
    symbols: list[str],
    *,
    exchange: str | None = None,
    account_id: str | None = None,
    broker_code: str | None = None,
) -> tuple[list[WatchlistSymbolCreateIn], list[dict[str, Any]]]:
    user_id = _user_id(ctx)
    safe_exchange = (exchange or "").strip().upper() or None
    seen: set[str] = set()
    resolved: list[WatchlistSymbolCreateIn] = []
    unresolved: list[dict[str, Any]] = []
    search_account: BrokerAccount | None = None
    if account_id or broker_code:
        search_account = _resolve_account(
            db,
            ctx,
            account_id=account_id,
            broker_code=broker_code,
            purpose="search",
            require_session=False,
        )

    for raw_symbol in symbols:
        query = str(raw_symbol or "").strip()
        if not query:
            continue
        dedupe_key = query.upper()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        if search_account:
            matches = broker_data.search_instruments(
                db,
                search_account,
                query=query,
                exchange=safe_exchange,
                limit=200,
            )
        else:
            matches = broker_data_preferences.search_instruments_for_user(
                db,
                user_id,
                query=query,
                exchange=safe_exchange,
                limit=200,
            )
        if not matches:
            unresolved.append({"query": query, "reason": "No matching broker instrument was found."})
            continue
        ordered = sorted(matches, key=lambda row: _symbol_match_rank(query, row, safe_exchange))
        if _SYMBOL_LIKE_RE.fullmatch(query.upper()) and not any(_is_exact_symbol_match(query, row) for row in ordered):
            unresolved.append(
                {
                    "query": query,
                    "reason": "Instrument search returned only partial matches, so no symbol was stored.",
                }
            )
            continue
        match = ordered[0]
        resolved.append(
            WatchlistSymbolCreateIn(
                symbol=match.symbol,
                exchange=match.exchange or safe_exchange,
                account_id=match.account_id,
                broker_code=match.broker_code,
                instrument_ref=_instrument_ref_from_search_row(match),
            )
        )
    return resolved, unresolved


def _find_single_watchlist_for_mutation(
    db: Session,
    user_id: str,
    *,
    watchlist_id: str | None,
    name: str | None,
    kind: Literal["manual", "preset"] | None = None,
) -> UserWatchlist:
    matches = _match_watchlists(
        _owned_watchlists(db, user_id),
        watchlist_id=watchlist_id,
        name=name,
        kind=kind,
    )
    if not matches:
        raise BrokerToolActionRequired(
            "No matching watchlist was found for this user.",
            detail={"watchlist_id": watchlist_id, "name": name, "kind": kind},
        )
    if len(matches) > 1:
        raise BrokerToolActionRequired(
            "Multiple watchlists matched. Use watchlist_id or pass kind to distinguish manual vs preset.",
            detail={
                "candidates": [
                    _watchlist_summary(db, watchlist, include_symbols=False, symbol_limit=1)
                    for watchlist in matches[:20]
                ],
                "total_count": len(matches),
                "truncated": len(matches) > 20,
            },
        )
    return matches[0]


@function_tool(strict_mode=False)
def broker_list_accounts(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """List broker accounts connected to the current user.

    Use this first when the agent needs to know which broker accounts exist,
    their account ids, labels, verification state, session state, and default
    data/search preferences. The result never includes API keys, tokens, PINs,
    TOTP secrets, passwords, or decrypted credential values.

    Selection guidance for agents:
    - Prefer ``default_config.effective_default_account_id`` for portfolio,
      quotes, OHLC, historical, funds, orders, and positions.
    - Prefer ``search_config.effective_search_account_id`` for instrument
      search and symbol resolution.
    - If exactly one active account is returned, use it without asking the user
      to choose an account.
    - If a session is inactive, use the session-status or maintenance tools
      instead of asking for secrets in chat.
    """

    def call() -> dict[str, Any]:
        user_id = _user_id(ctx)
        db = _db()
        try:
            principal = _principal(db, user_id)
            accounts = rbac.accessible_broker_accounts(db, principal)
            return _ok(
                user_id=user_id,
                workspace_id=principal.workspace.id,
                accounts=[
                    {
                        **_account_summary(acc),
                        "is_shared": acc.user_id != user_id,
                        "access_permissions": sorted(rbac.account_permissions(db, principal, acc)),
                    }
                    for acc in accounts
                ],
                default_config=broker_data_preferences.get_broker_data_default_config(
                    db,
                    user_id,
                    principal,
                ),
                search_config=broker_data_preferences.get_broker_data_search_config(
                    db,
                    user_id,
                    principal,
                ),
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_list_watchlists(
    ctx: RunContextWrapper[BrokerAgentContext],
    kind: Literal["manual", "preset"] | None = None,
    query: str | None = None,
    include_symbols: bool = False,
    limit: int = 50,
    symbol_limit: int = 100,
) -> dict[str, Any]:
    """List the current user's watchlists and distinguish custom vs imported preset lists.

    Use this whenever the user asks what watchlists exist, asks about a named
    watchlist, or wants to choose a watchlist-backed universe for market-data
    analysis. ``kind: "manual"`` returns user-created custom watchlists;
    ``kind: "preset"`` returns imported system preset watchlists such as index
    constituents. The result includes ``is_user_created``,
    ``is_imported_preset``, editability, preset slug/index metadata, and symbol
    counts so the agent can explain the difference clearly.

    Set ``include_symbols`` only for small previews. For a full symbol list or
    a specific watchlist, use ``broker_get_watchlist_symbols``.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            safe_limit = max(1, min(int(limit), 200))
            rows = _match_watchlists(
                _owned_watchlists(db, user_id),
                watchlist_id=None,
                name=query,
                kind=kind,
            )
            selected = rows[:safe_limit]
            return _ok(
                user_id=user_id,
                total_count=len(rows),
                returned_count=len(selected),
                watchlists=[
                    _watchlist_summary(
                        db,
                        watchlist,
                        include_symbols=include_symbols,
                        symbol_limit=symbol_limit,
                    )
                    for watchlist in selected
                ],
                truncated=len(rows) > len(selected),
                guidance={
                    "manual": "User-created custom watchlist; symbols are directly editable by the user.",
                    "preset": "Imported system preset watchlist; symbols come from the linked preset and are refreshed through preset sync.",
                },
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_watchlist_symbols(
    ctx: RunContextWrapper[BrokerAgentContext],
    watchlist_id: str | None = None,
    name: str | None = None,
    kind: Literal["manual", "preset"] | None = None,
    limit: int = 1000,
) -> dict[str, Any]:
    """Return symbols for one user watchlist, preserving manual vs preset semantics.

    Use this after ``broker_list_watchlists`` or when the user names a
    watchlist and asks what symbols it contains. For manual watchlists, symbols
    come from ``user_watchlist_symbols`` and include stored broker instrument
    references when available. For imported preset watchlists, symbols come
    from the linked system preset and include preset metadata such as company
    name, industry, ISIN, series, and weight when available.

    If ``name`` matches multiple watchlists, the tool returns the candidate
    watchlists instead of guessing. Pass ``kind`` to disambiguate custom/manual
    watchlists from imported preset watchlists when names overlap.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            matches = _match_watchlists(
                _owned_watchlists(db, user_id),
                watchlist_id=watchlist_id,
                name=name,
                kind=kind,
            )
            if not matches:
                return _error(
                    "No matching watchlist was found for this user.",
                    code="watchlist_not_found",
                    user_id=user_id,
                    watchlist_id=watchlist_id,
                    name=name,
                    kind=kind,
                )
            if len(matches) > 1:
                return _ok(
                    user_id=user_id,
                    ambiguous=True,
                    message="Multiple watchlists matched. Choose by watchlist_id or pass kind to distinguish manual vs preset.",
                    candidates=[
                        _watchlist_summary(db, watchlist, include_symbols=False, symbol_limit=1)
                        for watchlist in matches[:20]
                    ],
                    total_count=len(matches),
                    truncated=len(matches) > 20,
                )

            watchlist = matches[0]
            rows = _watchlist_symbol_rows(db, watchlist, limit=limit)
            source = _watchlist_source(watchlist)
            if watchlist.kind == "preset" and watchlist.system_preset:
                symbol_count = len(watchlist.system_preset.symbols)
            else:
                symbol_count = len(watchlist.symbols)
            return _ok(
                user_id=user_id,
                watchlist=source,
                symbol_count=symbol_count,
                returned_count=len(rows),
                symbols=[_watchlist_symbol_payload(row) for row in rows],
                truncated=symbol_count > len(rows),
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_create_watchlist(
    ctx: RunContextWrapper[BrokerAgentContext],
    name: str,
    symbols: list[str] | None = None,
    exchange: str | None = None,
    account_id: str | None = None,
    broker_code: str | None = None,
) -> dict[str, Any]:
    """Create a user-owned manual watchlist and optionally seed it with valid instruments.

    Use this when the user asks to create a custom watchlist. If symbols or
    company names are supplied, this tool first validates each entry through
    the existing broker instrument search path and stores only matched
    instruments with broker-specific identifiers. Invalid/unmatched entries are
    returned under ``unresolved_symbols`` and are not stored.

    This tool creates only manual/user-created watchlists. Imported preset
    watchlists are managed through the preset catalog UI/API and cannot be
    edited by these mutation tools.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            requested = symbols or []
            resolved, unresolved = _resolve_watchlist_symbol_items(
                db,
                ctx,
                requested,
                exchange=exchange,
                account_id=account_id,
                broker_code=broker_code,
            )
            if requested and not resolved:
                return _error(
                    "No requested symbols matched broker instruments, so the watchlist was not created.",
                    code="no_valid_symbols",
                    unresolved_symbols=unresolved,
                )
            created = watchlist_svc.create_watchlist(db, user_id, WatchlistCreateIn(name=name, symbols=[]))
            result = created
            added_symbols: list[str] = []
            skipped_symbols: list[str] = []
            if resolved:
                added = watchlist_svc.add_symbols_to_watchlist(
                    db,
                    user_id,
                    created.id,
                    WatchlistSymbolsBulkIn(items=resolved),
                )
                if added is not None:
                    result = added.watchlist
                    added_symbols = added.added_symbols
                    skipped_symbols = added.skipped_symbols
            return _ok(
                watchlist=result,
                added_symbols=added_symbols,
                skipped_symbols=skipped_symbols,
                unresolved_symbols=unresolved,
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_rename_watchlist(
    ctx: RunContextWrapper[BrokerAgentContext],
    watchlist_id: str | None = None,
    name: str | None = None,
    new_name: str = "",
) -> dict[str, Any]:
    """Rename a user-created manual watchlist.

    Use this only for custom/manual watchlists. Imported preset watchlists are
    read-only links to system presets and cannot be renamed through this tool.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            watchlist = _find_single_watchlist_for_mutation(
                db,
                user_id,
                watchlist_id=watchlist_id,
                name=name,
                kind=None,
            )
            updated = watchlist_svc.update_watchlist(
                db,
                user_id,
                watchlist.id,
                WatchlistUpdateIn(name=new_name),
            )
            if updated is None:
                return _error("Watchlist not found.", code="watchlist_not_found")
            return _ok(watchlist=updated)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_delete_watchlist(
    ctx: RunContextWrapper[BrokerAgentContext],
    watchlist_id: str | None = None,
    name: str | None = None,
    kind: Literal["manual", "preset"] | None = None,
) -> dict[str, Any]:
    """Delete a user watchlist link.

    Manual watchlists are deleted with their symbols. Imported preset
    watchlists can also be removed from the user's watchlist list, but this
    deletes only the user's imported-watchlist link, not the underlying system
    preset catalog.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            watchlist = _find_single_watchlist_for_mutation(
                db,
                user_id,
                watchlist_id=watchlist_id,
                name=name,
                kind=kind,
            )
            source = _watchlist_source(watchlist)
            deleted = watchlist_svc.delete_watchlist(db, user_id, watchlist.id)
            return _ok(deleted=deleted, watchlist=source)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_add_watchlist_symbols(
    ctx: RunContextWrapper[BrokerAgentContext],
    watchlist_id: str | None = None,
    name: str | None = None,
    symbols: list[str] | None = None,
    exchange: str | None = None,
    account_id: str | None = None,
    broker_code: str | None = None,
) -> dict[str, Any]:
    """Add validated instruments to a manual watchlist.

    Before storing anything, this tool searches broker instruments for each
    supplied symbol/company name and stores only matched instruments. It never
    edits imported preset watchlists; use ``broker_delete_watchlist`` only if
    the user wants to remove an imported preset watchlist from their account.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            watchlist = _find_single_watchlist_for_mutation(
                db,
                user_id,
                watchlist_id=watchlist_id,
                name=name,
                kind="manual",
            )
            resolved, unresolved = _resolve_watchlist_symbol_items(
                db,
                ctx,
                symbols or [],
                exchange=exchange,
                account_id=account_id,
                broker_code=broker_code,
            )
            if not resolved:
                return _error(
                    "No requested symbols matched broker instruments, so nothing was added.",
                    code="no_valid_symbols",
                    unresolved_symbols=unresolved,
                )
            result = watchlist_svc.add_symbols_to_watchlist(
                db,
                user_id,
                watchlist.id,
                WatchlistSymbolsBulkIn(items=resolved),
            )
            if result is None:
                return _error("Watchlist not found.", code="watchlist_not_found")
            return _ok(
                watchlist=result.watchlist,
                added_symbols=result.added_symbols,
                skipped_symbols=result.skipped_symbols,
                unresolved_symbols=unresolved,
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_replace_watchlist_symbols(
    ctx: RunContextWrapper[BrokerAgentContext],
    watchlist_id: str | None = None,
    name: str | None = None,
    symbols: list[str] | None = None,
    exchange: str | None = None,
    account_id: str | None = None,
    broker_code: str | None = None,
) -> dict[str, Any]:
    """Replace all symbols in a manual watchlist with validated instruments.

    Each requested symbol/company name is resolved through broker instrument
    search first. Only valid matches are stored. Imported preset watchlists are
    not editable and will return an action-required error through the shared
    watchlist service.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            watchlist = _find_single_watchlist_for_mutation(
                db,
                user_id,
                watchlist_id=watchlist_id,
                name=name,
                kind="manual",
            )
            requested = symbols or []
            resolved, unresolved = _resolve_watchlist_symbol_items(
                db,
                ctx,
                requested,
                exchange=exchange,
                account_id=account_id,
                broker_code=broker_code,
            )
            if requested and not resolved:
                return _error(
                    "No requested symbols matched broker instruments, so the watchlist was not changed.",
                    code="no_valid_symbols",
                    unresolved_symbols=unresolved,
                )
            updated = watchlist_svc.replace_watchlist_symbols(
                db,
                user_id,
                watchlist.id,
                WatchlistSymbolsReplaceIn(symbols=resolved),
            )
            if updated is None:
                return _error("Watchlist not found.", code="watchlist_not_found")
            return _ok(watchlist=updated, unresolved_symbols=unresolved)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_remove_watchlist_symbols(
    ctx: RunContextWrapper[BrokerAgentContext],
    watchlist_id: str | None = None,
    name: str | None = None,
    symbols: list[str] | None = None,
    exchange: str | None = None,
) -> dict[str, Any]:
    """Remove one or more symbols from a manual watchlist.

    If ``exchange`` is omitted, all rows matching each symbol in that manual
    watchlist are removed. Imported preset watchlists are not editable; remove
    the preset watchlist link with ``broker_delete_watchlist`` instead.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            _ensure_user(db, user_id)
            watchlist = _find_single_watchlist_for_mutation(
                db,
                user_id,
                watchlist_id=watchlist_id,
                name=name,
                kind="manual",
            )
            requested = {str(symbol or "").strip().upper() for symbol in (symbols or []) if str(symbol or "").strip()}
            if not requested:
                return _error("Provide at least one symbol to remove.", code="invalid_request")
            safe_exchange = (exchange or "").strip().upper()
            removed: list[dict[str, Any]] = []
            missing = set(requested)
            current_rows = [
                row
                for row in list(watchlist.symbols)
                if row.symbol.upper() in requested and (not safe_exchange or row.exchange.upper() == safe_exchange)
            ]
            updated = None
            for row in current_rows:
                updated = watchlist_svc.remove_symbol_from_watchlist(
                    db,
                    user_id,
                    watchlist.id,
                    row.symbol,
                    row.exchange,
                )
                removed.append({"symbol": row.symbol, "exchange": row.exchange or None})
                missing.discard(row.symbol.upper())
                watchlist = _find_single_watchlist_for_mutation(
                    db,
                    user_id,
                    watchlist_id=watchlist.id,
                    name=None,
                    kind="manual",
                )
            if updated is None:
                updated = watchlist_svc.get_watchlist(db, user_id, watchlist.id)
            return _ok(watchlist=updated, removed_symbols=removed, missing_symbols=sorted(missing))
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_session_status(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Return broker session status and login/refresh guidance.

    Use this when a data tool reports an inactive session or when the agent
    needs to explain what the user must do next. If stored automation
    credentials are enabled and ``auto_refresh_session`` is true, the tool runs
    the existing session maintenance helper before returning status. It does
    not expose stored secrets.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=False,
                permission=rbac.BROKER_VIEW,
            )
            principal = _principal(db, _user_id(ctx))
            can_manage_session = (
                rbac.BROKER_MANAGE_SESSIONS
                in rbac.account_permissions(db, principal, acc)
            )
            if auto_refresh_session and acc.automation_enabled and can_manage_session:
                broker_sessions.process_account_maintenance(db, acc)
                db.refresh(acc)
            return _ok(account=_account_summary(acc), session=_session_status(acc))
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_verify_connection(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
) -> dict[str, Any]:
    """Verify connectivity for the selected broker account.

    Use this when the agent needs to confirm that stored credentials and the
    current broker session can make a lightweight broker request. This calls the
    same verification service as the HTTP API and may update last_verified_at,
    session error metadata, and the one-time instrument sync side effect used by
    the existing backend.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=False,
                permission=rbac.BROKER_MANAGE_SESSIONS,
            )
            ok, message = broker_accounts.verify_account(db, acc)
            db.refresh(acc)
            return _ok(account=_account_summary(acc), verified=ok, message=message or "")
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_run_session_maintenance(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """Run session maintenance for all active broker accounts of the current user.

    Use this before a multi-account analysis or when several accounts report
    inactive sessions. The helper attempts broker-supported automated refreshes,
    updates session status, and records action-required guidance for manual
    flows without exposing any stored secrets.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            principal = _principal(db, user_id)
            accounts = [
                acc
                for acc in rbac.accessible_broker_accounts(db, principal)
                if acc.is_active
                and rbac.BROKER_MANAGE_SESSIONS
                in rbac.account_permissions(db, principal, acc)
            ]
            for acc in accounts:
                broker_sessions.process_account_maintenance(db, acc)
            return _ok(
                user_id=user_id,
                processed_count=len(accounts),
                accounts=[
                    {
                        "account": _account_summary(acc),
                        "session": _session_status(acc),
                    }
                    for acc in accounts
                ],
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_data_capabilities(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
) -> dict[str, Any]:
    """Return the broker data feature matrix for an account.

    Use this before requesting optional capabilities such as historical candles,
    option chain, greeks, instrument cache, or stream inspection. Capability
    guidance reflects the existing Ananta Market Stack uniform API support for the
    selected broker.

    Use this when the user asks whether something is possible, when a previous
    market-data call failed because a broker/subscription may not support it, or
    before planning a broad multi-tool analysis. A positive capability means the
    uniform API knows how to call that broker feature; the broker can still
    reject a specific request because of account permissions, subscription tier,
    symbol coverage, or session state.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=False,
                permission=rbac.BROKER_VIEW,
            )
            return _ok(
                account=_account_summary(acc),
                capabilities=broker_data.get_capabilities(db, acc),
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_search_instruments(
    ctx: RunContextWrapper[BrokerAgentContext],
    query: str = "",
    account_id: str | None = None,
    broker_code: str | None = None,
    exchange: str | None = None,
    segment: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Search cached broker instruments by symbol, trading symbol, name, or identifiers.

    Use this to resolve an equity, future, option, or broker-native instrument
    before fetching quotes, OHLC, historical data, option chain, or greeks. When
    ``account_id`` is omitted, the user's preferred instrument-search account
    and cache fallback rules are used. The returned rows include broker-specific
    identifiers that can be passed directly to other broker tools.

    Agent routing guidance:
    - Use this when the user gives a plain symbol/name such as ``SILVERCASE`` or
      refers to an instrument found in holdings.
    - For Indian equities and ETFs with both NSE and BSE rows, choose NSE by
      default unless the user asks for BSE or only a BSE row exists.
    - Pass the chosen returned row, or at minimum its ``symbol`` and
      ``exchange``, to quote/OHLC/historical tools.
    - If no rows are found, consider broker_sync_instruments once, then retry
      the search before saying the instrument is unavailable.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            user_id = _user_id(ctx)
            principal = _principal(db, user_id)
            safe_limit = max(1, min(int(limit), 200))
            if account_id or broker_code:
                acc = _resolve_account(
                    db,
                    ctx,
                    account_id=account_id,
                    broker_code=broker_code,
                    purpose="search",
                    require_session=False,
                    permission=rbac.BROKER_USE_DATA,
                )
                rows = broker_data.search_instruments(
                    db,
                    acc,
                    query=query,
                    exchange=exchange,
                    segment=segment,
                    limit=safe_limit,
                )
                return _ok(account=_account_summary(acc), rows=rows)
            rows = broker_data_preferences.search_instruments_for_user(
                db,
                user_id,
                query=query,
                exchange=exchange,
                segment=segment,
                limit=safe_limit,
                principal=principal,
            )
            return _ok(user_id=user_id, rows=rows)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_sync_instruments(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
    storage_target: InstrumentStorageTarget = "csv",
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Refresh the local instrument cache for a broker account.

    Use this when instrument search has no results or broker-specific
    identifiers need to be refreshed. The default target is the CSV cache, which
    is the same default used by the service layer; choose ``db`` only when
    indexed SQLite search state is specifically needed.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
                permission=rbac.BROKER_MANAGE_SESSIONS,
            )
            if storage_target == "db":
                result = broker_data.sync_instruments_to_db(db, acc)
            else:
                result = broker_data.sync_instruments_to_csv(db, acc)
            return _ok(account=_account_summary(acc), sync=result)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_cached_quotes(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
    symbols: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Read the best-effort Redis quote cache for an account.

    Use this when a low-latency recent snapshot is acceptable or before making
    a live broker call. Cache keys follow
    ``quote:{user_id}:{account_id}:{broker_code}:{symbol}`` and expire quickly;
    an empty result means there is no fresh cached quote.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=False,
            )
            rows = _read_cached_quotes(
                user_id=acc.user_id,
                account_id=acc.id,
                broker_code=acc.broker_code,
                symbols=symbols,
                limit=max(1, min(int(limit), 200)),
            )
            return _ok(account=_account_summary(acc), rows=rows)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_quotes(
    ctx: RunContextWrapper[BrokerAgentContext],
    instruments: list[dict[str, Any]],
    account_id: str | None = None,
    broker_code: str | None = None,
    write_through_cache: bool = True,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Fetch live quotes for one or more instruments through the uniform broker layer.

    Pass instruments as dictionaries with ``symbol``/``exchange`` or the
    broker-specific identifiers returned by ``broker_search_instruments``.
    Symbol-first requests are hydrated from the local instrument cache where
    possible. The returned rows are normalized quote rows with broker-native
    detail preserved under ``detail``.

    Use this for latest market snapshots: LTP/current price, day change,
    bid/ask, volume, market depth fields, or current valuation of holdings.
    This is not a historical-performance tool; combine it with
    broker_get_historical when the user asks for 1-month/6-month returns.

    When historical candles are blocked by broker permissions, this is the best
    fallback for a current snapshot. Use one array of instruments in a single
    call; do not call it once per symbol unless the broker requires that.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            normalized = _normalize_instruments(instruments)
            rows = broker_data.fetch_quotes(db, acc, normalized)
            dumped_rows = [row.model_dump(mode="json") for row in rows]
            if write_through_cache and dumped_rows:
                cache_quotes(
                    user_id=acc.user_id,
                    account_id=acc.id,
                    broker_code=acc.broker_code,
                    quotes=dumped_rows,
                )
            return _ok(account=_account_summary(acc), rows=dumped_rows)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_ohlc(
    ctx: RunContextWrapper[BrokerAgentContext],
    instruments: list[dict[str, Any]],
    account_id: str | None = None,
    broker_code: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Fetch OHLC snapshots for instruments through the uniform broker layer.

    Use this for latest open/high/low/close style snapshots. For full candle
    history over a date range, use ``broker_get_historical`` instead.

    Use this when the user asks for "OHLC", today's open/high/low/close, or a
    fallback snapshot after historical access is denied. This returns latest
    broker snapshot data, not a list of candles across a month or six months.
    Pass instruments as dictionaries with ``symbol``/``exchange`` or the
    broker-specific identifiers from broker_search_instruments.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            request = OhlcRequest(instruments=[InstrumentRef.model_validate(item) for item in instruments])
            rows = broker_data.fetch_ohlc(
                db,
                acc,
                [item.model_dump(exclude_none=True) for item in request.instruments],
            )
            return _ok(account=_account_summary(acc), rows=rows)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_historical(
    ctx: RunContextWrapper[BrokerAgentContext],
    instrument: dict[str, Any],
    interval: str,
    from_date: str,
    to_date: str,
    account_id: str | None = None,
    broker_code: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Fetch historical candles for one instrument.

    ``interval`` is broker-native, for example ``minute``, ``5minute``, or
    ``day`` depending on the broker. ``from_date`` and ``to_date`` should be ISO
    timestamps or dates. Check ``broker_get_data_capabilities`` first because
    historical support varies across brokers.

    Critical tool-call rules for agents:
    - This tool accepts exactly one instrument, one interval, and one date
      range per call.
    - The arguments must be one valid JSON object. Never concatenate two calls
      like ``{...}{...}``; make two separate tool calls instead.
    - For daily performance analysis, use ``interval: "day"``.
    - For hourly/intraday detail, make a separate call with ``interval:
      "hour"`` only after the daily call or when the user specifically asks.
    - Use ISO dates such as ``2026-05-20``. For relative requests, calculate the
      dates from the current day provided in the agent instructions.
    - For Indian equities/ETFs with both NSE and BSE rows, prefer
      ``{"symbol": "...", "exchange": "NSE"}`` unless the user chose BSE.

    If the broker returns an access/subscription error such as 403, explain
    that this connected broker account cannot provide historical candles for
    that request. Then use broker_get_quotes and/or broker_get_ohlc for the best
    available current snapshot instead of claiming no market data is available.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            request = HistoricalRequest.model_validate(
                {
                    "instrument": InstrumentRef.model_validate(instrument),
                    "interval": interval,
                    "from_date": from_date,
                    "to_date": to_date,
                }
            )
            payload = request.model_dump(mode="json")
            return _ok(account=_account_summary(acc), data=broker_data.fetch_historical(db, acc, payload))
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_option_chain(
    ctx: RunContextWrapper[BrokerAgentContext],
    symbol: str,
    account_id: str | None = None,
    broker_code: str | None = None,
    exchange: str = "NSE",
    expiry: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Fetch option-chain data where the selected broker supports it.

    Use this for derivative-chain inspection. The payload is broker-native
    because strikes, expiries, and chain metadata vary by broker.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            request = OptionChainRequest(symbol=symbol, exchange=exchange, expiry=expiry)
            return _ok(
                account=_account_summary(acc),
                data=broker_data.fetch_option_chain(db, acc, request.model_dump(exclude_none=True)),
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_greeks(
    ctx: RunContextWrapper[BrokerAgentContext],
    symbol: str,
    account_id: str | None = None,
    broker_code: str | None = None,
    exchange: str = "NSE",
    expiry: str | None = None,
    strike: str | None = None,
    option_type: str | None = None,
    price: float | None = None,
    underlying_price: float | None = None,
    volatility: float | None = None,
    interest_rate: float | None = None,
    days_to_expiry: int | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Fetch or calculate option greeks where the selected broker supports it.

    Provide ``symbol`` and optionally expiry/strike/option_type. For theoretical
    calculations, the price/underlying/volatility/rate/day fields can be passed
    through to the existing broker implementation.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            payload = {
                "symbol": symbol,
                "exchange": exchange,
                "expiry": expiry,
                "strike": strike,
                "option_type": option_type,
                "price": price,
                "underlying_price": underlying_price,
                "volatility": volatility,
                "interest_rate": interest_rate,
                "days_to_expiry": days_to_expiry,
            }
            return _ok(
                account=_account_summary(acc),
                data=broker_data.fetch_greeks(
                    db,
                    acc,
                    {key: value for key, value in payload.items() if value is not None},
                ),
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_portfolio(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
    sections: list[PortfolioSection] | None = None,
    symbol: str | None = None,
    exchange: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Fetch portfolio/account data: orders, trades, positions, holdings, and funds.

    Use ``sections`` to limit work. Supported values are ``orders``, ``trades``,
    ``positions``, ``holdings``, and ``funds``. Symbol/exchange filters apply to
    row-based portfolio payloads such as holdings and positions.

    Agent routing guidance:
    - For "my holdings", call this with ``sections: ["holdings"]``.
    - For "my positions", call this with ``sections: ["positions"]``.
    - For "portfolio overview", use the default sections or explicitly request
      holdings, positions, and funds.
    - For "performance of my holding" or follow-ups like "check its
      performance", fetch holdings first to identify the instrument, quantity,
      average price, and exchange/tradable exchanges, then use
      broker_search_instruments and broker_get_historical/quotes as needed.
    - Do not treat holdings as historical price data. Holdings gives quantity
      and average price; use market-data tools for latest or historical prices.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            client = _client(db, acc)
            selected = sections or ["positions", "holdings", "funds"]
            data: dict[str, Any] = {}
            for section in selected:
                if section == "orders":
                    data[section] = _filter_rows_payload(client.order_book(), symbol=symbol, exchange=exchange)
                elif section == "trades":
                    data[section] = _filter_rows_payload(client.trade_book(), symbol=symbol, exchange=exchange)
                elif section == "positions":
                    data[section] = _filter_rows_payload(client.positions(), symbol=symbol, exchange=exchange)
                elif section == "holdings":
                    data[section] = _filter_rows_payload(client.holdings(), symbol=symbol, exchange=exchange)
                elif section == "funds":
                    data[section] = client.funds()
            return _ok(account=_account_summary(acc), data=data)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_profile(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Fetch broker profile/user information for the selected account.

    Use this when the agent needs broker-side account metadata. The shape is
    broker-native and does not include stored credentials from Ananta Market Stack.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            return _ok(account=_account_summary(acc), profile=_client(db, acc).user_profile())
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_calculate_margin(
    ctx: RunContextWrapper[BrokerAgentContext],
    positions: list[dict[str, Any]],
    account_id: str | None = None,
    broker_code: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Calculate broker margin for a list of hypothetical order legs.

    This is read-only estimation through the broker's margin endpoint where
    supported. Each leg should include symbol, exchange, action, product,
    quantity, pricetype, price, and trigger_price where relevant.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            return _ok(account=_account_summary(acc), margin=_client(db, acc).calculate_margin(positions))
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def broker_get_stream_status(
    ctx: RunContextWrapper[BrokerAgentContext],
    account_id: str | None = None,
    broker_code: str | None = None,
    auto_refresh_session: bool = True,
) -> dict[str, Any]:
    """Inspect broker stream/websocket capability status for an account.

    This mirrors the uniform API's stream status capability. It does not open a
    websocket; use quote polling tools for on-demand agent data until a chat
    integration owns streaming lifecycle.
    """

    def call() -> dict[str, Any]:
        db = _db()
        try:
            acc = _resolve_account(
                db,
                ctx,
                account_id=account_id,
                broker_code=broker_code,
                require_session=True,
                auto_refresh_session=auto_refresh_session,
            )
            return _ok(account=_account_summary(acc), stream=broker_data.stream_status(db, acc))
        finally:
            db.close()

    return _tool_call(call)


BROKER_DATA_TOOLS = [
    broker_list_accounts,
    broker_list_watchlists,
    broker_get_watchlist_symbols,
    broker_create_watchlist,
    broker_rename_watchlist,
    broker_delete_watchlist,
    broker_add_watchlist_symbols,
    broker_replace_watchlist_symbols,
    broker_remove_watchlist_symbols,
    broker_get_session_status,
    broker_verify_connection,
    broker_run_session_maintenance,
    broker_get_data_capabilities,
    broker_search_instruments,
    broker_sync_instruments,
    broker_get_cached_quotes,
    broker_get_quotes,
    broker_get_ohlc,
    broker_get_historical,
    broker_get_option_chain,
    broker_get_greeks,
    broker_get_portfolio,
    broker_get_profile,
    broker_calculate_margin,
    broker_get_stream_status,
]


def find_broker_tool(name: str):
    """Return a broker tool by exact name or shell-style pattern for tests/examples."""

    matches = [
        tool
        for tool in BROKER_DATA_TOOLS
        if getattr(tool, "name", None) == name or fnmatch.fnmatch(getattr(tool, "name", ""), name)
    ]
    return matches[0] if matches else None
