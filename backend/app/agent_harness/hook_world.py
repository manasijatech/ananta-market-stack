"""World-snapshot helpers for Plan 05 context hooks (fail-closed, no secrets)."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent_harness.model_context import strip_secrets
from app.config import get_settings
from db.models import AdaptiveWorkspacePreference, BrokerAccount

logger = logging.getLogger(__name__)

HOLDINGS_TOP_N = 12
WATCHLIST_PREVIEW_SYMBOLS = 8
WATCHLIST_MAX_LISTS = 8
INTEL_HEADLINE_LIMIT = 5
SECRET_KEYS = {
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "api_secret",
    "password",
    "pin",
    "totp",
    "authorization",
    "cookie",
    "secret",
    "cipher",
}


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _as_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _redis() -> Any | None:
    try:
        from app.services.broker_chat_queue import redis_connection

        return redis_connection()
    except Exception:
        return None


def cache_get_json(key: str) -> dict[str, Any] | None:
    client = _redis()
    if client is None:
        return None
    try:
        raw = client.get(key)
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def cache_set_json(key: str, value: dict[str, Any], ttl_seconds: int) -> None:
    client = _redis()
    if client is None:
        return
    try:
        client.setex(key, max(1, int(ttl_seconds)), json.dumps(value, default=str))
    except Exception:
        return


def get_preference_value(db: Session, user_id: str, key: str, default: Any = None) -> Any:
    row = db.scalar(
        select(AdaptiveWorkspacePreference).where(
            AdaptiveWorkspacePreference.user_id == user_id,
            AdaptiveWorkspacePreference.pref_key == key,
        )
    )
    if row is None:
        return default
    try:
        return json.loads(row.value_json)
    except Exception:
        return default


def resolve_inject_holdings(db: Session, user_id: str, metadata: dict[str, Any] | None = None) -> bool:
    meta = metadata if isinstance(metadata, dict) else {}
    if "inject_holdings" in meta:
        return bool(meta.get("inject_holdings"))
    value = get_preference_value(db, user_id, "inject_holdings", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "off"}
    return bool(value if value is not None else True)


def list_user_broker_accounts(db: Session, user_id: str) -> list[BrokerAccount]:
    return list(
        db.scalars(
            select(BrokerAccount)
            .where(BrokerAccount.user_id == user_id, BrokerAccount.is_active.is_(True))
            .order_by(BrokerAccount.label.asc(), BrokerAccount.id.asc())
        ).all()
    )


def broker_health_snapshot(db: Session, user_id: str) -> dict[str, Any] | None:
    accounts = list_user_broker_accounts(db, user_id)
    if not accounts:
        return None
    rows: list[dict[str, Any]] = []
    for acc in accounts[:12]:
        status = (acc.session_status or "unknown").strip() or "unknown"
        action_required = status in {"pending", "action_required", "automation_ready"} or bool(acc.last_error)
        rows.append(
            {
                "account_id": acc.id,
                "broker_code": acc.broker_code,
                "label": acc.label,
                "session_status": status,
                "action_required": action_required,
                "session_expires_at": acc.session_expires_at.isoformat() + "Z"
                if acc.session_expires_at and acc.session_expires_at.tzinfo is None
                else (acc.session_expires_at.isoformat() if acc.session_expires_at else None),
                "last_error": (acc.last_error or "")[:160] or None,
            }
        )
    return strip_secrets({"as_of": _now_iso(), "accounts": rows, "count": len(rows)})


def watchlists_snapshot(db: Session, user_id: str) -> dict[str, Any] | None:
    from app.services import watchlists as watchlist_svc

    try:
        lists = watchlist_svc.list_watchlists(db, user_id)
    except Exception as exc:
        logger.warning("watchlists hook list failed: %s", exc)
        return None
    if not lists:
        return None
    rows: list[dict[str, Any]] = []
    for item in lists[:WATCHLIST_MAX_LISTS]:
        symbols = [str(sym).upper() for sym in (item.symbols or []) if str(sym).strip()]
        rows.append(
            {
                "id": item.id,
                "name": item.name,
                "kind": item.kind,
                "symbol_count": len(symbols),
                "symbols": symbols[:WATCHLIST_PREVIEW_SYMBOLS],
                "symbols_truncated": len(symbols) > WATCHLIST_PREVIEW_SYMBOLS,
            }
        )
    return strip_secrets(
        {
            "as_of": _now_iso(),
            "lists": rows,
            "count": len(lists),
            "lists_truncated": len(lists) > WATCHLIST_MAX_LISTS,
        }
    )


def _iter_holding_dicts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "payload", "holdings", "holding", "positions", "net"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            for nested_key in ("holdings", "holding", "positions", "net", "data"):
                nested = value.get(nested_key)
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
    return []


def _holding_symbol(row: dict[str, Any]) -> str:
    for key in ("tradingsymbol", "trading_symbol", "symbol", "ticker", "securityId", "scrip_code"):
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip().upper()
        if text:
            return text[:32]
    return ""


def _holding_value(row: dict[str, Any]) -> float | None:
    for key in (
        "market_value",
        "marketValue",
        "current_value",
        "currentValue",
        "value",
        "amount",
        "holding_value",
        "total_value",
        "invested_value",
    ):
        parsed = _as_float(row.get(key))
        if parsed is not None:
            return parsed
    qty = _as_float(row.get("quantity") or row.get("qty") or row.get("net_qty") or row.get("netQty"))
    ltp = _as_float(row.get("ltp") or row.get("last_price") or row.get("lastPrice") or row.get("price"))
    if qty is not None and ltp is not None:
        return qty * ltp
    return None


def _compact_holdings_rows(payload: Any, *, top_n: int = HOLDINGS_TOP_N) -> tuple[list[dict[str, Any]], bool]:
    rows = _iter_holding_dicts(payload)
    scored: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        symbol = _holding_symbol(row)
        if not symbol:
            continue
        value = _holding_value(row)
        scored.append((float(value or 0.0), {"symbol": symbol, "value": value}))
    scored.sort(key=lambda item: item[0], reverse=True)
    total = sum(max(0.0, item[0]) for item in scored) or 0.0
    out: list[dict[str, Any]] = []
    for value, entry in scored[:top_n]:
        weight = round((value / total) * 100.0, 2) if total > 0 and value > 0 else None
        item = {"symbol": entry["symbol"]}
        if entry["value"] is not None:
            item["value"] = round(float(entry["value"]), 2)
        if weight is not None:
            item["weight_pct"] = weight
        out.append(item)
    return out, len(scored) > top_n


def _pick_default_account(db: Session, user_id: str, preferred_id: str | None) -> BrokerAccount | None:
    accounts = list_user_broker_accounts(db, user_id)
    if not accounts:
        return None
    if preferred_id:
        for acc in accounts:
            if acc.id == preferred_id:
                return acc
    try:
        from app.services import broker_data_preferences

        cfg = broker_data_preferences.get_broker_data_default_config(db, user_id)
        effective = getattr(cfg, "effective_default_account_id", None) or (
            cfg.get("effective_default_account_id") if isinstance(cfg, dict) else None
        )
        if effective:
            for acc in accounts:
                if acc.id == effective:
                    return acc
    except Exception:
        pass
    return accounts[0]


def holdings_snapshot(
    db: Session,
    user_id: str,
    *,
    preferred_account_id: str | None = None,
) -> dict[str, Any] | None:
    """Live holdings with Redis TTL cache. Omits numbers when session needs action."""
    settings = get_settings()
    ttl = int(getattr(settings, "hooks_holdings_cache_ttl_seconds", 45) or 45)
    acc = _pick_default_account(db, user_id, preferred_account_id)
    if acc is None:
        return None

    status = (acc.session_status or "").strip()
    action_required = status in {"pending", "action_required", "automation_ready"} or bool(acc.last_error)
    if action_required:
        return strip_secrets(
            {
                "as_of": _now_iso(),
                "account_id": acc.id,
                "broker_code": acc.broker_code,
                "label": acc.label,
                "action_required": True,
                "session_status": status or "unknown",
                "holdings": [],
                "note": "Session needs action; holdings numbers omitted. Use broker tools after refresh.",
            }
        )

    cache_key = f"hooks:holdings:{user_id}:{acc.id}"
    cached = cache_get_json(cache_key)
    if cached is not None:
        cached["from_cache"] = True
        return strip_secrets(cached)

    try:
        from app.services import broker_data
        from app.services import broker_sessions

        session = broker_sessions.get_broker_session_status(acc)
        if not bool(getattr(session, "session_active", False)):
            return strip_secrets(
                {
                    "as_of": _now_iso(),
                    "account_id": acc.id,
                    "broker_code": acc.broker_code,
                    "label": acc.label,
                    "action_required": True,
                    "session_status": status or "inactive",
                    "holdings": [],
                    "note": "Broker session inactive; holdings omitted.",
                }
            )
        payload = broker_data.fetch_holdings(db, acc)
        holdings, truncated = _compact_holdings_rows(payload)
        snapshot = {
            "as_of": _now_iso(),
            "account_id": acc.id,
            "broker_code": acc.broker_code,
            "label": acc.label,
            "action_required": False,
            "session_status": status or "active",
            "holdings": holdings,
            "holdings_count": len(_iter_holding_dicts(payload)),
            "truncated": truncated,
            "from_cache": False,
        }
        cache_set_json(cache_key, snapshot, ttl)
        return strip_secrets(snapshot)
    except Exception as exc:
        logger.warning("holdings hook fetch failed: %s", exc)
        return strip_secrets(
            {
                "as_of": _now_iso(),
                "account_id": acc.id,
                "broker_code": acc.broker_code,
                "label": acc.label,
                "action_required": False,
                "error": f"{type(exc).__name__}",
                "holdings": [],
                "note": "Holdings fetch failed; use broker_get_portfolio when needed.",
            }
        )


def intel_pulse_snapshot(
    db: Session,
    user_id: str,
    symbols: list[str],
    *,
    mcp_enabled: bool = False,
) -> dict[str, Any] | None:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        for part in str(raw).replace(",", " ").split():
            symbol = part.strip().upper()
            if symbol and symbol not in seen and len(symbol) <= 32:
                seen.add(symbol)
                cleaned.append(symbol)
    cleaned = cleaned[:12]
    if not cleaned:
        return None

    digest = hashlib.sha1("|".join(cleaned).encode("utf-8")).hexdigest()[:12]
    cache_key = f"hooks:intel:{user_id}:{digest}"
    cached = cache_get_json(cache_key)
    if cached is not None:
        cached["from_cache"] = True
        return strip_secrets(cached)

    try:
        from app.services.alpha_feed_cache import list_cached_feed_items

        # Cache-only / soft refresh — hooks must stay cheap.
        payload = list_cached_feed_items(
            db,
            user_id,
            "news",
            cleaned,
            page=1,
            limit=INTEL_HEADLINE_LIMIT,
            force_refresh=False,
        )
        items_in = payload.get("data") or []
        headlines: list[dict[str, Any]] = []
        for item in items_in[:INTEL_HEADLINE_LIMIT]:
            if not isinstance(item, dict):
                continue
            title = item.get("specific_title") or item.get("title") or item.get("headline")
            if not title:
                continue
            entry = {
                "symbol": item.get("symbol"),
                "title": str(title)[:180],
            }
            item_id = item.get("id") or item.get("event_id") or item.get("hash")
            if item_id:
                entry["id"] = str(item_id)[:64]
            published = item.get("published_at") or item.get("publishedAt") or item.get("date")
            if published:
                entry["published_at"] = str(published)[:40]
            headlines.append(entry)
        if not headlines:
            return None
        snapshot = {
            "as_of": _now_iso(),
            "symbols": cleaned,
            "headlines": headlines,
            "mcp_connected": bool(mcp_enabled),
            "note": (
                "MCP is connected — prefer MCP news tools for refresh; these are Ananta cache hints."
                if mcp_enabled
                else "Cache hints only; call intel_get_feed(force_refresh=true) when the user needs fresh news."
            ),
            "from_cache": bool(payload.get("from_cache")),
        }
        cache_set_json(cache_key, snapshot, 60)
        return strip_secrets(snapshot)
    except Exception as exc:
        logger.warning("intel pulse hook failed: %s", exc)
        return None
