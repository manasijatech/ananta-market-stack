"""Adaptive Workspace composition tools.

These tools are attached only to broker-chat runs whose metadata includes
``adaptive_workspace: true``. Broker Chat at ``/broker-chat`` does not send
that flag and therefore never sees these tools.

Validation follows the workflow-chat pattern: catalog/docs and dry-run
validate return ``ok: true`` with ``valid`` / ``validation.errors`` so the
model can self-correct. Invalid compose/patch calls are not applied.
"""

from __future__ import annotations

from typing import Any, Literal

from agents import RunContextWrapper, function_tool

from app.agent_tools.broker_tools import BrokerAgentContext
from app.services import adaptive_workspace as workspace_svc
from app.services import adaptive_workspace_personalization as personalization
from db.session import SessionLocal

PatchOperation = Literal["replace", "add", "remove", "move", "update", "duplicate", "set_title"]

_RETRY_HINT = (
    "Read validation.errors, fix the spec using only catalog types from "
    "workspace_get_authoring_docs, and retry at most once. Do not invent types."
)


def _ok(**payload: Any) -> dict[str, Any]:
    return {"ok": True, **payload}


def _error(message: str, *, code: str = "workspace_tool_error", **payload: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, **payload}


def _rejected(validation: dict[str, Any], *, spec: dict[str, Any] | None = None, **payload: Any) -> dict[str, Any]:
    return _ok(
        applied=False,
        valid=False,
        spec=spec,
        validation=validation,
        hint=_RETRY_HINT,
        **payload,
    )


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


def _require_adaptive(context: BrokerAgentContext, tool_name: str) -> dict[str, Any] | None:
    if context.adaptive_workspace:
        return None
    return _error(f"{tool_name} is only available on Adaptive Workspace runs")


@function_tool(strict_mode=False)
def workspace_get_authoring_docs(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """Return the Adaptive Workspace catalog, grid rules, allowlisted tools, and an example spec.

    Call this before composing if you are unsure of valid component types.
    Do not invent types, tools, actions, or extra JSON keys.
    """

    def call() -> dict[str, Any]:
        refused = _require_adaptive(_context(ctx), "workspace_get_authoring_docs")
        if refused:
            return refused
        return _ok(**workspace_svc.authoring_docs())

    return _tool_call(call)


@function_tool(strict_mode=False)
def workspace_get_current(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """Return the current canvas WorkspaceSpec for this desk session."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        refused = _require_adaptive(context, "workspace_get_current")
        if refused:
            return refused
        spec = _current_spec(context)
        if spec is None:
            empty = workspace_svc.workspace_spec_dump(workspace_svc.empty_spec())
            return _ok(spec=empty, empty=True)
        parsed, validation = workspace_svc.parse_spec_or_error(spec)
        if parsed is None:
            return _ok(spec=spec, empty=False, valid=False, validation=validation)
        return _ok(spec=workspace_svc.workspace_spec_dump(parsed), empty=False, valid=True, validation=validation)

    return _tool_call(call)


@function_tool(strict_mode=False)
def workspace_validate_spec(
    ctx: RunContextWrapper[BrokerAgentContext],
    spec: dict[str, Any],
) -> dict[str, Any]:
    """Dry-run validate a WorkspaceSpec without applying it to the canvas.

    Always returns ok=true. Check ``valid`` and ``validation.errors`` before
    calling compose_surface. Fix listed path/message issues instead of retrying blindly.
    """

    def call() -> dict[str, Any]:
        refused = _require_adaptive(_context(ctx), "workspace_validate_spec")
        if refused:
            return refused
        parsed, validation = workspace_svc.parse_spec_or_error(spec)
        if parsed is None:
            return _ok(valid=False, applied=False, spec=spec if isinstance(spec, dict) else None, validation=validation, hint=_RETRY_HINT)
        return _ok(valid=True, applied=False, spec=workspace_svc.workspace_spec_dump(parsed), validation=validation)

    return _tool_call(call)


@function_tool(strict_mode=False)
def compose_surface(
    ctx: RunContextWrapper[BrokerAgentContext],
    spec: dict[str, Any],
) -> dict[str, Any]:
    """Replace the Adaptive Workspace canvas with a validated WorkspaceSpec.

    Fetch broker data first. Prefer workspace_validate_spec when unsure.
    Emit only catalog component types from workspace_get_authoring_docs.
    Never include React, HTML, CSS, className, style, href, src, or credentials.
    """

    def call() -> dict[str, Any]:
        context = _context(ctx)
        refused = _require_adaptive(context, "compose_surface")
        if refused:
            return refused
        parsed, validation = workspace_svc.parse_spec_or_error(spec)
        if parsed is None:
            return _rejected(validation, spec=spec if isinstance(spec, dict) else None)
        dumped = workspace_svc.workspace_spec_dump(parsed)
        context.workspace_spec = dumped
        _maybe_persist(context, parsed, label="compose_surface")
        return _ok(applied=True, valid=True, spec=dumped, validation=validation)

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
        refused = _require_adaptive(context, "patch_surface")
        if refused:
            return refused
        parsed, validation = workspace_svc.patch_workspace_spec_or_error(
            _current_spec(context),
            operation=operation,
            spec=spec,
            component=component,
            component_id=component_id or context.selected_component_id,
            position=position,
            title=title,
        )
        if parsed is None:
            return _rejected(validation, spec=_current_spec(context), operation=operation)
        dumped = workspace_svc.workspace_spec_dump(parsed)
        context.workspace_spec = dumped
        _maybe_persist(context, parsed, label=f"patch_surface:{operation}")
        return _ok(applied=True, valid=True, spec=dumped, operation=operation, validation=validation)

    return _tool_call(call)


@function_tool(strict_mode=False)
def workspace_evaluate_request(
    ctx: RunContextWrapper[BrokerAgentContext],
    user_query: str,
    spec: dict[str, Any] | None = None,
    observations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Plan coverage for the user request and check whether a desk actually complements it.

    Call once after reading the query, then again after fetching data (and optionally
    with a draft spec) before compose_surface. Observations may include quote_count,
    quotes_with_change_pct, watchlist_symbol_count, news_item_count,
    alert_workflow_count, and alert_notification_count.
    """

    def call() -> dict[str, Any]:
        context = _context(ctx)
        refused = _require_adaptive(context, "workspace_evaluate_request")
        if refused:
            return refused
        current = spec if isinstance(spec, dict) else _current_spec(context)
        evaluation = workspace_svc.evaluate_request(
            user_query,
            spec=current if isinstance(current, dict) else None,
            observations=observations if isinstance(observations, dict) else None,
        )
        if context.user_id:
            db = SessionLocal()
            try:
                evaluation["suggestions"] = personalization.record_request_intents(
                    db, context.user_id, list(evaluation.get("intents") or [])
                )
            finally:
                db.close()
        else:
            evaluation["suggestions"] = []
        return _ok(**evaluation)

    return _tool_call(call)


@function_tool(strict_mode=False)
def workspace_list_templates(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """List named desk templates. Do not apply unless the user asked. Never rearrange silently."""

    def call() -> dict[str, Any]:
        refused = _require_adaptive(_context(ctx), "workspace_list_templates")
        if refused:
            return refused
        return _ok(templates=personalization.list_templates(), **personalization.catalog_summaries())

    return _tool_call(call)


@function_tool(strict_mode=False)
def workspace_list_skills(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """List desk skills (morning brief, F&O, earnings week, alert studio). Suggest only; do not auto-apply."""

    def call() -> dict[str, Any]:
        refused = _require_adaptive(_context(ctx), "workspace_list_skills")
        if refused:
            return refused
        return _ok(skills=personalization.list_skills(), apply_rule=personalization.catalog_summaries()["apply_rule"])

    return _tool_call(call)


@function_tool(strict_mode=False)
def workspace_list_saved_desks(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """List the user's named saved desks. Load only when the user asks."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        refused = _require_adaptive(context, "workspace_list_saved_desks")
        if refused:
            return refused
        if not context.user_id:
            return _ok(desks=[])
        db = SessionLocal()
        try:
            return _ok(desks=personalization.list_saved_desks(db, context.user_id))
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workspace_list_preferences(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, Any]:
    """Return inspectable display preferences. Users delete these from the inspector, not via tools."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        refused = _require_adaptive(context, "workspace_list_preferences")
        if refused:
            return refused
        if not context.user_id:
            return _ok(preferences=[], allowed_keys=sorted(personalization.ALLOWED_PREFERENCE_KEYS))
        db = SessionLocal()
        try:
            return _ok(
                preferences=personalization.list_preferences(db, context.user_id),
                allowed_keys=sorted(personalization.ALLOWED_PREFERENCE_KEYS),
            )
        finally:
            db.close()

    return _tool_call(call)


WORKSPACE_TOOLS = [
    workspace_get_authoring_docs,
    workspace_get_current,
    workspace_validate_spec,
    workspace_evaluate_request,
    workspace_list_templates,
    workspace_list_skills,
    workspace_list_saved_desks,
    workspace_list_preferences,
    compose_surface,
    patch_surface,
]
