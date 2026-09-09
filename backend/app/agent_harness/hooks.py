"""Dynamic context hooks (plan 05) — world snapshot before each Adaptive Chat turn.

Hooks inject ModelItems (harness ``user`` messages) and optional audit events.
They never rewrite the frozen system prompt and never appear as human bubbles
in the default transcript UI.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy.orm import Session

from app.agent_harness.model_context import freeze_truncate
from app.config import get_settings
from db.models import BrokerChatRun

logger = logging.getLogger(__name__)

CONTEXT_HOOKS_PREFIX = "[Ananta context — not shown to the user]"
CONTEXT_INJECTED_EVENT = "context_injected"
CONTEXT_HOOK_ERROR_EVENT = "context_hook_error"

# Default budgets (overridable via settings).
DEFAULT_HOOKS_TOTAL_CHARS = 8_000
DEFAULT_HOOK_CHARS = 2_000


@dataclass
class HookContext:
    db: Session
    user_id: str
    session_id: str
    run: BrokerChatRun
    user_message: str
    workspace_spec: dict[str, Any] | None = None
    selected_component_id: str | None = None
    adaptive_workspace: bool = False
    sandbox_available: bool = False
    mcp_enabled: bool = False
    inject_holdings: bool = True
    default_account_id: str | None = None


@dataclass
class HookResult:
    title: str
    markdown: str
    audit: dict[str, Any] = field(default_factory=dict)
    truncated: bool = False


class ContextHook(Protocol):
    id: str
    priority: int

    def applies(self, ctx: HookContext) -> bool: ...

    def budget_chars(self) -> int: ...

    def render(self, ctx: HookContext) -> HookResult | None: ...


@dataclass
class HookRunResult:
    message: str
    hook_names: list[str] = field(default_factory=list)
    results: list[HookResult] = field(default_factory=list)
    errors: list[dict[str, str]] = field(default_factory=list)
    total_chars: int = 0


_REGISTRY: list[ContextHook] = []
_REGISTERED_IDS: set[str] = set()


def clear_hooks() -> None:
    """Test helper — wipe the process registry."""
    _REGISTRY.clear()
    _REGISTERED_IDS.clear()


def register_hook(hook: ContextHook) -> None:
    hook_id = str(getattr(hook, "id", "") or "").strip()
    if not hook_id:
        raise ValueError("ContextHook.id is required")
    if hook_id in _REGISTERED_IDS:
        # Replace in place so reloads / tests stay idempotent.
        for index, existing in enumerate(_REGISTRY):
            if getattr(existing, "id", None) == hook_id:
                _REGISTRY[index] = hook
                break
    else:
        _REGISTRY.append(hook)
        _REGISTERED_IDS.add(hook_id)
    _REGISTRY.sort(key=lambda item: (int(getattr(item, "priority", 100)), str(getattr(item, "id", ""))))


def registered_hooks() -> list[ContextHook]:
    return list(_REGISTRY)


def _hooks_total_chars() -> int:
    settings = get_settings()
    return int(getattr(settings, "hooks_total_chars", DEFAULT_HOOKS_TOTAL_CHARS) or DEFAULT_HOOKS_TOTAL_CHARS)


def run_context_hooks(ctx: HookContext) -> HookRunResult:
    """Execute registered hooks with per-hook and global char budgets.

    Failures are logged and skipped — they must never fail the chat run.
    """
    sections: list[str] = []
    names: list[str] = []
    results: list[HookResult] = []
    errors: list[dict[str, str]] = []
    used = 0
    total_budget = _hooks_total_chars()

    for hook in registered_hooks():
        hook_id = str(getattr(hook, "id", "hook"))
        try:
            if not hook.applies(ctx):
                continue
            remaining = total_budget - used
            if remaining <= 0:
                break
            budget = min(int(hook.budget_chars()), remaining)
            rendered = hook.render(ctx)
            if rendered is None:
                continue
            body = (rendered.markdown or "").strip()
            if not body:
                continue
            clipped, truncated = freeze_truncate(body, budget)
            if truncated:
                rendered = HookResult(
                    title=rendered.title,
                    markdown=clipped,
                    audit={**rendered.audit, "truncated": True},
                    truncated=True,
                )
            else:
                rendered = HookResult(
                    title=rendered.title,
                    markdown=clipped,
                    audit=rendered.audit,
                    truncated=False,
                )
            block = f"## {rendered.title}\n{rendered.markdown}".strip()
            sections.append(block)
            names.append(hook_id)
            results.append(rendered)
            used += len(block)
        except Exception as exc:
            logger.warning("context hook %s failed: %s", hook_id, exc, exc_info=True)
            errors.append({"hook_id": hook_id, "error": f"{type(exc).__name__}: {exc}"})

    if not sections:
        return HookRunResult(message="", hook_names=names, results=results, errors=errors, total_chars=0)

    message = "\n\n".join([CONTEXT_HOOKS_PREFIX, *sections])
    message += (
        "\n\nDo not recite this snapshot unless asked. "
        "Hooks are hints as-of now; live tools win if they disagree."
    )
    return HookRunResult(
        message=message,
        hook_names=names,
        results=results,
        errors=errors,
        total_chars=len(message),
    )


def ensure_builtin_hooks_registered() -> None:
    """Idempotent registration of shared built-ins."""
    from app.agent_harness import builtin_hooks

    builtin_hooks.register_builtin_hooks()
    try:
        from app.agent_harness.enterprise import register_enterprise_hooks

        register_enterprise_hooks()
    except ImportError:
        pass
