from __future__ import annotations

from typing import Any, Literal

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.schemas.alert import AlertUniversePreviewIn
from app.services import alerts as alert_svc
from app.services import broker_data_preferences
from app.services.alert_workflow_chat import snapshots
from app.services.alert_workflow_chat.serialization import safe_data
from db.models import AlertWorkflowChatSession, UserWatchlist, UserWatchlistSymbol
from db.session import SessionLocal


class WorkflowChatContext(BaseModel):
    user_id: str
    session_id: str
    workflow_id: str
    run_id: str | None = None
    editor_payload: dict[str, Any] = Field(default_factory=dict)
    deploy_allowed: bool = False


def _ok(**payload: Any) -> dict[str, Any]:
    return {"ok": True, **safe_data(payload)}


def _error(message: str, *, code: str = "workflow_chat_tool_error", **payload: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, **safe_data(payload)}


def _context(ctx: RunContextWrapper[WorkflowChatContext]) -> WorkflowChatContext:
    context = getattr(ctx, "context", None)
    if isinstance(context, WorkflowChatContext):
        return context
    if isinstance(context, dict):
        return WorkflowChatContext(**context)
    return WorkflowChatContext.model_validate(context)


def _tool_call(fn):
    try:
        return fn()
    except ValueError as exc:
        return _error(str(exc), code="invalid_request")
    except Exception as exc:
        return _error(str(exc), code=exc.__class__.__name__)


def _current_payload(db, context: WorkflowChatContext) -> dict[str, Any]:
    if context.editor_payload:
        return snapshots.workflow_out_payload(context.editor_payload)
    workflow = alert_svc.get_workflow(db, context.user_id, context.workflow_id)
    if workflow is None:
        raise ValueError("workflow not found")
    return snapshots.workflow_out_payload(workflow)


def _create_snapshot_from_payload(
    *,
    context: WorkflowChatContext,
    workflow_payload: dict[str, Any],
    label: str | None,
    diff: dict[str, Any] | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        session = db.get(AlertWorkflowChatSession, context.session_id)
        if not session or session.user_id != context.user_id:
            raise ValueError("workflow chat session not found")
        row = snapshots.create_snapshot(
            db,
            session=session,
            user_id=context.user_id,
            workflow_id=context.workflow_id,
            workflow_payload=snapshots.workflow_out_payload(workflow_payload),
            run_id=context.run_id,
            label=label,
            diff=diff,
        )
        return _ok(snapshot=snapshots.snapshot_to_schema(row).model_dump(mode="json"))
    finally:
        db.close()


def _create_snapshot_from_patch(
    *,
    context: WorkflowChatContext,
    label: str | None,
    changed_fields: list[str],
    patcher,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        payload = _current_payload(db, context)
    finally:
        db.close()
    patcher(payload)
    return _create_snapshot_from_payload(
        context=context,
        workflow_payload=payload,
        label=label,
        diff={"changed_fields": changed_fields},
    )


def _targeting_for_universe(target_universe: dict[str, Any]) -> dict[str, Any]:
    kind = str(target_universe.get("kind") or "static_symbols")
    if kind == "static_symbols":
        symbols = target_universe.get("symbols") if isinstance(target_universe.get("symbols"), list) else []
        entries = []
        for item in symbols:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            exchange = item.get("exchange")
            entries.append(
                {
                    "symbol": symbol,
                    "exchange": str(exchange).strip().upper() if exchange else None,
                    "instrument_ref": item.get("instrument_ref") if isinstance(item.get("instrument_ref"), dict) else {},
                    "label": item.get("label") if isinstance(item.get("label"), str) else None,
                    "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
                    "metadata": item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
                }
            )
        return {
            "mode": "symbol_list" if len(entries) > 1 else "single_symbol",
            "entries": entries,
            "preset_id": None,
            "preset_label": None,
            "filters": {},
        }
    return {
        "mode": "preset_universe",
        "entries": [],
        "preset_id": str(target_universe.get("watchlist_id") or target_universe.get("preset_id") or "") or None,
        "preset_label": target_universe.get("label") if isinstance(target_universe.get("label"), str) else None,
        "filters": target_universe.get("filters") if isinstance(target_universe.get("filters"), dict) else {},
    }


@function_tool(strict_mode=False)
def workflow_get_current_state(ctx: RunContextWrapper[WorkflowChatContext]) -> dict[str, Any]:
    """Return the current workflow payload the chat should edit."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            payload = _current_payload(db, context)
            return _ok(workflow_id=context.workflow_id, workflow_payload=payload)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_get_authoring_docs(
    ctx: RunContextWrapper[WorkflowChatContext],
    include_registry: bool = True,
) -> dict[str, Any]:
    """Return condition, field, function, placeholder, preset, and DSL guidance."""

    def call() -> dict[str, Any]:
        _ = _context(ctx)
        docs = {
            "dsl_rules": [
                "Use comparisons such as ltp >= 100.",
                "Use registered operator calls such as rolling_pct_change_gte(ltp, value=1.5, window_seconds=300).",
                "Use all(...), any(...), and not(...) for grouping.",
                "Do not use arbitrary Python or JavaScript; the backend compiles this expression to the alert AST.",
            ],
            "placeholders": alert_svc.llm_placeholder_catalog(),
            "presets": alert_svc.alert_presets(),
        }
        if include_registry:
            docs["condition_registry"] = alert_svc.alert_condition_registry()
        return _ok(**docs)

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_list_watchlists(
    ctx: RunContextWrapper[WorkflowChatContext],
    include_symbols: bool = False,
    limit: int = 100,
) -> dict[str, Any]:
    """List user watchlists that can be used as a dynamic workflow universe."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            rows = list(
                db.scalars(
                    select(UserWatchlist)
                    .where(UserWatchlist.user_id == context.user_id)
                    .order_by(UserWatchlist.updated_at.desc(), UserWatchlist.name.asc())
                    .limit(max(1, min(limit, 200)))
                ).all()
            )
            out = []
            for row in rows:
                payload = {
                    "id": row.id,
                    "name": row.name,
                    "kind": row.kind,
                    "symbol_count": len(row.system_preset.symbols) if row.kind == "preset" and row.system_preset else len(row.symbols),
                }
                if include_symbols:
                    symbols = row.system_preset.symbols if row.kind == "preset" and row.system_preset else row.symbols
                    payload["symbols"] = [
                        {"symbol": item.symbol, "exchange": item.exchange, "sort_order": item.sort_order}
                        for item in sorted(symbols, key=lambda item: item.sort_order)[:500]
                    ]
                out.append(payload)
            return _ok(watchlists=out)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_get_watchlist_symbols(
    ctx: RunContextWrapper[WorkflowChatContext],
    watchlist_id: str,
    limit: int = 500,
) -> dict[str, Any]:
    """Return symbols for a specific watchlist id."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            watchlist = db.get(UserWatchlist, watchlist_id)
            if not watchlist or watchlist.user_id != context.user_id:
                raise ValueError("watchlist not found")
            if watchlist.kind == "preset" and watchlist.system_preset:
                rows = sorted(watchlist.system_preset.symbols, key=lambda item: item.sort_order)
            else:
                rows = list(
                    db.scalars(
                        select(UserWatchlistSymbol)
                        .where(UserWatchlistSymbol.watchlist_id == watchlist.id)
                        .order_by(UserWatchlistSymbol.sort_order.asc(), UserWatchlistSymbol.symbol.asc())
                        .limit(max(1, min(limit, 2000)))
                    ).all()
                )
            return _ok(
                watchlist={"id": watchlist.id, "name": watchlist.name, "kind": watchlist.kind},
                symbols=[
                    {"symbol": item.symbol, "exchange": item.exchange or None, "sort_order": item.sort_order}
                    for item in rows[: max(1, min(limit, 2000))]
                ],
                truncated=len(rows) > max(1, min(limit, 2000)),
            )
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_search_instruments(
    ctx: RunContextWrapper[WorkflowChatContext],
    query: str,
    exchange: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Search broker instrument metadata for symbols that can be used in a static workflow universe."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            rows = broker_data_preferences.search_instruments_for_user(
                db,
                context.user_id,
                query=query,
                exchange=exchange,
                limit=max(1, min(limit, 100)),
            )
            return _ok(results=[row.model_dump(mode="json") for row in rows])
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_preview_universe(
    ctx: RunContextWrapper[WorkflowChatContext],
    target_universe: dict[str, Any],
    limit: int = 50,
) -> dict[str, Any]:
    """Preview a target_universe AST node before creating a workflow snapshot."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            preview = alert_svc.preview_universe(
                db,
                context.user_id,
                AlertUniversePreviewIn(target_universe=target_universe, limit=limit).target_universe,
                limit,
            )
            return _ok(preview=preview)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_create_snapshot(
    ctx: RunContextWrapper[WorkflowChatContext],
    workflow_payload: dict[str, Any],
    label: str | None = None,
    changed_fields: list[str] | None = None,
) -> dict[str, Any]:
    """Validate and store an immutable workflow snapshot from a complete workflow payload."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        return _create_snapshot_from_payload(
            context=context,
            workflow_payload=workflow_payload,
            label=label,
            diff={"changed_fields": changed_fields or []},
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_set_dsl(
    ctx: RunContextWrapper[WorkflowChatContext],
    dsl_text: str,
    label: str | None = None,
) -> dict[str, Any]:
    """Create a valid snapshot by replacing only workflow_dsl.dsl_text on the current workflow payload."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            payload = _current_payload(db, context)
        finally:
            db.close()
        dsl = dict(payload.get("workflow_dsl") or {})
        dsl["dsl_text"] = dsl_text
        payload["workflow_dsl"] = dsl
        return _create_snapshot_from_payload(
            context=context,
            workflow_payload=payload,
            label=label or "Updated DSL script",
            diff={"changed_fields": ["workflow_dsl.dsl_text"]},
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_set_universe(
    ctx: RunContextWrapper[WorkflowChatContext],
    target_universe: dict[str, Any],
    label: str | None = None,
) -> dict[str, Any]:
    """Create a snapshot after replacing the workflow target universe."""

    def call() -> dict[str, Any]:
        context = _context(ctx)

        def patch(payload: dict[str, Any]) -> None:
            dsl = dict(payload.get("workflow_dsl") or {})
            ast = dict(dsl.get("workflow_ast") or {})
            ast["target_universe"] = target_universe
            dsl["workflow_ast"] = ast
            dsl["targeting"] = _targeting_for_universe(target_universe)
            payload["workflow_dsl"] = dsl

        return _create_snapshot_from_patch(
            context=context,
            label=label or "Updated target universe",
            changed_fields=["workflow_dsl.workflow_ast.target_universe", "workflow_dsl.targeting"],
            patcher=patch,
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_set_rule_conditions(
    ctx: RunContextWrapper[WorkflowChatContext],
    combine: Literal["all", "any"],
    conditions: list[dict[str, Any]],
    label: str | None = None,
) -> dict[str, Any]:
    """Create a snapshot after replacing visual-builder-compatible rule conditions."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        if combine not in {"all", "any"}:
            raise ValueError("combine must be either all or any")
        if not conditions:
            raise ValueError("at least one condition is required")

        def patch(payload: dict[str, Any]) -> None:
            dsl = dict(payload.get("workflow_dsl") or {})
            ast = dict(dsl.get("workflow_ast") or {})
            normalized = []
            for condition in conditions:
                item = dict(condition)
                item.setdefault("kind", "condition")
                item.setdefault("children", [])
                normalized.append(item)
            ast["logic"] = {"kind": combine, "children": normalized}
            dsl["combine"] = combine
            dsl["conditions"] = [{key: value for key, value in item.items() if key not in {"kind", "children"}} for item in normalized]
            dsl["workflow_ast"] = ast
            dsl["dsl_text"] = None
            payload["workflow_dsl"] = dsl

        return _create_snapshot_from_patch(
            context=context,
            label=label or "Updated rule conditions",
            changed_fields=["workflow_dsl.conditions", "workflow_dsl.workflow_ast.logic", "workflow_dsl.dsl_text"],
            patcher=patch,
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_set_notification_delivery(
    ctx: RunContextWrapper[WorkflowChatContext],
    level: str | None = None,
    title_template: str | None = None,
    message_template: str | None = None,
    enabled_channels: list[str] | None = None,
    inherit_defaults: bool | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    """Create a snapshot after changing alert copy, severity, or delivery channels."""

    def call() -> dict[str, Any]:
        context = _context(ctx)

        def patch(payload: dict[str, Any]) -> None:
            dsl = dict(payload.get("workflow_dsl") or {})
            notification = dict(dsl.get("notification") or {})
            if level is not None:
                notification["level"] = level
            if title_template is not None:
                notification["title_template"] = title_template
            if message_template is not None:
                notification["message_template"] = message_template
            dsl["notification"] = notification
            channels = dict(dsl.get("channels") or {})
            if enabled_channels is not None:
                channels["enabled"] = enabled_channels
            if inherit_defaults is not None:
                channels["inherit_defaults"] = inherit_defaults
            dsl["channels"] = channels
            payload["workflow_dsl"] = dsl
            payload["channel_override"] = channels

        return _create_snapshot_from_patch(
            context=context,
            label=label or "Updated notification and delivery",
            changed_fields=["workflow_dsl.notification", "workflow_dsl.channels", "channel_override"],
            patcher=patch,
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_set_runtime_settings(
    ctx: RunContextWrapper[WorkflowChatContext],
    cooldown_seconds: int | None = None,
    active_period: dict[str, Any] | None = None,
    market_cap_filter: dict[str, Any] | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    """Create a snapshot after changing cooldown, active market window, or market-cap filter."""

    def call() -> dict[str, Any]:
        context = _context(ctx)

        def patch(payload: dict[str, Any]) -> None:
            dsl = dict(payload.get("workflow_dsl") or {})
            ast = dict(dsl.get("workflow_ast") or {})
            if cooldown_seconds is not None:
                dsl["cooldown_seconds"] = cooldown_seconds
                ast["cooldown_seconds"] = cooldown_seconds
            if active_period is not None:
                dsl["active_period"] = active_period
            if market_cap_filter is not None:
                dsl["market_cap_filter"] = market_cap_filter
                ast["market_cap_filter"] = market_cap_filter
            dsl["workflow_ast"] = ast
            payload["workflow_dsl"] = dsl

        return _create_snapshot_from_patch(
            context=context,
            label=label or "Updated runtime settings",
            changed_fields=["workflow_dsl.cooldown_seconds", "workflow_dsl.active_period", "workflow_dsl.market_cap_filter"],
            patcher=patch,
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_validate_current(
    ctx: RunContextWrapper[WorkflowChatContext],
    workflow_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate the current editor payload or a proposed workflow payload without storing a snapshot."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            payload = snapshots.workflow_out_payload(workflow_payload or _current_payload(db, context))
        finally:
            db.close()
        valid, validation, compile_result, explanation, samples = snapshots.validate_workflow_payload(payload)
        return _ok(
            valid=valid,
            validation=validation,
            compile=compile_result,
            explanation=explanation,
            samples=samples,
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_compile_preview(
    ctx: RunContextWrapper[WorkflowChatContext],
    workflow_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the compiled AST and diagnostics for the current or proposed workflow payload."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            payload = snapshots.workflow_out_payload(workflow_payload or _current_payload(db, context))
        finally:
            db.close()
        valid, validation, compile_result, explanation, _samples = snapshots.validate_workflow_payload(payload)
        return _ok(
            valid=valid,
            validation=validation,
            compile=compile_result,
            explanation=explanation,
        )

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_explain_current(
    ctx: RunContextWrapper[WorkflowChatContext],
    workflow_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return an English explanation for the current or proposed workflow payload."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            payload = snapshots.workflow_out_payload(workflow_payload or _current_payload(db, context))
        finally:
            db.close()
        valid, validation, _compile_result, explanation, _samples = snapshots.validate_workflow_payload(payload)
        return _ok(valid=valid, validation=validation, explanation=explanation)

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_sample_alerts_current(
    ctx: RunContextWrapper[WorkflowChatContext],
    workflow_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return example ticks and rendered sample alerts for the current or proposed workflow payload."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            payload = snapshots.workflow_out_payload(workflow_payload or _current_payload(db, context))
        finally:
            db.close()
        valid, validation, _compile_result, _explanation, samples = snapshots.validate_workflow_payload(payload)
        return _ok(valid=valid, validation=validation, samples=samples)

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_diff_snapshot(
    ctx: RunContextWrapper[WorkflowChatContext],
    snapshot_id: str,
) -> dict[str, Any]:
    """Diff the current workflow payload against a stored immutable snapshot."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            snapshot = snapshots.get_owned_snapshot(db, context.user_id, snapshot_id)
            current = snapshots.workflow_out_payload(_current_payload(db, context))
            proposed = snapshots.workflow_out_payload(snapshots.json_loads(snapshot.workflow_payload_json, {}))
        finally:
            db.close()
        changed_fields = []
        for key in sorted(set(current) | set(proposed)):
            if current.get(key) != proposed.get(key):
                changed_fields.append(key)
        current_dsl = current.get("workflow_dsl") if isinstance(current.get("workflow_dsl"), dict) else {}
        proposed_dsl = proposed.get("workflow_dsl") if isinstance(proposed.get("workflow_dsl"), dict) else {}
        changed_dsl_fields = [
            key for key in sorted(set(current_dsl) | set(proposed_dsl)) if current_dsl.get(key) != proposed_dsl.get(key)
        ]
        return _ok(snapshot_id=snapshot_id, changed_fields=changed_fields, changed_dsl_fields=changed_dsl_fields)

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_revert_to_snapshot(
    ctx: RunContextWrapper[WorkflowChatContext],
    snapshot_id: str,
) -> dict[str, Any]:
    """Revert the workflow row to a previous valid snapshot without deploying it."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            snapshot, workflow = snapshots.apply_snapshot(db, context.user_id, snapshot_id)
            return _ok(snapshot=snapshot.model_dump(mode="json"), workflow=workflow.model_dump(mode="json"))
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_apply_snapshot(
    ctx: RunContextWrapper[WorkflowChatContext],
    snapshot_id: str,
) -> dict[str, Any]:
    """Apply a valid snapshot to the workflow row without deploying it."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        db = SessionLocal()
        try:
            snapshot, workflow = snapshots.apply_snapshot(db, context.user_id, snapshot_id)
            return _ok(snapshot=snapshot.model_dump(mode="json"), workflow=workflow.model_dump(mode="json"))
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def workflow_deploy_snapshot(
    ctx: RunContextWrapper[WorkflowChatContext],
    snapshot_id: str,
    explicit_user_request: bool = False,
) -> dict[str, Any]:
    """Deploy a valid snapshot only when the current user explicitly requested deployment."""

    def call() -> dict[str, Any]:
        context = _context(ctx)
        if not context.deploy_allowed and not explicit_user_request:
            return _error("Deployment was blocked because the current user turn did not explicitly request deploy.", code="deploy_confirmation_required")
        db = SessionLocal()
        try:
            snapshot, workflow = snapshots.deploy_snapshot(db, context.user_id, snapshot_id)
            return _ok(snapshot=snapshot.model_dump(mode="json"), workflow=workflow.model_dump(mode="json"))
        finally:
            db.close()

    return _tool_call(call)


WORKFLOW_CHAT_TOOLS = [
    workflow_get_current_state,
    workflow_get_authoring_docs,
    workflow_list_watchlists,
    workflow_get_watchlist_symbols,
    workflow_search_instruments,
    workflow_preview_universe,
    workflow_create_snapshot,
    workflow_set_dsl,
    workflow_set_universe,
    workflow_set_rule_conditions,
    workflow_set_notification_delivery,
    workflow_set_runtime_settings,
    workflow_validate_current,
    workflow_compile_preview,
    workflow_explain_current,
    workflow_sample_alerts_current,
    workflow_diff_snapshot,
    workflow_apply_snapshot,
    workflow_revert_to_snapshot,
    workflow_deploy_snapshot,
]
