"""Alert workflow studio tools for Adaptive Workspace.

Attached only when a broker-chat run has ``adaptive_workspace: true``.
These reuse ``alert_workflow_chat_snapshots``. Deploy never happens silently.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool

from app.agent_tools.broker_tools import (
    BrokerAgentContext,
    _db,
    _error,
    _ok,
    _tool_call,
    _user_id,
)
from app.services import adaptive_workspace_alert_studio as studio_svc


def _is_adaptive(ctx: RunContextWrapper[BrokerAgentContext]) -> bool:
    context = getattr(ctx, "context", None)
    if isinstance(context, BrokerAgentContext):
        return bool(context.adaptive_workspace)
    if isinstance(context, dict):
        return bool(context.get("adaptive_workspace"))
    return bool(getattr(context, "adaptive_workspace", False))


def _studio_payload(studio: Any) -> dict[str, Any]:
    return studio.model_dump(mode="json") if hasattr(studio, "model_dump") else dict(studio)


@function_tool(strict_mode=False)
def alert_get_studio(
    ctx: RunContextWrapper[BrokerAgentContext],
    workflow_id: str | None = None,
    snapshot_id: str | None = None,
) -> dict[str, Any]:
    """Load an alert workflow studio payload from existing chat snapshots.

    Returns draft, graph_dsl, validation, samples, and diff for canvas widgets.
    Does not deploy. Empty when the user has no workflows.
    """

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("alert_get_studio is only available on Adaptive Workspace runs")
        db = _db()
        try:
            studio = studio_svc.get_studio(
                db,
                _user_id(ctx),
                workflow_id=workflow_id,
                snapshot_id=snapshot_id,
            )
            return _ok(**_studio_payload(studio))
        except ValueError as exc:
            return _error(str(exc), code="invalid_request")
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def alert_refresh_studio(
    ctx: RunContextWrapper[BrokerAgentContext],
    workflow_id: str | None = None,
) -> dict[str, Any]:
    """Write a new alert_workflow_chat_snapshot from the current workflow (validate/samples/diff)."""

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("alert_refresh_studio is only available on Adaptive Workspace runs")
        db = _db()
        try:
            studio = studio_svc.refresh_studio(db, _user_id(ctx), workflow_id=workflow_id)
            return _ok(**_studio_payload(studio))
        except ValueError as exc:
            return _error(str(exc), code="invalid_request")
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def alert_deploy_snapshot(
    ctx: RunContextWrapper[BrokerAgentContext],
    snapshot_id: str,
    confirm: bool = False,
) -> dict[str, Any]:
    """Deploy an existing alert workflow chat snapshot. Refuses unless confirm=true."""

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("alert_deploy_snapshot is only available on Adaptive Workspace runs")
        if not confirm:
            return _error(
                "Deploy requires confirm=true after the user explicitly asked to deploy.",
                code="confirmation_required",
            )
        db = _db()
        try:
            studio = studio_svc.deploy_studio(db, _user_id(ctx), snapshot_id, confirm=True)
            return _ok(**_studio_payload(studio))
        except ValueError as exc:
            return _error(str(exc), code="invalid_request")
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def alert_create_draft(
    ctx: RunContextWrapper[BrokerAgentContext],
    symbol: str,
    value: float,
    field: str = "ltp",
    operator: str = "gte",
    name: str | None = None,
    exchange: str = "NSE",
) -> dict[str, Any]:
    """Create a draft LTP/threshold alert workflow on this desk. Does not deploy.

    After success, compose alert-rule-draft + workflow-graph + workflow-simulation
    + approval-card with data.tool=alert_get_studio and params.workflow_id.
    Never call alert_deploy_snapshot unless the user explicitly confirmed.
    """

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("alert_create_draft is only available on Adaptive Workspace runs")
        db = _db()
        try:
            studio = studio_svc.create_draft(
                db,
                _user_id(ctx),
                symbol=symbol,
                field=field,
                operator=operator,
                value=value,
                name=name,
                exchange=exchange,
            )
            return _ok(**_studio_payload(studio), deployed=False)
        except ValueError as exc:
            return _error(str(exc), code="invalid_request")
        finally:
            db.close()

    return _tool_call(call)


ALERT_STUDIO_TOOLS = [alert_get_studio, alert_refresh_studio, alert_create_draft, alert_deploy_snapshot]
