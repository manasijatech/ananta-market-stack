"""Adaptive Workspace composition tools.

These tools are attached only to broker-chat runs whose metadata includes
``adaptive_workspace: true``. Broker Chat at ``/broker-chat`` does not send
that flag and therefore never sees these tools.
"""

from __future__ import annotations

from typing import Any, Literal

from agents import RunContextWrapper, function_tool

from app.agent_tools.broker_tools import BrokerAgentContext
from app.services import adaptive_workspace as workspace_svc
from db.session import SessionLocal

PatchOperation = Literal["replace", "add", "remove", "move", "update", "duplicate", "set_title"]


def _ok(**payload: Any) -> dict[str, Any]:
    return {"ok": True, **payload}


def _error(message: str, *, code: str = "workspace_tool_error", **payload: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, **payload}


def _context(ctx: RunContextWrapper[BrokerAgentContext]) -> BrokerAgentContext:
    context = getattr(ctx, "context", None)
    if isinstance(context, BrokerAgentContext):
        return context
    if isinstance(context, dict):
        return BrokerAgentContext(**context)
    return BrokerAgentContext.model_validate(context)


def _tool_call(fn):
    try:
        return fn()
    except ValueError as exc:
        return _error(str(exc), code="invalid_workspace_spec")
    except Exception as exc:
        return _error(str(exc), code=exc.__class__.__name__)


def _maybe_persist(context: BrokerAgentContext, spec, *, label: str) -> None:
    if not context.adaptive_workspace or not context.session_id or not context.user_id:
        return
    db = SessionLocal()
    try:
        workspace_svc.persist_spec(db, context.user_id, context.session_id, spec, label=label)
    finally:
        db.close()


def _current_spec(context: BrokerAgentContext) -> dict[str, Any] | None:
    if isinstance(context.workspace_spec, dict):
        return context.workspace_spec
    return None


@function_tool(strict_mode=False)
def compose_surface(
    ctx: RunContextWrapper[BrokerAgentContext],
    spec: dict[str, Any],
) -> dict[str, Any]:
    """Replace the Adaptive Workspace canvas with a validated WorkspaceSpec.

    Use this after fetching broker data when the user asks to build, rebuild,
    or lay out a desk. Emit only catalog component types. Never include React,
    HTML, CSS, className, style, href, src, or credentials.
    """

    def call() -> dict[str, Any]:
        context = _context(ctx)
        if not context.adaptive_workspace:
            return _error("compose_surface is only available on Adaptive Workspace runs")
        parsed, validation = workspace_svc.parse_spec_or_error(spec)
        if parsed is None:
            return _error("WorkspaceSpec failed validation", validation=validation)
        dumped = workspace_svc.workspace_spec_dump(parsed)
        context.workspace_spec = dumped
        _maybe_persist(context, parsed, label="compose_surface")
        return _ok(spec=dumped, validation=validation)

    return _tool_call(call)


@function_tool(strict_mode=False)
def patch_surface(
    ctx: RunContextWrapper[BrokerAgentContext],
    operation: PatchOperation,
    spec: dict[str, Any] | None = None,
    component: dict[str, Any] | None = None,
    component_id: str | None = None,
    position: dict[str, Any] | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Patch the current Adaptive Workspace canvas without replacing unrelated widgets.

    Operations:
    - replace: full WorkspaceSpec in ``spec``
    - add: catalog component object in ``component``
    - remove / duplicate: existing ``component_id``
    - move: ``component_id`` plus ``position`` {x,y,w,h}
    - update: ``component_id`` plus partial ``component`` fields
    - set_title: desk ``title``
    """

    def call() -> dict[str, Any]:
        context = _context(ctx)
        if not context.adaptive_workspace:
            return _error("patch_surface is only available on Adaptive Workspace runs")
        parsed = workspace_svc.patch_workspace_spec(
            _current_spec(context),
            operation=operation,
            spec=spec,
            component=component,
            component_id=component_id or context.selected_component_id,
            position=position,
            title=title,
        )
        dumped = workspace_svc.workspace_spec_dump(parsed)
        context.workspace_spec = dumped
        _maybe_persist(context, parsed, label=f"patch_surface:{operation}")
        return _ok(spec=dumped, operation=operation)

    return _tool_call(call)


WORKSPACE_TOOLS = [compose_surface, patch_surface]
