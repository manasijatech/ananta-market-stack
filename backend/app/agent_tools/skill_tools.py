"""Agent Skills tools — distinct from workspace_list_skills (desk authoring)."""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool

from app.agent_harness.skills import load_skill, list_skill_catalog
from app.agent_tools.broker_tools import (
    BrokerAgentContext,
    _db,
    _error,
    _ok,
    _tool_call,
    _user_id,
)
from app.services import agent_skill_prefs


def _is_adaptive(ctx: RunContextWrapper[BrokerAgentContext]) -> bool:
    context = getattr(ctx, "context", None)
    if isinstance(context, BrokerAgentContext):
        return bool(context.adaptive_workspace)
    if isinstance(context, dict):
        return bool(context.get("adaptive_workspace"))
    return bool(getattr(context, "adaptive_workspace", False))


def _overrides_for(ctx: RunContextWrapper[BrokerAgentContext]) -> list[dict[str, Any]]:
    db = _db()
    try:
        return agent_skill_prefs.list_overrides(db, user_id=_user_id(ctx))
    finally:
        db.close()


@function_tool(strict_mode=False)
def skill_catalog(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """List Agent Skills catalog (id, name, description only — no bodies).

    Distinct from workspace_list_skills (desk/authoring layouts).

    When to use:
    - To discover which research playbooks are available.

    Do not use:
    - For composing desk widgets (use workspace_list_skills / authoring docs).
    """

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("skill_catalog is only available on Adaptive Workspace", code="wrong_surface")
        entries = list_skill_catalog(overrides=_overrides_for(ctx))
        return _ok(skills=entries, count=len(entries))

    return _tool_call(call)


@function_tool(strict_mode=False)
def skill_load(
    ctx: RunContextWrapper[BrokerAgentContext],
    id: str,
    offset: int = 0,
) -> dict[str, Any]:
    """Load the full body of an Agent Skill by id.

    When to use:
    - Before following a playbook (Screener page, peer math, session recall, …).
    - When auto-load did not cover the task.

    Do not use:
    - To invent new tool names — only call tools already attached.
    - With an unknown id (returns an error).

    Example: id="screener-page"
    """

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("skill_load is only available on Adaptive Workspace", code="wrong_surface")
        skill_id = str(id or "").strip()
        if not skill_id:
            return _error("id is required", code="invalid_request")
        result = load_skill(skill_id, overrides=_overrides_for(ctx), offset=offset)
        if not result.get("ok"):
            return _error(result.get("message") or "load failed", code=result.get("code") or "load_failed")
        return _ok(**{k: v for k, v in result.items() if k != "ok"})

    return _tool_call(call)


SKILL_TOOLS = [skill_catalog, skill_load]
