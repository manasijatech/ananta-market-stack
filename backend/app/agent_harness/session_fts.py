"""SQLite FTS5 session recall (Plan 06) — this-chat search only.

Indexes user/assistant text and lean tool projections, never raw HTML or secrets.
Fail-closed: if FTS is unavailable, tools return a typed empty/error result.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agent_harness.model_context import strip_secrets
from db.models import BrokerChatEvent, BrokerChatRun

logger = logging.getLogger(__name__)

FTS_TABLE = "broker_chat_event_fts"
INDEXABLE_EVENT_TYPES = frozenset(
    {
        "message_output",
        "tool_call_completed",
        "run_completed",
        "run_started",
    }
)
SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer\s+\S+|totp|password|pin)\s*[:=]?\s*\S+"
)
MAX_BODY_CHARS = 4_000
DEFAULT_SEARCH_LIMIT = 8
DEFAULT_WINDOW = 2
MAX_EXPAND_RADIUS = 8
MAX_WINDOW_CHARS = 6_000

_SCHEMA_READY_BINDS: set[int] = set()


def ensure_fts_schema(db: Session) -> bool:
    """Create FTS5 virtual table if missing. Returns False when SQLite/FTS unavailable."""
    bind = db.get_bind()
    dialect = getattr(bind.dialect, "name", "")
    if dialect != "sqlite":
        logger.warning("session FTS skipped: dialect=%s (sqlite-only in v1)", dialect)
        return False
    bind_id = id(bind)
    if bind_id in _SCHEMA_READY_BINDS:
        return True
    try:
        db.execute(
            text(
                f"""
                CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5(
                    session_id UNINDEXED,
                    run_id UNINDEXED,
                    sequence UNINDEXED,
                    event_type UNINDEXED,
                    body,
                    tokenize = 'porter unicode61'
                )
                """
            )
        )
        db.commit()
        _SCHEMA_READY_BINDS.add(bind_id)
        return True
    except Exception as exc:
        logger.warning("session FTS schema failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return False


def reset_fts_schema_cache_for_tests() -> None:
    _SCHEMA_READY_BINDS.clear()


def _sanitize_body(value: str) -> str:
    cleaned = SECRET_RE.sub("[redacted]", value or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_BODY_CHARS]


def _extract_index_body(event: BrokerChatEvent, run: BrokerChatRun | None = None) -> str:
    parts: list[str] = []
    if event.event_type in {"run_started", "run_completed"} and run is not None:
        if run.message:
            parts.append(f"user: {run.message}")
        if event.event_type == "run_completed" and run.response_text:
            parts.append(f"assistant: {run.response_text}")
    try:
        public = json.loads(event.public_payload_json or "{}")
    except json.JSONDecodeError:
        public = {}
    try:
        full = json.loads(event.full_payload_json or "{}")
    except json.JSONDecodeError:
        full = {}
    if event.event_type == "message_output":
        content = public.get("content") or full.get("content") or public.get("text") or ""
        if content:
            parts.append(str(content))
    elif event.event_type == "tool_call_completed":
        name = public.get("tool_name") or full.get("tool_name") or "tool"
        # Prefer lean projection fields, not raw HTML dumps.
        projection = full.get("projection") or public.get("projection")
        if isinstance(projection, dict):
            parts.append(f"{name}: {json.dumps(strip_secrets(projection), default=str)[:1500]}")
        else:
            title = public.get("display_name") or public.get("title") or name
            snippet_keys = ("symbols", "symbol", "url", "urls", "summary", "ok", "item_count", "count")
            lean: dict[str, Any] = {"tool": name, "title": title}
            src = full.get("output") if isinstance(full.get("output"), dict) else full
            if isinstance(src, dict):
                for key in snippet_keys:
                    if key in src and src[key] is not None:
                        lean[key] = src[key]
            parts.append(json.dumps(strip_secrets(lean), default=str)[:1500])
    return _sanitize_body("\n".join(parts))


def index_event(db: Session, event: BrokerChatEvent, run: BrokerChatRun | None = None) -> None:
    if event.event_type not in INDEXABLE_EVENT_TYPES:
        return
    if not ensure_fts_schema(db):
        return
    body = _extract_index_body(event, run)
    if not body:
        return
    try:
        # Replace any prior row for same (run_id, sequence)
        db.execute(
            text(f"DELETE FROM {FTS_TABLE} WHERE run_id = :run_id AND sequence = :sequence"),
            {"run_id": event.run_id, "sequence": int(event.sequence)},
        )
        db.execute(
            text(
                f"""
                INSERT INTO {FTS_TABLE}(session_id, run_id, sequence, event_type, body)
                VALUES (:session_id, :run_id, :sequence, :event_type, :body)
                """
            ),
            {
                "session_id": event.session_id,
                "run_id": event.run_id,
                "sequence": int(event.sequence),
                "event_type": event.event_type,
                "body": body,
            },
        )
        db.commit()
    except Exception as exc:
        logger.warning("FTS index failed for %s#%s: %s", event.run_id, event.sequence, exc)
        try:
            db.rollback()
        except Exception:
            pass


def _fts_query(raw: str) -> str:
    """Build a safe FTS5 MATCH query from free text (phrase + OR tokens)."""
    tokens = re.findall(r"[A-Za-z0-9_./%-]{2,}", raw or "")
    cleaned: list[str] = []
    for token in tokens[:24]:
        safe = token.replace('"', "").replace("'", "")
        if safe:
            cleaned.append(f'"{safe}"')
    if not cleaned:
        return '""'
    # Prefer phrase match when multi-token; also OR individual tokens.
    if len(cleaned) >= 2:
        phrase = " ".join(t.strip('"') for t in cleaned[:8])
        return f'"{phrase}" OR ' + " OR ".join(cleaned)
    return cleaned[0]


def search_session(
    db: Session,
    *,
    session_id: str,
    user_id: str,
    query: str,
    limit: int = DEFAULT_SEARCH_LIMIT,
    window: int = DEFAULT_WINDOW,
) -> dict[str, Any]:
    if not ensure_fts_schema(db):
        return {"ok": False, "code": "fts_unavailable", "hits": [], "message": "Session search is unavailable."}
    q = (query or "").strip()
    if not q:
        return {"ok": False, "code": "invalid_request", "hits": [], "message": "query is required"}
    safe_limit = max(1, min(int(limit), 20))
    safe_window = max(0, min(int(window), MAX_EXPAND_RADIUS))
    match = _fts_query(q)
    try:
        rows = db.execute(
            text(
                f"""
                SELECT run_id, sequence, event_type, snippet({FTS_TABLE}, 4, '«', '»', '…', 24) AS snip, bm25({FTS_TABLE}) AS rank
                FROM {FTS_TABLE}
                WHERE {FTS_TABLE} MATCH :match AND session_id = :session_id
                ORDER BY rank
                LIMIT :limit
                """
            ),
            {"match": match, "session_id": session_id, "limit": safe_limit},
        ).fetchall()
    except Exception as exc:
        logger.warning("FTS search failed: %s", exc)
        return {"ok": False, "code": "fts_query_failed", "hits": [], "message": str(exc)[:200]}

    hits: list[dict[str, Any]] = []
    for row in rows:
        run_id, sequence, event_type, snip, rank = row
        # Ownership check via run
        run = db.get(BrokerChatRun, run_id)
        if run is None or run.user_id != user_id or run.session_id != session_id:
            continue
        window_payload = expand_window(
            db,
            session_id=session_id,
            user_id=user_id,
            run_id=run_id,
            sequence=int(sequence),
            radius=safe_window,
        )
        hits.append(
            {
                "run_id": run_id,
                "sequence": int(sequence),
                "event_type": event_type,
                "snippet": snip,
                "rank": float(rank) if rank is not None else None,
                "window": window_payload.get("items") or [],
                "window_truncated": bool(window_payload.get("truncated")),
            }
        )
    return {
        "ok": True,
        "query": q,
        "hit_count": len(hits),
        "hits": hits,
        "guidance": (
            "These are recall snippets from this chat only. "
            "For exact numbers the user will act on, call session_expand or re-fetch the source."
        ),
    }


def expand_window(
    db: Session,
    *,
    session_id: str,
    user_id: str,
    run_id: str,
    sequence: int,
    radius: int = 3,
) -> dict[str, Any]:
    run = db.get(BrokerChatRun, run_id)
    if run is None or run.user_id != user_id or run.session_id != session_id:
        return {"ok": False, "code": "not_found", "items": [], "truncated": False}
    safe_radius = max(0, min(int(radius), MAX_EXPAND_RADIUS))
    lo = max(1, int(sequence) - safe_radius)
    hi = int(sequence) + safe_radius
    events = (
        db.query(BrokerChatEvent)
        .filter(
            BrokerChatEvent.run_id == run_id,
            BrokerChatEvent.sequence >= lo,
            BrokerChatEvent.sequence <= hi,
        )
        .order_by(BrokerChatEvent.sequence.asc())
        .all()
    )
    items: list[dict[str, Any]] = []
    used = 0
    truncated = False
    for event in events:
        body = _extract_index_body(event, run if event.event_type.startswith("run_") else run)
        if not body:
            # Still include a thin marker for tool structure.
            body = f"[{event.event_type}]"
        if used + len(body) > MAX_WINDOW_CHARS:
            truncated = True
            break
        items.append(
            {
                "run_id": run_id,
                "sequence": event.sequence,
                "event_type": event.event_type,
                "body": body,
            }
        )
        used += len(body)
    return {
        "ok": True,
        "run_id": run_id,
        "center_sequence": int(sequence),
        "radius": safe_radius,
        "items": items,
        "truncated": truncated,
        "char_count": used,
    }


def backfill_session_fts(db: Session, session_id: str, *, max_events: int = 2_000) -> int:
    if not ensure_fts_schema(db):
        return 0
    events = (
        db.query(BrokerChatEvent)
        .filter(BrokerChatEvent.session_id == session_id)
        .order_by(BrokerChatEvent.created_at.asc())
        .limit(max_events)
        .all()
    )
    count = 0
    run_cache: dict[str, BrokerChatRun | None] = {}
    for event in events:
        if event.run_id not in run_cache:
            run_cache[event.run_id] = db.get(BrokerChatRun, event.run_id)
        index_event(db, event, run_cache[event.run_id])
        count += 1
    return count
