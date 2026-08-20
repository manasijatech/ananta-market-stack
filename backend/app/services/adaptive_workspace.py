from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.adaptive_workspace import (
    WorkspaceSpec,
    empty_workspace_spec,
    next_component_id,
    next_grid_position,
    parse_workspace_spec,
    workspace_authoring_docs,
    workspace_spec_dump,
)
from app.schemas.adaptive_workspace_api import AdaptiveWorkspaceSnapshotOut
from app.services import broker_chat
from common.datetime_compat import UTC
from db.models import AdaptiveWorkspaceSnapshot, BrokerChatSession


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def validation_payload(exc: ValidationError | None = None, *, issues: list[dict[str, str]] | None = None) -> dict[str, Any]:
    if exc is not None:
        return {
            "ok": False,
            "errors": [
                {"path": ".".join(str(part) for part in err.get("loc", ())), "message": err.get("msg", "invalid")}
                for err in exc.errors()
            ],
        }
    if issues:
        return {"ok": False, "errors": issues}
    return {"ok": True, "errors": []}


def parse_spec_or_error(payload: Any) -> tuple[WorkspaceSpec | None, dict[str, Any]]:
    if not isinstance(payload, dict):
        return None, validation_payload(issues=[{"path": "", "message": "WorkspaceSpec must be an object"}])
    try:
        return parse_workspace_spec(payload), validation_payload()
    except ValidationError as exc:
        return None, validation_payload(exc)


def authoring_docs() -> dict[str, Any]:
    return workspace_authoring_docs()


def _validation_from_value_error(exc: ValueError) -> dict[str, Any]:
    message = str(exc)
    try:
        parsed = json.loads(message)
    except json.JSONDecodeError:
        return validation_payload(issues=[{"path": "", "message": message}])
    if isinstance(parsed, dict) and isinstance(parsed.get("errors"), list):
        return {
            "ok": False,
            "errors": parsed["errors"],
        }
    return validation_payload(issues=[{"path": "", "message": message}])


def patch_workspace_spec_or_error(
    current: dict[str, Any] | WorkspaceSpec | None,
    *,
    operation: str,
    spec: dict[str, Any] | None = None,
    component: dict[str, Any] | None = None,
    component_id: str | None = None,
    position: dict[str, Any] | None = None,
    title: str | None = None,
) -> tuple[WorkspaceSpec | None, dict[str, Any]]:
    try:
        parsed = patch_workspace_spec(
            current,
            operation=operation,
            spec=spec,
            component=component,
            component_id=component_id,
            position=position,
            title=title,
        )
        return parsed, validation_payload()
    except ValueError as exc:
        return None, _validation_from_value_error(exc)


def empty_spec(title: str = "Untitled desk") -> WorkspaceSpec:
    return empty_workspace_spec(title)


def patch_workspace_spec(
    current: dict[str, Any] | WorkspaceSpec | None,
    *,
    operation: str,
    spec: dict[str, Any] | None = None,
    component: dict[str, Any] | None = None,
    component_id: str | None = None,
    position: dict[str, Any] | None = None,
    title: str | None = None,
) -> WorkspaceSpec:
    if operation == "replace":
        if not isinstance(spec, dict):
            raise ValueError("replace requires a WorkspaceSpec object")
        parsed, validation = parse_spec_or_error(spec)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if isinstance(current, WorkspaceSpec):
        base = current
    elif isinstance(current, dict) and current:
        parsed, validation = parse_spec_or_error(current)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        base = parsed
    else:
        base = empty_workspace_spec()

    dumped = workspace_spec_dump(base)
    components: list[dict[str, Any]] = list(dumped.get("components") or [])

    if operation == "set_title":
        if not title or not str(title).strip():
            raise ValueError("set_title requires a non-empty title")
        dumped["title"] = str(title).strip()[:120]
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "add":
        if not isinstance(component, dict):
            raise ValueError("add requires a component object")
        incoming = deepcopy(component)
        if not incoming.get("id"):
            incoming["id"] = next_component_id(
                [str(item.get("id") or "") for item in components],
                str(incoming.get("type") or "widget"),
            )
        if not incoming.get("position"):
            parsed_base = parse_workspace_spec(dumped)
            pos = next_grid_position(parsed_base.components)
            incoming["position"] = pos.model_dump()
        components.append(incoming)
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if not component_id:
        raise ValueError(f"{operation} requires component_id")

    if operation == "remove":
        dumped["components"] = [item for item in components if item.get("id") != component_id]
        if len(dumped["components"]) == len(components):
            raise ValueError(f"component {component_id!r} was not found on the desk")
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "move":
        if not isinstance(position, dict):
            raise ValueError("move requires a position object")
        found = False
        for item in components:
            if item.get("id") == component_id:
                item["position"] = position
                found = True
                break
        if not found:
            raise ValueError(f"component {component_id!r} was not found on the desk")
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "update":
        if not isinstance(component, dict):
            raise ValueError("update requires a component object")
        found = False
        for index, item in enumerate(components):
            if item.get("id") != component_id:
                continue
            merged = {**item, **deepcopy(component), "id": component_id}
            components[index] = merged
            found = True
            break
        if not found:
            raise ValueError(f"component {component_id!r} was not found on the desk")
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    if operation == "duplicate":
        source = None
        for item in components:
            if item.get("id") == component_id:
                source = deepcopy(item)
                break
        if source is None:
            raise ValueError(f"component {component_id!r} was not found on the desk")
        clone_id = next_component_id(
            [str(item.get("id") or "") for item in components],
            str(source.get("id") or source.get("type") or "widget"),
        )
        parsed_base = parse_workspace_spec(dumped)
        pos = source.get("position") if isinstance(source.get("position"), dict) else {}
        clone_position = next_grid_position(
            parsed_base.components,
            int(pos.get("w") or 6),
            int(pos.get("h") or 3),
        )
        source["id"] = clone_id
        source["position"] = clone_position.model_dump()
        components.append(source)
        dumped["components"] = components
        parsed, validation = parse_spec_or_error(dumped)
        if parsed is None:
            raise ValueError(json_dumps(validation))
        return parsed

    raise ValueError(f"unsupported patch operation {operation!r}")


def snapshot_to_out(row: AdaptiveWorkspaceSnapshot) -> AdaptiveWorkspaceSnapshotOut:
    spec, validation = parse_spec_or_error(json_loads(row.workspace_payload_json, {}))
    payload = workspace_spec_dump(spec) if spec is not None else json_loads(row.workspace_payload_json, {})
    stored_validation = json_loads(row.validation_json, {})
    return AdaptiveWorkspaceSnapshotOut(
        id=row.id,
        session_id=row.session_id,
        user_id=row.user_id,
        version=row.version,
        label=row.label,
        workspace_payload=payload,
        validation=stored_validation or validation,
        valid=row.valid,
        applied_at=row.applied_at,
        created_at=row.created_at,
    )


def _next_version(db: Session, session_id: str) -> int:
    current = db.scalar(
        select(func.max(AdaptiveWorkspaceSnapshot.version)).where(
            AdaptiveWorkspaceSnapshot.session_id == session_id
        )
    )
    return int(current or 0) + 1


def create_snapshot(
    db: Session,
    user_id: str,
    session_id: str,
    workspace_payload: dict[str, Any] | WorkspaceSpec,
    *,
    label: str | None = None,
    apply: bool = True,
) -> AdaptiveWorkspaceSnapshot:
    session = broker_chat.get_owned_session(db, user_id, session_id)
    payload = workspace_spec_dump(workspace_payload) if isinstance(workspace_payload, WorkspaceSpec) else workspace_payload
    spec, validation = parse_spec_or_error(payload)
    if spec is None:
        raise ValueError(json_dumps(validation))
    now = datetime.now(UTC).replace(tzinfo=None)
    row = AdaptiveWorkspaceSnapshot(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user_id,
        version=_next_version(db, session.id),
        label=(label or "Workspace snapshot").strip()[:256] or "Workspace snapshot",
        workspace_payload_json=json_dumps(workspace_spec_dump(spec)),
        validation_json=json_dumps(validation),
        valid=True,
        applied_at=now if apply else None,
        created_at=now,
    )
    db.add(row)
    session.updated_at = now
    db.add(session)
    db.commit()
    db.refresh(row)
    return row


def list_snapshots(db: Session, user_id: str, session_id: str, *, limit: int = 50) -> list[AdaptiveWorkspaceSnapshot]:
    broker_chat.get_owned_session(db, user_id, session_id)
    return list(
        db.scalars(
            select(AdaptiveWorkspaceSnapshot)
            .where(
                AdaptiveWorkspaceSnapshot.session_id == session_id,
                AdaptiveWorkspaceSnapshot.user_id == user_id,
            )
            .order_by(AdaptiveWorkspaceSnapshot.version.desc(), AdaptiveWorkspaceSnapshot.created_at.desc())
            .limit(max(1, min(limit, 200)))
        ).all()
    )


def get_snapshot(db: Session, user_id: str, snapshot_id: str) -> AdaptiveWorkspaceSnapshot:
    row = db.get(AdaptiveWorkspaceSnapshot, snapshot_id)
    if not row or row.user_id != user_id:
        raise ValueError("workspace snapshot not found")
    return row


def get_current_snapshot(db: Session, user_id: str, session_id: str) -> AdaptiveWorkspaceSnapshot | None:
    broker_chat.get_owned_session(db, user_id, session_id)
    applied = db.scalars(
        select(AdaptiveWorkspaceSnapshot)
        .where(
            AdaptiveWorkspaceSnapshot.session_id == session_id,
            AdaptiveWorkspaceSnapshot.user_id == user_id,
            AdaptiveWorkspaceSnapshot.applied_at.is_not(None),
            AdaptiveWorkspaceSnapshot.valid.is_(True),
        )
        .order_by(AdaptiveWorkspaceSnapshot.applied_at.desc(), AdaptiveWorkspaceSnapshot.version.desc())
        .limit(1)
    ).first()
    if applied is not None:
        return applied
    return db.scalars(
        select(AdaptiveWorkspaceSnapshot)
        .where(
            AdaptiveWorkspaceSnapshot.session_id == session_id,
            AdaptiveWorkspaceSnapshot.user_id == user_id,
            AdaptiveWorkspaceSnapshot.valid.is_(True),
        )
        .order_by(AdaptiveWorkspaceSnapshot.version.desc())
        .limit(1)
    ).first()


def apply_snapshot(db: Session, user_id: str, snapshot_id: str) -> AdaptiveWorkspaceSnapshot:
    row = get_snapshot(db, user_id, snapshot_id)
    spec, validation = parse_spec_or_error(json_loads(row.workspace_payload_json, {}))
    if spec is None:
        raise ValueError(json_dumps(validation))
    now = datetime.now(UTC).replace(tzinfo=None)
    row.applied_at = now
    row.valid = True
    row.validation_json = json_dumps(validation)
    session = db.get(BrokerChatSession, row.session_id)
    if session is not None:
        session.updated_at = now
        db.add(session)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def persist_spec(
    db: Session,
    user_id: str,
    session_id: str,
    spec: WorkspaceSpec,
    *,
    label: str,
) -> AdaptiveWorkspaceSnapshot:
    return create_snapshot(db, user_id, session_id, spec, label=label, apply=True)


_INTENT_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("watchlist", ("watchlist", "watchlists", "universe")),
    ("quotes", ("quote", "quotes", "ltp", "live price", "price movement", "price movements", "live prices")),
    ("news", ("news", "headline", "headlines")),
    ("announcements", ("announcement", "filings", "disclosure", "corporate action")),
    ("earnings", ("earning", "results day", "quarterly result")),
    ("concalls", ("concall", "conference call", "earnings call")),
    ("alert_studio", (
        "workflow studio",
        "alert studio",
        "alert workflow studio",
        "deploy alert",
        "simulate alert",
        "workflow graph",
        "approval card",
        "alert-studio",
    )),
    ("sandbox", (
        "payoff",
        "straddle",
        "micro-app",
        "micro app",
        "sandbox",
        "a2ui",
        "ag-ui",
        "agent timeline",
        "research sandbox",
    )),
    ("alerts", ("alert", "alerts", "notification", "notifications")),
    ("holdings", ("holding", "holdings", "portfolio", "funds")),
    ("chart", ("chart", "historical", "ohlc", "candlestick")),
    ("health", ("health", "session status", "broker connection", "login")),
)

_INTENT_TOOLS: dict[str, list[str]] = {
    "watchlist": ["broker_list_watchlists", "broker_get_watchlist_symbols"],
    "quotes": ["broker_get_quotes"],
    "news": ["intel_get_feed"],
    "announcements": ["intel_get_feed"],
    "earnings": ["intel_get_feed"],
    "concalls": ["intel_get_feed"],
    "alert_studio": ["alert_get_studio"],
    "sandbox": ["workspace_get_micro_app"],
    "alerts": ["intel_list_alert_workflows", "intel_list_alert_notifications"],
    "holdings": ["broker_get_portfolio"],
    "chart": ["broker_get_historical"],
    "health": ["broker_get_session_status"],
}

_INTENT_TYPES: dict[str, str] = {
    "watchlist": "watchlist",
    "quotes": "quote-ticker",
    "news": "intel-feed",
    "announcements": "intel-feed",
    "earnings": "intel-feed",
    "concalls": "intel-feed",
    "alert_studio": "alert-rule-draft",
    "sandbox": "micro-app",
    "alerts": "alert-rule-draft",
    "holdings": "holdings-table",
    "chart": "price-chart",
    "health": "broker-health",
}

_FEED_PRODUCTS = {
    "news": "news",
    "announcements": "announcements",
    "earnings": "earnings",
    "concalls": "concalls",
}


def detect_workspace_intents(query: str) -> list[str]:
    text = " ".join((query or "").lower().split())
    found: list[str] = []
    for intent, needles in _INTENT_RULES:
        if any(needle in text for needle in needles):
            found.append(intent)
    if not found:
        found = ["holdings", "health"]
    return found


def evaluate_request(
    query: str,
    *,
    spec: dict[str, Any] | None = None,
    observations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Plan coverage for a desk request and check whether a spec actually complements it."""

    intents = detect_workspace_intents(query)
    text = " ".join((query or "").lower().split())
    last_watchlist = "last watchlist" in text or "my watchlist" in text or "latest watchlist" in text
    longer_horizon = any(token in text for token in ("last week", "past week", "historical", "backtest", "multi-day"))
    observed = observations if isinstance(observations, dict) else {}
    spec_types: list[str] = []
    spec_tools: list[str] = []
    parsed, _validation = parse_spec_or_error(spec) if isinstance(spec, dict) else (None, None)
    if parsed is not None:
        spec_types = [item.type for item in parsed.components]
        spec_tools = [item.data.tool for item in parsed.components if item.data is not None]

    recommended_tools: list[str] = []
    recommended_types: list[str] = []
    plan: list[str] = []
    feed_products: list[str] = []
    for intent in intents:
        for tool in _INTENT_TOOLS.get(intent, []):
            if tool not in recommended_tools:
                recommended_tools.append(tool)
        component_type = _INTENT_TYPES.get(intent)
        if component_type and component_type not in recommended_types:
            recommended_types.append(component_type)
        product = _FEED_PRODUCTS.get(intent)
        if product and product not in feed_products:
            feed_products.append(product)

    if "alert_studio" in intents:
        recommended_tools[:] = [
            tool
            for tool in recommended_tools
            if tool not in {"intel_list_alert_workflows", "intel_list_alert_notifications"}
        ]
        if "alert_get_studio" not in recommended_tools:
            recommended_tools.append("alert_get_studio")
        for component_type in ("alert-rule-draft", "workflow-graph", "workflow-simulation", "approval-card"):
            if component_type not in recommended_types:
                recommended_types.append(component_type)

    if "sandbox" in intents:
        for component_type in ("micro-app", "notes-block", "agent-timeline"):
            if component_type not in recommended_types:
                recommended_types.append(component_type)

    if "watchlist" in intents:
        plan.append("Call broker_list_watchlists, then broker_get_watchlist_symbols on the newest matching list.")
        if last_watchlist:
            plan.append("Use the first returned watchlist (most recently updated) unless the user named one.")
    if "quotes" in intents:
        plan.append("Call broker_get_quotes with those symbols so live LTP and change% fill quote-ticker. Cap at 20 symbols.")
    for product in feed_products or (["news"] if "news" in intents else []):
        plan.append(f"Call intel_get_feed with product={product} and the same symbols.")
    if "alert_studio" in intents:
        plan.append(
            "Call alert_get_studio, then compose alert-rule-draft, workflow-graph, workflow-simulation, and approval-card. Deploy only with confirm=true."
        )
    elif "alerts" in intents:
        plan.append("Call intel_list_alert_workflows and intel_list_alert_notifications (read-only).")
    if "sandbox" in intents:
        plan.append(
            "Call workspace_get_micro_app. Compose micro-app with props.appId from the registry, plus notes-block and agent-timeline. Never emit src, href, or script."
        )
    if "holdings" in intents:
        plan.append("Call broker_get_portfolio with holdings and funds.")
    if "chart" in intents or longer_horizon:
        plan.append("Call broker_get_historical on the top 2-3 symbols for multi-day movement, not only session change%.")
        if "price-chart" not in recommended_types:
            recommended_types.append("price-chart")
        if "broker_get_historical" not in recommended_tools:
            recommended_tools.append("broker_get_historical")
    if "health" in intents:
        plan.append("Call broker_get_session_status for broker-health.")
    plan.append("Call workspace_evaluate_request again with the draft spec and observations before compose_surface.")
    plan.append("compose_surface once with catalog types only. Do not invent types.")

    missing_types = [item for item in recommended_types if item not in spec_types]
    missing_tools = [item for item in recommended_tools if item not in spec_tools]
    notes: list[str] = []
    quote_count = observed.get("quote_count")
    quotes_with_change = observed.get("quotes_with_change_pct")
    news_count = observed.get("news_item_count")
    symbol_count = observed.get("watchlist_symbol_count")
    workflow_count = observed.get("alert_workflow_count")
    notification_count = observed.get("alert_notification_count")

    if "quotes" in intents:
        if isinstance(quote_count, int) and quote_count <= 0:
            notes.append("Quotes intent is unmet: no quote rows. Live price movements will not show.")
        elif isinstance(quotes_with_change, int) and quotes_with_change <= 0 and isinstance(quote_count, int) and quote_count > 0:
            notes.append("Quotes landed without change%. Session movements are not actually visible.")
        elif isinstance(quotes_with_change, int) and quotes_with_change > 0:
            notes.append("Session change% is enough for 'live movements'. Historical is only needed for multi-day asks.")
    if any(intent in intents for intent in ("news", "announcements", "earnings", "concalls")):
        if isinstance(news_count, int) and news_count <= 0:
            notes.append("Intel feed is empty for these symbols. Still compose intel-feed so the gap is visible, and say Alpha cache missed.")
        elif isinstance(news_count, int) and news_count > 0:
            notes.append("News/intel items exist and complement the watchlist universe.")
    if "watchlist" in intents and isinstance(symbol_count, int) and symbol_count <= 0:
        notes.append("Watchlist has no symbols. Do not compose an empty quotes table as if it were the last watchlist.")
    if "alert_studio" in intents:
        notes.append("Studio coverage is draft + graph + simulation + approval-card from alert_get_studio. Deploy only after confirm.")
    elif "alerts" in intents:
        if isinstance(workflow_count, int) and isinstance(notification_count, int) and workflow_count + notification_count <= 0:
            notes.append("No alert workflows or notifications. Compose alert-rule-draft anyway and say none are deployed.")
        elif isinstance(workflow_count, int) or isinstance(notification_count, int):
            notes.append("Alert coverage should list matching workflows/notifications, not invent a new rule.")
    if "sandbox" in intents:
        notes.append("Sandbox coverage is a curated micro-app plus notes and an agent timeline. Do not load arbitrary URLs.")
    if spec is None:
        notes.append("No spec yet. Fetch data first, then evaluate coverage, then compose once.")
    elif missing_types:
        notes.append("Current spec does not cover every requested surface. Fill missing types before compose.")
    else:
        notes.append("Spec types cover the requested intents.")

    complements = not missing_types
    if "quotes" in intents and isinstance(quote_count, int) and quote_count <= 0:
        complements = False
    if "watchlist" in intents and isinstance(symbol_count, int) and symbol_count <= 0:
        complements = False

    return {
        "intents": intents,
        "recommended_tools": recommended_tools,
        "recommended_types": recommended_types,
        "feed_products": feed_products,
        "plan": plan,
        "spec_types": spec_types,
        "spec_tools": spec_tools,
        "missing_from_spec": missing_types,
        "missing_tools_on_spec": missing_tools,
        "complements_query": complements,
        "notes": notes,
        "backtest_lite": {
            "session_move_ok": "quotes" in intents and not longer_horizon,
            "needs_historical": longer_horizon or "chart" in intents,
            "reason": (
                "Use quote change% for same-session movements; use broker_get_historical when the user asks for a longer window."
            ),
        },
    }
