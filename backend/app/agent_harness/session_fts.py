"""SQLite FTS5 session recall (Plan 06) — this-chat search only.

Indexes user/assistant text and lean tool projections, never raw HTML or secrets.
Optional hybrid: FTS BM25 + local MiniLM embeddings fused with RRF.
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
# Model-facing expand windows: evidence only — never harness chrome.
WINDOW_EVIDENCE_TYPES = frozenset(
    {
        "message_output",
        "tool_call_completed",
        "run_started",
        "run_completed",
    }
)
# Drop from FTS OR bag — they cause lexical false positives ("Open page").
FTS_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "to",
        "for",
        "in",
        "on",
        "at",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "this",
        "that",
        "these",
        "those",
        "it",
        "its",
        "as",
        "by",
        "from",
        "with",
        "about",
        "into",
        "over",
        "after",
        "before",
        "between",
        "what",
        "which",
        "who",
        "whom",
        "whose",
        "when",
        "where",
        "why",
        "how",
        "do",
        "does",
        "did",
        "can",
        "could",
        "should",
        "would",
        "will",
        "just",
        "please",
        "any",
        "some",
        "such",
        "than",
        "then",
        "also",
        "very",
        "more",
        "most",
        "one",
        "our",
        "your",
        "their",
        "my",
        "we",
        "you",
        "they",
        "me",
        "us",
        "them",
        "if",
        "not",
        "no",
        "yes",
        "so",
        "too",
        "only",
        "same",
        "other",
        "open",
        "question",
        "questions",
        "unanswered",
        "earlier",
        "evidence",
        "find",
        "finds",
        "found",
        "search",
        "session",
        "chat",
        "thread",
        "recall",
        "whether",
        "left",
        "name",
        "tell",
        "remind",
        "use",
        "used",
        "using",
        "call",
        "precise",
        "exactly",
        "follow",
        "follow-up",
        "followup",
    }
)
SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer\s+\S+|totp|password|pin)\s*[:=]?\s*\S+"
)
MAX_BODY_CHARS = 4_000
DEFAULT_SEARCH_LIMIT = 5
DEFAULT_WINDOW = 0  # lean cards by default; expand on demand
MAX_EXPAND_RADIUS = 8
MAX_WINDOW_CHARS = 6_000
# Over-fetch FTS before demotion / hybrid merge.
FTS_CANDIDATE_MULTIPLIER = 3

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
            # Prefer nested summary/error strings when present.
            if isinstance(src, dict):
                for key in ("error", "message", "detail"):
                    if isinstance(src.get(key), str) and src[key].strip():
                        lean[key] = src[key][:240]
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
        return

    # Best-effort hybrid embedding index (no-op when flag/model unavailable).
    try:
        from app.agent_harness import session_embeddings

        session_embeddings.index_embedding(
            db,
            session_id=event.session_id,
            run_id=event.run_id,
            sequence=int(event.sequence),
            event_type=event.event_type,
            body=body,
        )
    except Exception:
        pass


def _fts_tokens(raw: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9_./%-]{2,}", raw or "")
    cleaned: list[str] = []
    for token in tokens[:32]:
        safe = token.replace('"', "").replace("'", "")
        if not safe:
            continue
        if safe.lower() in FTS_STOPWORDS:
            continue
        cleaned.append(safe)
    return cleaned


def _fts_query(raw: str) -> str:
    """Build a safe FTS5 MATCH query from free text (phrase + OR content tokens)."""
    cleaned = _fts_tokens(raw)
    if not cleaned:
        # Fall back to original tokens if everything was stopwords.
        tokens = re.findall(r"[A-Za-z0-9_./%-]{2,}", raw or "")
        cleaned = [t.replace('"', "").replace("'", "") for t in tokens[:8] if t]
    if not cleaned:
        return '""'
    quoted = [f'"{t}"' for t in cleaned]
    if len(quoted) >= 2:
        phrase = " ".join(cleaned[:8])
        return f'"{phrase}" OR ' + " OR ".join(quoted)
    return quoted[0]


def _snippet_for_hit(db: Session, run: BrokerChatRun, event_type: str, sequence: int, fallback: str = "") -> str:
    if fallback:
        return fallback
    event = (
        db.query(BrokerChatEvent)
        .filter(BrokerChatEvent.run_id == run.id, BrokerChatEvent.sequence == int(sequence))
        .first()
    )
    if event is None:
        return ""
    return _extract_index_body(event, run)[:280]


def search_session(
    db: Session,
    *,
    session_id: str,
    user_id: str,
    query: str,
    limit: int = DEFAULT_SEARCH_LIMIT,
    window: int = DEFAULT_WINDOW,
    exclude_run_id: str | None = None,
) -> dict[str, Any]:
    if not ensure_fts_schema(db):
        return {"ok": False, "code": "fts_unavailable", "hits": [], "message": "Session search is unavailable."}
    q = (query or "").strip()
    if not q:
        return {"ok": False, "code": "invalid_request", "hits": [], "message": "query is required"}
    safe_limit = max(1, min(int(limit), 20))
    safe_window = max(0, min(int(window), MAX_EXPAND_RADIUS))
    candidate_limit = min(40, max(safe_limit * FTS_CANDIDATE_MULTIPLIER, safe_limit + 4))
    match = _fts_query(q)

    fts_hits: list[dict[str, Any]] = []
    try:
        rows = db.execute(
            text(
                f"""
                SELECT run_id, sequence, event_type,
                       snippet({FTS_TABLE}, 4, '«', '»', '…', 24) AS snip,
                       bm25({FTS_TABLE}) AS rank
                FROM {FTS_TABLE}
                WHERE {FTS_TABLE} MATCH :match AND session_id = :session_id
                ORDER BY rank
                LIMIT :limit
                """
            ),
            {"match": match, "session_id": session_id, "limit": candidate_limit},
        ).fetchall()
    except Exception as exc:
        logger.warning("FTS search failed: %s", exc)
        return {"ok": False, "code": "fts_query_failed", "hits": [], "message": str(exc)[:200]}

    for row in rows:
        run_id, sequence, event_type, snip, rank = row
        if exclude_run_id and run_id == exclude_run_id:
            continue
        run = db.get(BrokerChatRun, run_id)
        if run is None or run.user_id != user_id or run.session_id != session_id:
            continue
        # Prefer assistant/tool evidence over bare run_started when ranks are close —
        # still keep run_started if it's the only hit.
        fts_hits.append(
            {
                "run_id": run_id,
                "sequence": int(sequence),
                "event_type": event_type,
                "snippet": snip,
                "rank": float(rank) if rank is not None else None,
            }
        )

    # Soft prefer evidence event types in FTS ordering (stable within BM25 order).
    def _fts_sort_key(hit: dict[str, Any]) -> tuple[int, float]:
        et = hit.get("event_type") or ""
        prefer = 0 if et in {"message_output", "tool_call_completed", "run_completed"} else 1
        rank = hit.get("rank")
        return (prefer, float(rank) if rank is not None else 0.0)

    fts_hits.sort(key=_fts_sort_key)

    retrieval_mode = "fts"
    fused = list(fts_hits)
    emb_hits: list[dict[str, Any]] = []
    try:
        from app.agent_harness import session_embeddings

        if session_embeddings.embeddings_enabled():
            emb_hits = session_embeddings.search_embeddings(
                db,
                session_id=session_id,
                query=q,
                limit=candidate_limit,
                exclude_run_id=exclude_run_id,
            )
            if emb_hits:
                fused = session_embeddings.rrf_fuse(fts_hits, emb_hits, limit=candidate_limit)
                retrieval_mode = "hybrid_rrf"
    except Exception as exc:
        logger.warning("hybrid fusion skipped: %s", exc)

    hits: list[dict[str, Any]] = []
    for hit in fused:
        if len(hits) >= safe_limit:
            break
        run_id = str(hit["run_id"])
        sequence = int(hit["sequence"])
        if exclude_run_id and run_id == exclude_run_id:
            continue
        run = db.get(BrokerChatRun, run_id)
        if run is None or run.user_id != user_id or run.session_id != session_id:
            continue
        event_type = hit.get("event_type") or ""
        snip = hit.get("snippet") or _snippet_for_hit(db, run, event_type, sequence)
        card: dict[str, Any] = {
            "run_id": run_id,
            "sequence": sequence,
            "event_type": event_type,
            "snippet": snip,
            "rank": hit.get("rank"),
            "rrf_score": hit.get("rrf_score"),
            "sources": hit.get("sources") or ["fts"],
        }
        if safe_window > 0:
            window_payload = expand_window(
                db,
                session_id=session_id,
                user_id=user_id,
                run_id=run_id,
                sequence=sequence,
                radius=safe_window,
            )
            card["window"] = window_payload.get("items") or []
            card["window_truncated"] = bool(window_payload.get("truncated"))
        else:
            card["window"] = []
            card["window_truncated"] = False
        hits.append(card)

    return {
        "ok": True,
        "query": q,
        "hit_count": len(hits),
        "hits": hits,
        "retrieval_mode": retrieval_mode,
        "exclude_run_id": exclude_run_id,
        "guidance": (
            "Lean recall snippets from THIS chat only. "
            "Call session_expand(run_id, sequence) for surrounding evidence when a number "
            "must be exact; otherwise re-fetch the live source."
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

    # Walk by sequence among evidence types only (skip harness chrome entirely).
    evidence_events = (
        db.query(BrokerChatEvent)
        .filter(
            BrokerChatEvent.run_id == run_id,
            BrokerChatEvent.event_type.in_(tuple(WINDOW_EVIDENCE_TYPES)),
        )
        .order_by(BrokerChatEvent.sequence.asc())
        .all()
    )
    if not evidence_events:
        return {
            "ok": True,
            "run_id": run_id,
            "center_sequence": int(sequence),
            "radius": safe_radius,
            "items": [],
            "truncated": False,
            "char_count": 0,
        }

    # Find nearest evidence event to the requested sequence.
    center_idx = 0
    best_dist = abs(evidence_events[0].sequence - int(sequence))
    for idx, event in enumerate(evidence_events):
        dist = abs(event.sequence - int(sequence))
        if dist < best_dist:
            best_dist = dist
            center_idx = idx

    lo = max(0, center_idx - safe_radius)
    hi = min(len(evidence_events) - 1, center_idx + safe_radius)
    items: list[dict[str, Any]] = []
    used = 0
    truncated = False
    for event in evidence_events[lo : hi + 1]:
        body = _extract_index_body(event, run)
        if not body:
            continue  # never emit [event_type] placeholders
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
        "evidence_only": True,
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
