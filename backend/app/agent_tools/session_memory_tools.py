"""Session recall tools — search/expand this chat (Plan 06).

Adaptive Workspace only. Display alias: "Recall from this chat".
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool

from app.agent_harness import session_fts
from app.agent_tools.broker_tools import (
    BrokerAgentContext,
    _db,
    _error,
    _ok,
    _tool_call,
    _user_id,
)


def _is_adaptive(ctx: RunContextWrapper[BrokerAgentContext]) -> bool:
    context = getattr(ctx, "context", None)
    if isinstance(context, BrokerAgentContext):
        return bool(context.adaptive_workspace)
    if isinstance(context, dict):
        return bool(context.get("adaptive_workspace"))
    return bool(getattr(context, "adaptive_workspace", False))


def _session_id(ctx: RunContextWrapper[BrokerAgentContext]) -> str | None:
    context = getattr(ctx, "context", None)
    if isinstance(context, BrokerAgentContext):
        return getattr(context, "session_id", None) or getattr(context, "session_key", None)
    if isinstance(context, dict):
        return context.get("session_id") or context.get("session_key")
    return getattr(context, "session_id", None) or getattr(context, "session_key", None)


@function_tool(strict_mode=False)
def session_search(
    ctx: RunContextWrapper[BrokerAgentContext],
    query: str,
    limit: int = 8,
    window: int = 2,
) -> dict[str, Any]:
    """Recall facts from earlier in THIS chat (not the live web).

    When to use:
    - After compaction / long threads when you need a number, symbol, URL, or decision
      mentioned earlier in this session.
    - When the user asks "what did we say about X?" or references prior turns.

    Do not use:
    - For live quotes, holdings, or fresh news (use broker_* / intel / MCP tools).
    - To invent facts — if search returns nothing, say you cannot find it.

    Example: query="Gabriel margin", limit=5, window=2
    """

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("session_search is only available on Adaptive Workspace", code="wrong_surface")
        session_id = _session_id(ctx)
        if not session_id:
            return _error("session_id missing", code="missing_session")
        db = _db()
        try:
            # Best-effort backfill for older sessions that predate FTS.
            try:
                session_fts.backfill_session_fts(db, session_id, max_events=500)
            except Exception:
                pass
            result = session_fts.search_session(
                db,
                session_id=session_id,
                user_id=_user_id(ctx),
                query=query,
                limit=limit,
                window=window,
            )
            if not result.get("ok"):
                return _error(result.get("message") or "search failed", code=result.get("code") or "search_failed")
            return _ok(**{k: v for k, v in result.items() if k != "ok"})
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def session_expand(
    ctx: RunContextWrapper[BrokerAgentContext],
    run_id: str,
    sequence: int,
    radius: int = 4,
) -> dict[str, Any]:
    """Expand a session_search hit to a wider window of surrounding events.

    When to use:
    - After session_search, when the snippet is too thin for an exact number
      the user will act on.

    Do not use:
    - As a substitute for re-fetching live market data.
    - More than twice per turn; if still truncated, re-fetch the source URL/tool.

    Example: run_id="<id from search>", sequence=12, radius=4
    """

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("session_expand is only available on Adaptive Workspace", code="wrong_surface")
        session_id = _session_id(ctx)
        if not session_id:
            return _error("session_id missing", code="missing_session")
        if not run_id or not str(run_id).strip():
            return _error("run_id is required", code="invalid_request")
        db = _db()
        try:
            result = session_fts.expand_window(
                db,
                session_id=session_id,
                user_id=_user_id(ctx),
                run_id=str(run_id).strip(),
                sequence=int(sequence),
                radius=int(radius),
            )
            if not result.get("ok"):
                return _error(result.get("code") or "expand failed", code=result.get("code") or "expand_failed")
            return _ok(**{k: v for k, v in result.items() if k != "ok"})
        finally:
            db.close()

    return _tool_call(call)


SESSION_MEMORY_TOOLS = [session_search, session_expand]
