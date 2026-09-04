"""Automatic context compaction (Plan 06) — hierarchical + anxiety trigger.

Order (book Ch 2 / Claude Code stack):
1. Keep recent raw turns (keep-recent budget).
2. Drop noise from older tool digests (already lean projections).
3. LLM structured summary of the middle (cheap model), iterative with prior summary.
4. On summariser failure: drop-oldest fallback — never fail the chat run.

Audit stays full. Compaction only affects model-facing ModelItems.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent_harness.model_context import (
    ModelContextBuild,
    _message_chars,
    freeze_truncate,
    prior_turn_messages_for_run,
)
from app.config import get_settings
from app.services import llm_config, llm_gateway
from app.services.llm_usage import LlmTrackingContext
from common.datetime_compat import UTC
from db.models import BrokerChatRun, BrokerChatSession, UserLlmModel

logger = logging.getLogger(__name__)

COMPACTION_EVENT = "compaction"
COMPACTION_FAILED_EVENT = "compaction_failed"
SUMMARY_PREFIX = "[Ananta session summary — compressed; not shown to the user]"

SUMMARISER_SYSTEM = """You compress prior chat turns for a finance Adaptive Workspace agent.
Rules:
- ONLY list facts present in the source text. If unsure, omit.
- Never invent prices, ratios, holdings, URLs, or canvas ids.
- Prefer structured bullets over prose.
- Keep symbols, exact numbers, URLs, canvas/component ids, blockers, and open threads.
- Do not include API keys, tokens, passwords, or TOTP secrets.
- Output markdown with these sections when applicable:
  ## Session so far (compressed)
  Symbols:
  Facts:
  Numbers (cite source turn if possible):
  URLs / sources:
  Canvases / component ids:
  Blockers:
  Open threads:
"""


@dataclass
class CompactionResult:
    messages: list[dict[str, str]]
    stats: ModelContextBuild
    compacted: bool = False
    summary: str = ""
    first_kept_run_id: str | None = None
    model_id: str | None = None
    chars_in: int = 0
    chars_out: int = 0
    failed: bool = False
    failure_reason: str | None = None
    cache_hit: bool = False
    audit: dict[str, Any] = field(default_factory=dict)


def _now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def estimate_tokens(chars: int) -> int:
    return max(0, int(chars) // 4)


def _anxiety_threshold_chars() -> int:
    settings = get_settings()
    window = int(settings.model_input_char_budget)
    reserve = int(getattr(settings, "compact_reserve_chars", 12_000) or 12_000)
    ratio = float(getattr(settings, "compact_anxiety_ratio", 0.80) or 0.80)
    usable = max(4_000, window - reserve)
    return int(usable * ratio)


def _keep_recent_chars() -> int:
    settings = get_settings()
    return int(getattr(settings, "compact_keep_recent_chars", 20_000) or 20_000)


def _summary_max_chars() -> int:
    settings = get_settings()
    return int(getattr(settings, "compact_summary_max_chars", 3_500) or 3_500)


def load_session_summary(db: Session, session_id: str) -> str:
    session = db.get(BrokerChatSession, session_id)
    if session is None:
        return ""
    return (getattr(session, "compaction_summary_text", None) or "").strip()


def persist_session_summary(
    db: Session,
    session_id: str,
    *,
    summary: str,
    first_kept_run_id: str | None,
    model_id: str | None,
    chars_in: int,
    chars_out: int,
) -> None:
    session = db.get(BrokerChatSession, session_id)
    if session is None:
        return
    session.compaction_summary_text = summary
    session.compaction_first_kept_run_id = first_kept_run_id
    session.compaction_model_id = model_id or ""
    session.compaction_chars_in = int(chars_in)
    session.compaction_chars_out = int(chars_out)
    session.compaction_updated_at = _now()
    meta = {
        "first_kept_run_id": first_kept_run_id,
        "model_id": model_id,
        "chars_in": chars_in,
        "chars_out": chars_out,
        "updated_at": session.compaction_updated_at.isoformat() if session.compaction_updated_at else None,
    }
    session.compaction_summary_json = json.dumps(meta, default=str)
    db.add(session)
    db.commit()


def resolve_compaction_model(
    db: Session,
    user_id: str,
    *,
    chat_provider: str,
    chat_model: str,
) -> tuple[str, str]:
    """Return (provider, model_id) for the cheap summariser."""
    settings = get_settings()
    configured = (getattr(settings, "broker_chat_compaction_model", None) or "").strip()
    provider = chat_provider or "openrouter"
    if configured:
        if "/" in configured and configured.split("/", 1)[0] in {"openrouter", "openai", "anthropic", "google"}:
            # allow provider/model form only when first segment is a known provider alias — else treat whole as model
            pass
        return provider, configured
    # Prefer smallest enabled model on same provider.
    try:
        models = llm_config.list_provider_models(db, user_id, provider)  # type: ignore[arg-type]
    except Exception:
        models = []
    enabled = [m for m in models if getattr(m, "is_enabled", True)]
    if enabled:
        # Heuristic: prefer flash/mini/small/haiku naming, else shortest id.
        ranked = sorted(
            enabled,
            key=lambda m: (
                0
                if re.search(r"(flash|mini|small|haiku|lite|nano)", (m.model_id or "").lower())
                else 1,
                len(m.model_id or ""),
            ),
        )
        return provider, ranked[0].model_id
    return provider, chat_model


def _split_keep_recent(groups: list[list[dict[str, str]]]) -> tuple[list[list[dict[str, str]]], list[list[dict[str, str]]]]:
    keep_budget = _keep_recent_chars()
    recent: list[list[dict[str, str]]] = []
    used = 0
    for group in reversed(groups):
        size = _message_chars(group)
        if recent and used + size > keep_budget:
            break
        recent.append(group)
        used += size
    recent.reverse()
    older_count = len(groups) - len(recent)
    older = groups[:older_count] if older_count > 0 else []
    return older, recent


def _strip_older_tool_digests(
    groups: list[list[dict[str, str]]],
) -> list[list[dict[str, str]]]:
    """Anthropic-style context editing: clear stale tool payloads before summarising.

    Keeps user/assistant prose; replaces prior-turn tool digests with a short
    placeholder so the summariser (and later model input after compact) does not
    carry dead tool HTML/JSON. Full audit + FTS remain the source of truth.
    """
    from app.agent_harness.model_context import TOOL_DIGEST_PREFIX

    cleared: list[list[dict[str, str]]] = []
    for group in groups:
        next_group: list[dict[str, str]] = []
        for msg in group:
            content = msg.get("content") or ""
            if msg.get("role") == "user" and content.startswith(TOOL_DIGEST_PREFIX):
                next_group.append(
                    {
                        "role": "user",
                        "content": (
                            "[Prior tool results cleared for compaction — "
                            "use session_search / session_expand if a exact "
                            "number, URL, or payload is needed.]"
                        ),
                    }
                )
            else:
                next_group.append(msg)
        cleared.append(next_group)
    return cleared


def _flatten_groups(groups: list[list[dict[str, str]]]) -> str:
    chunks: list[str] = []
    for group in groups:
        for msg in group:
            role = msg.get("role", "user")
            content = (msg.get("content") or "").strip()
            if content:
                chunks.append(f"{role.upper()}:\n{content}")
    text = "\n\n".join(chunks)
    # Soft cap input to summariser.
    clipped, _ = freeze_truncate(text, 48_000)
    return clipped


def _call_summariser(
    db: Session,
    *,
    user_id: str,
    provider: str,
    model_id: str,
    prior_summary: str,
    source_text: str,
    current_user_text: str,
) -> str:
    user_prompt = (
        f"Current user question (for relevance only; do not answer it):\n{current_user_text[:1_500]}\n\n"
    )
    if prior_summary.strip():
        user_prompt += f"Previous compressed summary (update/merge; do not drop still-true facts):\n{prior_summary[:_summary_max_chars()]}\n\n"
    user_prompt += f"Source turns to compress:\n{source_text}"
    tracking = LlmTrackingContext(
        request_kind="compaction",
        metadata={"workflow_ref": "broker_chat_compaction"},
    )
    response = llm_gateway.generate_text(
        db,
        user_id,
        provider,  # type: ignore[arg-type]
        model=model_id,
        developer_prompt=SUMMARISER_SYSTEM,
        user_text=user_prompt,
        temperature=0.1,
        max_completion_tokens=min(2_000, max(400, _summary_max_chars() // 2)),
        timeout=float(getattr(get_settings(), "compact_timeout_seconds", 45) or 45),
        tracking=tracking,
        extra_body={"usage": {"include": True}} if provider == "openrouter" else None,
    )
    choice = response.choices[0].message.content if response and response.choices else ""
    text = (choice or "").strip()
    if not text:
        # Claude/LiteLLM pattern: freeze the prior summary string rather than
        # failing the run when the summariser returns empty.
        if prior_summary.strip():
            logger.warning("compaction summariser empty; freezing prior summary")
            clipped, _ = freeze_truncate(prior_summary.strip(), _summary_max_chars())
            return clipped
        raise RuntimeError("empty compaction summary")
    clipped, _ = freeze_truncate(text, _summary_max_chars())
    # Guard against obvious secret leaks from the model.
    clipped = re.sub(
        r"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|bearer\s+\S+|totp\s*[:=]\s*\S+)",
        "[redacted]",
        clipped,
    )
    return clipped


def _drop_oldest_to_fit(
    groups: list[list[dict[str, str]]],
    *,
    budget: int,
) -> tuple[list[list[dict[str, str]]], int]:
    kept: list[list[dict[str, str]]] = []
    used = 0
    dropped = 0
    for group in reversed(groups):
        size = _message_chars(group)
        if kept and used + size > budget:
            dropped += 1
            continue
        kept.append(group)
        used += size
    kept.reverse()
    return kept, dropped


def build_compacted_prior_messages(
    db: Session,
    run: BrokerChatRun,
    *,
    current_user_text: str,
    force: bool = False,
    overhead_chars: int = 0,
) -> CompactionResult:
    """Build prior messages with optional compaction.

    Never mutates audit. Never drops the current user message (caller appends it).
    ``overhead_chars`` should include hooks + status bar that will be appended after
    compaction (anxiety trigger must account for them — book Ch 2 / Claude buffer).
    """
    base_messages, stats = prior_turn_messages_for_run(db, run)
    # Rebuild groups from prior_turn_messages — they are flattened; re-group by
    # re-running the internal grouping path via completed runs.
    from app.agent_harness.model_context import _completed_prior_runs, _tool_events, _tool_digest, project_tool_event

    settings = get_settings()
    history_limit = settings.broker_chat_history_turn_limit
    char_limit = int(settings.model_prior_turn_tool_chars)
    prior_runs = _completed_prior_runs(db, run, history_limit)
    turn_groups: list[list[dict[str, str]]] = []
    run_ids: list[str] = []
    for previous in prior_runs:
        group: list[dict[str, str]] = [{"role": "user", "content": previous.message}]
        if previous.response_text:
            group.append({"role": "assistant", "content": previous.response_text})
        events = _tool_events(db, previous.id)
        projections = [project_tool_event(event, char_limit=char_limit) for event in events]
        digest = _tool_digest(projections)
        if digest:
            group.append({"role": "user", "content": digest})
        turn_groups.append(group)
        run_ids.append(previous.id)

    existing_summary = load_session_summary(db, run.session_id)
    projected = (
        _message_chars(base_messages)
        + len(current_user_text or "")
        + max(0, int(overhead_chars or 0))
    )
    threshold = _anxiety_threshold_chars()
    result = CompactionResult(messages=list(base_messages), stats=stats)

    under_threshold = projected <= threshold
    if not force and under_threshold:
        if existing_summary:
            summary_msg = {"role": "user", "content": f"{SUMMARY_PREFIX}\n{existing_summary}"}
            result.messages = [summary_msg, *base_messages]
            result.summary = existing_summary
            result.cache_hit = True
            result.stats.char_count = _message_chars(result.messages)
        return result

    if not turn_groups:
        return result

    older, recent = _split_keep_recent(turn_groups)
    if force and not older and len(turn_groups) > 1:
        # Explicit force (tests / ops): always compress everything except the last turn.
        older, recent = turn_groups[:-1], turn_groups[-1:]
    if not older:
        # Nothing to compress; still under keep-recent.
        if existing_summary:
            result.messages = [
                {"role": "user", "content": f"{SUMMARY_PREFIX}\n{existing_summary}"},
                *[msg for group in recent for msg in group],
            ]
            result.summary = existing_summary
            result.cache_hit = True
            result.stats.char_count = _message_chars(result.messages)
        return result

    source = _flatten_groups(_strip_older_tool_digests(older))
    chars_in = len(source) + len(existing_summary)
    provider, model_id = resolve_compaction_model(
        db,
        run.user_id,
        chat_provider=run.provider or "openrouter",
        chat_model=run.model_id or "",
    )
    try:
        summary = _call_summariser(
            db,
            user_id=run.user_id,
            provider=provider,
            model_id=model_id,
            prior_summary=existing_summary,
            source_text=source,
            current_user_text=current_user_text,
        )
        first_kept = run_ids[len(older)] if len(run_ids) > len(older) else (run_ids[-1] if run_ids else None)
        persist_session_summary(
            db,
            run.session_id,
            summary=summary,
            first_kept_run_id=first_kept,
            model_id=model_id,
            chars_in=chars_in,
            chars_out=len(summary),
        )
        messages = [
            {"role": "user", "content": f"{SUMMARY_PREFIX}\n{summary}"},
            *[msg for group in recent for msg in group],
        ]
        result.messages = messages
        result.compacted = True
        result.summary = summary
        result.first_kept_run_id = first_kept
        result.model_id = model_id
        result.chars_in = chars_in
        result.chars_out = len(summary)
        result.stats.dropped_oldest_turns = len(older)
        result.stats.char_count = _message_chars(messages)
        result.audit = {
            "summary": summary,
            "first_kept_run_id": first_kept,
            "model_id": model_id,
            "chars_in": chars_in,
            "chars_out": len(summary),
            "older_turns": len(older),
            "recent_turns": len(recent),
            "anxiety_threshold_chars": threshold,
            "projected_chars": projected,
            "overhead_chars": overhead_chars,
        }
        return result
    except Exception as exc:
        logger.warning("compaction failed, falling back to drop-oldest: %s", exc)
        # Prefer frozen summary + recent over bare drop when we already have one.
        if existing_summary.strip():
            messages = [
                {"role": "user", "content": f"{SUMMARY_PREFIX}\n{existing_summary}"},
                *[msg for group in recent for msg in group],
            ]
            result.messages = messages
            result.failed = True
            result.failure_reason = f"{type(exc).__name__}: {exc}"[:400]
            result.summary = existing_summary
            result.cache_hit = True
            result.stats.char_count = _message_chars(messages)
            result.audit = {
                "error": result.failure_reason,
                "fallback": "frozen_summary_plus_recent",
                "overhead_chars": overhead_chars,
            }
            return result
        budget = max(
            4_000,
            int(settings.model_input_char_budget)
            - int(getattr(settings, "compact_reserve_chars", 12_000) or 12_000),
        )
        kept, dropped = _drop_oldest_to_fit(turn_groups, budget=budget)
        messages = [msg for group in kept for msg in group]
        result.messages = messages
        result.failed = True
        result.failure_reason = f"{type(exc).__name__}: {exc}"[:400]
        result.stats.dropped_oldest_turns = dropped
        result.stats.char_count = _message_chars(messages)
        result.audit = {
            "error": result.failure_reason,
            "fallback": "drop_oldest",
            "dropped_turns": dropped,
            "overhead_chars": overhead_chars,
        }
        return result
