from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from app.schemas.alert import (
    AlertChannelConfigIn,
    AlertChannelOut,
    AlertChannelSelection,
    AlertCondition,
    AlertGraphDsl,
    AlertNotificationOut,
    AlertNotificationTestIn,
    AlertTemplateOut,
    AlertWorkflowCreate,
    AlertWorkflowDsl,
    AlertWorkflowOut,
    AlertWorkflowRunOut,
    AlertWorkflowUpdate,
    InstrumentRef,
    LiveStreamsStatusOut,
    LiveSubscriptionBulkIn,
    LiveSubscriptionCreateIn,
    LiveSubscriptionOut,
    LiveWorkerSessionOut,
)
from broker.core.redis_cache import _redis_client, ping_redis
from broker.crypto import decrypt_value, encrypt_value
from db.models import (
    AlertWorkflow,
    AlertWorkflowRun,
    AlertWorkflowTemplate,
    BrokerAccount,
    LiveSymbolSubscription,
    UserAlertChannel,
    UserAlertChannelDelivery,
    UserAlertNotification,
)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _instrument_ref(ref: dict[str, Any] | None) -> InstrumentRef:
    return InstrumentRef(**(ref or {}))


def _workflow_dsl(payload: dict[str, Any] | None) -> AlertWorkflowDsl:
    return AlertWorkflowDsl(**(payload or {}))


def _graph_dsl(payload: dict[str, Any] | None) -> AlertGraphDsl:
    return AlertGraphDsl(**(payload or {}))


def _channel_selection(payload: dict[str, Any] | None) -> AlertChannelSelection | None:
    if payload is None:
        return None
    return AlertChannelSelection(**payload)


SYSTEM_TEMPLATES: list[dict[str, Any]] = [
    {
        "slug": "price-cross",
        "name": "Price Cross",
        "description": "Alert when price crosses above or below a configured level.",
        "category": "price",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 300,
            "conditions": [{"field": "ltp", "operator": "crosses_above", "value": 3000}],
            "notification": {
                "level": "warning",
                "title_template": "{symbol} crossed price level",
                "message_template": "{symbol} crossed the configured price threshold at {ltp}",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
    {
        "slug": "percent-move-window",
        "name": "Percentage Move In Window",
        "description": "Alert when a symbol moves by a configured percentage within a rolling window.",
        "category": "momentum",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 300,
            "conditions": [{"field": "ltp", "operator": "pct_change_gte", "value": 2, "compare_to": "open"}],
            "notification": {
                "level": "warning",
                "title_template": "{symbol} moved sharply",
                "message_template": "{symbol} moved {change_pct}% from its reference price.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
    {
        "slug": "day-range-breakout",
        "name": "Day High/Low Breakout",
        "description": "Alert when price breaks above day high or below day low.",
        "category": "breakout",
        "workflow_dsl": {
            "combine": "any",
            "cooldown_seconds": 300,
            "conditions": [
                {"field": "ltp", "operator": "gt", "compare_to": "high"},
                {"field": "ltp", "operator": "lt", "compare_to": "low"},
            ],
            "notification": {
                "level": "warning",
                "title_template": "{symbol} broke its day range",
                "message_template": "{symbol} moved outside the current day range.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
    {
        "slug": "volume-spike",
        "name": "Volume Spike",
        "description": "Alert when current volume exceeds a configured threshold.",
        "category": "volume",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 300,
            "conditions": [{"field": "volume", "operator": "gte", "value": 100000}],
            "notification": {
                "level": "info",
                "title_template": "{symbol} volume spike",
                "message_template": "{symbol} volume reached {volume}.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
    {
        "slug": "option-oi-spike",
        "name": "Option OI Spike",
        "description": "Alert when open interest rises over a configured threshold.",
        "category": "options",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 300,
            "conditions": [{"field": "open_interest", "operator": "gte", "value": 10000}],
            "notification": {
                "level": "info",
                "title_template": "{symbol} OI spike",
                "message_template": "{symbol} open interest reached {open_interest}.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
]


def _default_graph_from_dsl(dsl: AlertWorkflowDsl) -> AlertGraphDsl:
    nodes = [
        {"id": "trigger", "kind": "trigger", "label": "Live tick", "config": {"combine": dsl.combine}},
    ]
    edges = []
    for index, condition in enumerate(dsl.conditions, start=1):
        node_id = f"condition-{index}"
        nodes.append(
            {
                "id": node_id,
                "kind": "condition",
                "label": f"{condition.field} {condition.operator}",
                "config": condition.model_dump(exclude_none=True),
            }
        )
        edges.append({"source": "trigger", "target": node_id})
    nodes.append(
        {
            "id": "notification",
            "kind": "notification",
            "label": "Notify",
            "config": dsl.notification.model_dump(),
        }
    )
    source_nodes = [node["id"] for node in nodes if node["kind"] == "condition"] or ["trigger"]
    for node_id in source_nodes:
        edges.append({"source": node_id, "target": "notification"})
    nodes.append(
        {
            "id": "channels",
            "kind": "channel",
            "label": "Channels",
            "config": dsl.channels.model_dump(),
        }
    )
    edges.append({"source": "notification", "target": "channels"})
    return AlertGraphDsl(nodes=nodes, edges=edges)


def ensure_system_templates(db: Session) -> None:
    existing = {row.slug: row for row in db.scalars(select(AlertWorkflowTemplate)).all()}
    changed = False
    for payload in SYSTEM_TEMPLATES:
        row = existing.get(payload["slug"])
        workflow_dsl = AlertWorkflowDsl(**payload["workflow_dsl"])
        graph_dsl = _default_graph_from_dsl(workflow_dsl)
        if row is None:
            db.add(
                AlertWorkflowTemplate(
                    id=str(uuid.uuid4()),
                    slug=payload["slug"],
                    name=payload["name"],
                    description=payload["description"],
                    category=payload["category"],
                    workflow_dsl_json=_json_dumps(workflow_dsl.model_dump()),
                    graph_dsl_json=_json_dumps(graph_dsl.model_dump()),
                    is_active=True,
                )
            )
            changed = True
            continue
        if row.name != payload["name"] or row.description != payload["description"] or row.category != payload["category"]:
            row.name = payload["name"]
            row.description = payload["description"]
            row.category = payload["category"]
            row.workflow_dsl_json = _json_dumps(workflow_dsl.model_dump())
            row.graph_dsl_json = _json_dumps(graph_dsl.model_dump())
            row.is_active = True
            db.add(row)
            changed = True
    if changed:
        db.commit()


def _template_to_out(row: AlertWorkflowTemplate) -> AlertTemplateOut:
    return AlertTemplateOut(
        id=row.id,
        slug=row.slug,
        name=row.name,
        description=row.description,
        category=row.category,
        workflow_dsl=_workflow_dsl(_json_loads(row.workflow_dsl_json, {})),
        graph_dsl=_graph_dsl(_json_loads(row.graph_dsl_json, {})),
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_templates(db: Session) -> list[AlertTemplateOut]:
    ensure_system_templates(db)
    rows = db.scalars(select(AlertWorkflowTemplate).order_by(AlertWorkflowTemplate.name.asc())).all()
    return [_template_to_out(row) for row in rows]


def get_template(db: Session, template_id: str) -> AlertTemplateOut | None:
    ensure_system_templates(db)
    row = db.get(AlertWorkflowTemplate, template_id)
    return _template_to_out(row) if row else None


def _workflow_to_out(row: AlertWorkflow) -> AlertWorkflowOut:
    return AlertWorkflowOut(
        id=row.id,
        user_id=row.user_id,
        template_id=row.template_id,
        account_id=row.account_id,
        broker_code=row.broker_code,
        name=row.name,
        description=row.description,
        symbol=row.symbol,
        exchange=row.exchange,
        instrument_ref=_instrument_ref(_json_loads(row.instrument_ref_json, {})),
        workflow_dsl=_workflow_dsl(_json_loads(row.workflow_dsl_json, {})),
        graph_dsl=_graph_dsl(_json_loads(row.graph_dsl_json, {})),
        editor_mode=row.editor_mode,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        channel_override=_channel_selection(_json_loads(row.channel_override_json, None)),
        last_triggered_at=row.last_triggered_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_workflows(db: Session, user_id: str, *, status: str | None = None) -> list[AlertWorkflowOut]:
    ensure_system_templates(db)
    stmt = select(AlertWorkflow).where(AlertWorkflow.user_id == user_id)
    if status:
        stmt = stmt.where(AlertWorkflow.status == status)
    rows = db.scalars(stmt.order_by(AlertWorkflow.updated_at.desc())).all()
    return [_workflow_to_out(row) for row in rows]


def get_workflow(db: Session, user_id: str, workflow_id: str) -> AlertWorkflowOut | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    return _workflow_to_out(row)


def _persist_workflow(
    row: AlertWorkflow,
    payload: AlertWorkflowCreate | AlertWorkflowUpdate,
) -> AlertWorkflow:
    if getattr(payload, "name", None) is not None:
        row.name = getattr(payload, "name")
    if getattr(payload, "description", None) is not None:
        row.description = getattr(payload, "description") or ""
    if getattr(payload, "account_id", None) is not None:
        row.account_id = getattr(payload, "account_id")
    if getattr(payload, "broker_code", None) is not None:
        row.broker_code = getattr(payload, "broker_code")
    if getattr(payload, "symbol", None) is not None:
        row.symbol = getattr(payload, "symbol")
    if getattr(payload, "exchange", None) is not None:
        row.exchange = getattr(payload, "exchange")
    instrument_ref = getattr(payload, "instrument_ref", None)
    if instrument_ref is not None:
        row.instrument_ref_json = _json_dumps(instrument_ref.model_dump(exclude_none=True))
    workflow_dsl = getattr(payload, "workflow_dsl", None)
    if workflow_dsl is not None:
        row.workflow_dsl_json = _json_dumps(workflow_dsl.model_dump())
    graph_dsl = getattr(payload, "graph_dsl", None)
    if graph_dsl is not None:
        row.graph_dsl_json = _json_dumps(graph_dsl.model_dump())
    editor_mode = getattr(payload, "editor_mode", None)
    if editor_mode is not None:
        row.editor_mode = editor_mode
    channel_override = getattr(payload, "channel_override", None)
    if channel_override is not None:
        row.channel_override_json = _json_dumps(channel_override.model_dump())
    status = getattr(payload, "status", None)
    if status is not None:
        row.status = status
    return row


def create_workflow(db: Session, user_id: str, payload: AlertWorkflowCreate) -> AlertWorkflowOut:
    graph = payload.graph_dsl if payload.graph_dsl.nodes else _default_graph_from_dsl(payload.workflow_dsl)
    row = AlertWorkflow(
        id=str(uuid.uuid4()),
        user_id=user_id,
        template_id=payload.template_id,
        name=payload.name,
        description=payload.description,
        account_id=payload.account_id,
        broker_code=payload.broker_code,
        symbol=payload.symbol,
        exchange=payload.exchange,
        instrument_ref_json=_json_dumps(payload.instrument_ref.model_dump(exclude_none=True)),
        workflow_dsl_json=_json_dumps(payload.workflow_dsl.model_dump()),
        graph_dsl_json=_json_dumps(graph.model_dump()),
        editor_mode=payload.editor_mode,
        status="active",
        channel_override_json=_json_dumps(payload.channel_override.model_dump()) if payload.channel_override else "null",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    if row.symbol:
        ensure_symbol_subscription(
            db,
            user_id,
            LiveSubscriptionCreateIn(
                account_id=row.account_id,
                broker_code=row.broker_code,
                workflow_id=row.id,
                symbol=row.symbol,
                exchange=row.exchange,
                instrument_ref=payload.instrument_ref,
                source_kind="workflow",
            ),
        )
    return _workflow_to_out(row)


def update_workflow(db: Session, user_id: str, workflow_id: str, payload: AlertWorkflowUpdate) -> AlertWorkflowOut | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    _persist_workflow(row, payload)
    if payload.workflow_dsl is not None and payload.graph_dsl is None:
        row.graph_dsl_json = _json_dumps(_default_graph_from_dsl(payload.workflow_dsl).model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _workflow_to_out(row)


def delete_workflow(db: Session, user_id: str, workflow_id: str) -> bool:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return False
    db.delete(row)
    db.commit()
    return True


def set_workflow_status(db: Session, user_id: str, workflow_id: str, status: str) -> AlertWorkflowOut | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    row.status = status
    db.add(row)
    db.commit()
    db.refresh(row)
    return _workflow_to_out(row)


def duplicate_workflow(db: Session, user_id: str, workflow_id: str) -> AlertWorkflowOut | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    payload = AlertWorkflowCreate(
        template_id=row.template_id,
        name=f"{row.name} copy",
        description=row.description,
        account_id=row.account_id,
        broker_code=row.broker_code,
        symbol=row.symbol,
        exchange=row.exchange,
        instrument_ref=_instrument_ref(_json_loads(row.instrument_ref_json, {})),
        workflow_dsl=_workflow_dsl(_json_loads(row.workflow_dsl_json, {})),
        graph_dsl=_graph_dsl(_json_loads(row.graph_dsl_json, {})),
        editor_mode=row.editor_mode,  # type: ignore[arg-type]
        channel_override=_channel_selection(_json_loads(row.channel_override_json, None)),
    )
    return create_workflow(db, user_id, payload)


def instantiate_template(db: Session, user_id: str, template_id: str, payload: dict[str, Any]) -> AlertWorkflowOut:
    ensure_system_templates(db)
    template = db.get(AlertWorkflowTemplate, template_id)
    if not template:
        raise ValueError("template not found")
    base_dsl = _workflow_dsl(_json_loads(template.workflow_dsl_json, {}))
    base_graph = _graph_dsl(_json_loads(template.graph_dsl_json, {}))
    create_payload = AlertWorkflowCreate(
        template_id=template.id,
        name=str(payload.get("name") or template.name),
        description=template.description,
        account_id=payload.get("account_id"),
        broker_code=payload.get("broker_code"),
        symbol=payload.get("symbol"),
        exchange=payload.get("exchange"),
        instrument_ref=InstrumentRef(**(payload.get("instrument_ref") or {})),
        workflow_dsl=base_dsl,
        graph_dsl=base_graph,
        editor_mode="rule",
    )
    return create_workflow(db, user_id, create_payload)


def _render_message(template: str, context: dict[str, Any]) -> str:
    safe_context = {key: value for key, value in context.items() if value is not None}
    try:
        return template.format(**safe_context)
    except Exception:
        return template


def _condition_value(condition: AlertCondition, tick: dict[str, Any], previous_tick: dict[str, Any]) -> tuple[float | None, float | None]:
    current = tick.get(condition.field)
    if condition.compare_to:
        reference = tick.get(condition.compare_to)
    else:
        reference = previous_tick.get(condition.field)
    try:
        return float(current), float(reference) if reference is not None else None
    except Exception:
        return None, None


def evaluate_workflow_payload(
    workflow: AlertWorkflowOut,
    tick: dict[str, Any],
    previous_tick: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    previous = previous_tick or {}
    results: list[bool] = []
    reasons: list[str] = []
    for condition in workflow.workflow_dsl.conditions:
        current, reference = _condition_value(condition, tick, previous)
        matched = False
        operator = condition.operator
        value = condition.value
        if operator == "gt" and current is not None:
            matched = current > float(value or 0)
        elif operator == "gte" and current is not None:
            matched = current >= float(value or 0)
        elif operator == "lt" and current is not None:
            matched = current < float(value or 0)
        elif operator == "lte" and current is not None:
            matched = current <= float(value or 0)
        elif operator == "crosses_above" and current is not None:
            previous_value = previous.get(condition.field)
            try:
                matched = float(previous_value or 0) < float(value or 0) <= current
            except Exception:
                matched = False
        elif operator == "crosses_below" and current is not None:
            previous_value = previous.get(condition.field)
            try:
                matched = float(previous_value or 0) > float(value or 0) >= current
            except Exception:
                matched = False
        elif operator == "pct_change_gte" and current is not None and reference not in (None, 0):
            matched = ((current - reference) / reference) * 100 >= float(value or 0)
        elif operator == "pct_change_lte" and current is not None and reference not in (None, 0):
            matched = ((current - reference) / reference) * 100 <= float(value or 0)
        if matched:
            reasons.append(f"{condition.field} {operator}")
        results.append(matched)
    final_match = all(results) if workflow.workflow_dsl.combine == "all" else any(results)
    return final_match, ", ".join(reasons) or "no conditions matched"


def list_workflow_runs(
    db: Session,
    user_id: str,
    *,
    workflow_id: str | None = None,
    limit: int = 50,
) -> list[AlertWorkflowRunOut]:
    stmt = select(AlertWorkflowRun).join(AlertWorkflow, AlertWorkflow.id == AlertWorkflowRun.workflow_id)
    stmt = stmt.where(AlertWorkflow.user_id == user_id)
    if workflow_id:
        stmt = stmt.where(AlertWorkflowRun.workflow_id == workflow_id)
    rows = db.scalars(stmt.order_by(AlertWorkflowRun.created_at.desc()).limit(limit)).all()
    return [
        AlertWorkflowRunOut(
            id=row.id,
            workflow_id=row.workflow_id,
            notification_id=row.notification_id,
            matched=row.matched,
            reason=row.reason,
            rendered_title=row.rendered_title,
            rendered_message=row.rendered_message,
            channels=_json_loads(row.channels_json, []),
            tick=_json_loads(row.tick_json, {}),
            evaluation_payload=_json_loads(row.evaluation_payload_json, {}),
            created_at=row.created_at,
        )
        for row in rows
    ]


def _channel_config_payload(row: UserAlertChannel) -> dict[str, Any]:
    if not row.config_cipher:
        return {}
    try:
        return _json_loads(decrypt_value(row.config_cipher), {})
    except Exception:
        return {}


def list_channels(db: Session, user_id: str) -> list[AlertChannelOut]:
    rows = db.scalars(
        select(UserAlertChannel)
        .where(UserAlertChannel.user_id == user_id)
        .order_by(UserAlertChannel.channel_type.asc(), UserAlertChannel.created_at.asc())
    ).all()
    return [
        AlertChannelOut(
            id=row.id,
            channel_type=row.channel_type,  # type: ignore[arg-type]
            label=row.label,
            is_enabled=row.is_enabled,
            is_default=row.is_default,
            config=_channel_config_payload(row),
            last_tested_at=row.last_tested_at,
            last_error=row.last_error,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


def save_channel(
    db: Session,
    user_id: str,
    channel_type: str,
    payload: AlertChannelConfigIn,
) -> AlertChannelOut:
    row = db.scalars(
        select(UserAlertChannel)
        .where(UserAlertChannel.user_id == user_id, UserAlertChannel.channel_type == channel_type)
        .limit(1)
    ).first()
    if row is None:
        row = UserAlertChannel(id=str(uuid.uuid4()), user_id=user_id, channel_type=channel_type)
    row.label = payload.label or channel_type.replace("_", " ").title()
    row.is_enabled = payload.is_enabled
    row.is_default = payload.is_default
    row.config_cipher = encrypt_value(_json_dumps(payload.config))
    row.last_error = None
    db.add(row)
    db.commit()
    db.refresh(row)
    return AlertChannelOut(
        id=row.id,
        channel_type=row.channel_type,  # type: ignore[arg-type]
        label=row.label,
        is_enabled=row.is_enabled,
        is_default=row.is_default,
        config=payload.config,
        last_tested_at=row.last_tested_at,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _channel_targets(
    db: Session,
    user_id: str,
    override: AlertChannelSelection | None,
) -> list[UserAlertChannel]:
    rows = db.scalars(
        select(UserAlertChannel).where(UserAlertChannel.user_id == user_id, UserAlertChannel.is_enabled.is_(True))
    ).all()
    if override and not override.inherit_defaults:
        wanted = set(override.enabled)
        return [row for row in rows if row.channel_type in wanted]
    if override and override.enabled:
        wanted = set(override.enabled)
        return [row for row in rows if row.is_default or row.channel_type in wanted]
    return [row for row in rows if row.is_default]


def create_alert_notification(
    db: Session,
    *,
    user_id: str,
    workflow: AlertWorkflowOut | None,
    title: str,
    message: str,
    level: str,
    channels: list[str],
    payload: dict[str, Any],
    dedupe_key: str | None = None,
) -> AlertNotificationOut:
    row = UserAlertNotification(
        id=str(uuid.uuid4()),
        user_id=user_id,
        workflow_id=workflow.id if workflow else None,
        template_id=workflow.template_id if workflow else None,
        account_id=workflow.account_id if workflow else None,
        broker_code=workflow.broker_code if workflow else None,
        symbol=workflow.symbol if workflow else None,
        exchange=workflow.exchange if workflow else None,
        level=level,
        title=title,
        message=message,
        status="new",
        channels_json=_json_dumps(channels),
        payload_json=_json_dumps(payload),
        dedupe_key=dedupe_key,
    )
    db.add(row)
    db.flush()
    for channel_type in channels:
        db.add(
            UserAlertChannelDelivery(
                id=str(uuid.uuid4()),
                notification_id=row.id,
                channel_type=channel_type,
                status="delivered" if channel_type == "in_app" else "pending",
                delivered_at=_now() if channel_type == "in_app" else None,
                payload_json=_json_dumps(payload),
            )
        )
    db.commit()
    db.refresh(row)
    return AlertNotificationOut(
        id=row.id,
        user_id=row.user_id,
        workflow_id=row.workflow_id,
        template_id=row.template_id,
        account_id=row.account_id,
        broker_code=row.broker_code,
        symbol=row.symbol,
        exchange=row.exchange,
        level=row.level,
        title=row.title,
        message=row.message,
        status=row.status,
        channels=_json_loads(row.channels_json, []),
        payload=_json_loads(row.payload_json, {}),
        dedupe_key=row.dedupe_key,
        is_read=row.is_read,
        created_at=row.created_at,
        read_at=row.read_at,
    )


def list_alert_notifications(
    db: Session,
    user_id: str,
    *,
    workflow_id: str | None = None,
    since: datetime | None = None,
    unread_only: bool = False,
    limit: int = 100,
) -> list[AlertNotificationOut]:
    stmt = select(UserAlertNotification).where(UserAlertNotification.user_id == user_id)
    if workflow_id:
        stmt = stmt.where(UserAlertNotification.workflow_id == workflow_id)
    if since:
        stmt = stmt.where(UserAlertNotification.created_at >= since)
    if unread_only:
        stmt = stmt.where(UserAlertNotification.is_read.is_(False))
    rows = db.scalars(stmt.order_by(UserAlertNotification.created_at.desc()).limit(limit)).all()
    return [
        AlertNotificationOut(
            id=row.id,
            user_id=row.user_id,
            workflow_id=row.workflow_id,
            template_id=row.template_id,
            account_id=row.account_id,
            broker_code=row.broker_code,
            symbol=row.symbol,
            exchange=row.exchange,
            level=row.level,
            title=row.title,
            message=row.message,
            status=row.status,
            channels=_json_loads(row.channels_json, []),
            payload=_json_loads(row.payload_json, {}),
            dedupe_key=row.dedupe_key,
            is_read=row.is_read,
            created_at=row.created_at,
            read_at=row.read_at,
        )
        for row in rows
    ]


def unread_alert_count(db: Session, user_id: str) -> int:
    return len(
        list(
            db.scalars(
                select(UserAlertNotification.id).where(
                    UserAlertNotification.user_id == user_id,
                    UserAlertNotification.is_read.is_(False),
                )
            ).all()
        )
    )


def mark_alert_notification_read(db: Session, user_id: str, notification_id: str) -> AlertNotificationOut | None:
    row = db.get(UserAlertNotification, notification_id)
    if not row or row.user_id != user_id:
        return None
    row.is_read = True
    row.status = "read"
    row.read_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return list_alert_notifications(db, user_id, limit=1, since=row.created_at)[0]


def read_all_alert_notifications(db: Session, user_id: str) -> int:
    rows = db.scalars(
        select(UserAlertNotification).where(
            UserAlertNotification.user_id == user_id,
            UserAlertNotification.is_read.is_(False),
        )
    ).all()
    for row in rows:
        row.is_read = True
        row.status = "read"
        row.read_at = _now()
        db.add(row)
    db.commit()
    return len(rows)


def create_test_alert_notification(db: Session, user_id: str, payload: AlertNotificationTestIn) -> AlertNotificationOut:
    return create_alert_notification(
        db,
        user_id=user_id,
        workflow=None,
        title=payload.title,
        message=payload.message,
        level=payload.level,
        channels=payload.channels,
        payload={"test": True},
    )


def _discord_test_message(webhook_url: str, message: str) -> tuple[bool, str]:
    try:
        response = httpx.post(webhook_url, json={"content": message}, timeout=10)
        if response.status_code >= 400:
            return False, response.text[:1000]
        return True, ""
    except Exception as exc:
        return False, str(exc)


def _telegram_test_message(bot_token: str, chat_id: str, message: str) -> tuple[bool, str]:
    try:
        response = httpx.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": message},
            timeout=10,
        )
        if response.status_code >= 400:
            return False, response.text[:1000]
        return True, ""
    except Exception as exc:
        return False, str(exc)


def test_channel(db: Session, user_id: str, channel_type: str, message: str) -> AlertChannelOut | None:
    row = db.scalars(
        select(UserAlertChannel)
        .where(UserAlertChannel.user_id == user_id, UserAlertChannel.channel_type == channel_type)
        .limit(1)
    ).first()
    if row is None:
        return None
    config = _channel_config_payload(row)
    ok = True
    error = ""
    if channel_type == "discord":
        ok, error = _discord_test_message(str(config.get("webhook_url") or ""), message)
    elif channel_type == "telegram":
        ok, error = _telegram_test_message(
            str(config.get("bot_token") or ""),
            str(config.get("chat_id") or ""),
            message,
        )
    row.last_tested_at = _now()
    row.last_error = None if ok else error
    db.add(row)
    db.commit()
    db.refresh(row)
    return AlertChannelOut(
        id=row.id,
        channel_type=row.channel_type,  # type: ignore[arg-type]
        label=row.label,
        is_enabled=row.is_enabled,
        is_default=row.is_default,
        config=config,
        last_tested_at=row.last_tested_at,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _subscription_to_out(row: LiveSymbolSubscription) -> LiveSubscriptionOut:
    return LiveSubscriptionOut(
        id=row.id,
        user_id=row.user_id,
        workflow_id=row.workflow_id,
        account_id=row.account_id,
        broker_code=row.broker_code,
        symbol=row.symbol,
        exchange=row.exchange,
        instrument_ref=_instrument_ref(_json_loads(row.instrument_ref_json, {})),
        source_kind=row.source_kind,
        status=row.status,
        last_quote=_json_loads(row.last_quote_json, {}),
        last_received_at=row.last_received_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _normalize_symbol(value: str | None) -> str:
    return (value or "").strip().upper()


def list_subscriptions(db: Session, user_id: str) -> list[LiveSubscriptionOut]:
    rows = db.scalars(
        select(LiveSymbolSubscription)
        .where(LiveSymbolSubscription.user_id == user_id)
        .order_by(LiveSymbolSubscription.updated_at.desc())
    ).all()
    return [_subscription_to_out(row) for row in rows]


def ensure_symbol_subscription(db: Session, user_id: str, payload: LiveSubscriptionCreateIn) -> LiveSubscriptionOut:
    payload.symbol = _normalize_symbol(payload.symbol)
    payload.exchange = (payload.exchange or "").strip().upper() or None
    if payload.instrument_ref.symbol is None and payload.symbol:
        payload.instrument_ref.symbol = payload.symbol
    if payload.instrument_ref.exchange is None and payload.exchange:
        payload.instrument_ref.exchange = payload.exchange
    stmt = select(LiveSymbolSubscription).where(
        LiveSymbolSubscription.user_id == user_id,
        LiveSymbolSubscription.account_id == payload.account_id,
        LiveSymbolSubscription.workflow_id == payload.workflow_id,
        LiveSymbolSubscription.symbol == payload.symbol,
        LiveSymbolSubscription.exchange == payload.exchange,
    )
    row = db.scalars(stmt.limit(1)).first()
    if row is None:
        row = LiveSymbolSubscription(
            id=str(uuid.uuid4()),
            user_id=user_id,
            workflow_id=payload.workflow_id,
            account_id=payload.account_id,
            broker_code=payload.broker_code,
            symbol=payload.symbol,
            exchange=payload.exchange,
            source_kind=payload.source_kind,
        )
    row.instrument_ref_json = _json_dumps(payload.instrument_ref.model_dump(exclude_none=True))
    row.broker_code = payload.broker_code
    row.status = "active"
    db.add(row)
    db.commit()
    db.refresh(row)
    return _subscription_to_out(row)


def ensure_symbol_subscriptions(
    db: Session, user_id: str, payloads: list[LiveSubscriptionCreateIn]
) -> list[LiveSubscriptionOut]:
    seen: set[tuple[str | None, str | None, str | None, str, str | None]] = set()
    results: list[LiveSubscriptionOut] = []
    for item in payloads:
        item.symbol = _normalize_symbol(item.symbol)
        item.exchange = (item.exchange or "").strip().upper() or None
        key = (item.account_id, item.workflow_id, item.broker_code, item.symbol, item.exchange)
        if not item.symbol or key in seen:
            continue
        seen.add(key)
        results.append(ensure_symbol_subscription(db, user_id, item))
    return results


def remove_subscription(db: Session, user_id: str, subscription_id: str) -> bool:
    row = db.get(LiveSymbolSubscription, subscription_id)
    if not row or row.user_id != user_id:
        return False
    db.delete(row)
    db.commit()
    return True


def remove_subscriptions(db: Session, user_id: str, subscription_ids: list[str]) -> int:
    ids = [item for item in subscription_ids if item]
    if not ids:
        return 0
    rows = db.scalars(
        select(LiveSymbolSubscription).where(
            LiveSymbolSubscription.user_id == user_id,
            LiveSymbolSubscription.id.in_(ids),
        )
    ).all()
    for row in rows:
        db.delete(row)
    db.commit()
    return len(rows)


def replace_subscriptions(db: Session, user_id: str, subscriptions: list[LiveSubscriptionCreateIn]) -> list[LiveSubscriptionOut]:
    db.execute(delete(LiveSymbolSubscription).where(LiveSymbolSubscription.user_id == user_id, LiveSymbolSubscription.source_kind == "manual"))
    db.commit()
    return ensure_symbol_subscriptions(db, user_id, subscriptions)


def _chunk_sessions(
    rows: list[LiveSubscriptionOut],
    user_id: str,
    activity_index: dict[tuple[str, str, int], LiveWorkerSessionOut],
) -> list[LiveWorkerSessionOut]:
    grouped: dict[tuple[str, str], list[LiveSubscriptionOut]] = {}
    for row in rows:
        if not row.account_id or not row.broker_code or row.status != "active":
            continue
        grouped.setdefault((row.account_id, row.broker_code), []).append(row)

    sessions: list[LiveWorkerSessionOut] = []
    for (account_id, broker_code), subscriptions in grouped.items():
        ordered = sorted(subscriptions, key=lambda item: (item.exchange or "", item.symbol))
        for index, start in enumerate(range(0, len(ordered), 1000), start=1):
            chunk = ordered[start : start + 1000]
            activity = activity_index.get((account_id, broker_code, index))
            sessions.append(
                LiveWorkerSessionOut(
                    broker_code=broker_code,
                    account_id=account_id,
                    user_id=user_id,
                    adapter=activity.adapter if activity else "polling",
                    connected=activity.connected if activity else False,
                    connection_id=f"{broker_code}:{account_id}:{index}",
                    connection_index=index,
                    symbol_count=len(chunk),
                    capacity=1000,
                    symbols=[item.symbol for item in chunk],
                    last_seen_at=activity.last_seen_at if activity else None,
                )
            )
    return sessions


def live_stream_status(db: Session, user_id: str) -> LiveStreamsStatusOut:
    ok, error = ping_redis()
    activity_sessions: list[LiveWorkerSessionOut] = []
    client = _redis_client()
    if client:
        try:
            for key in client.scan_iter(match=f"alert-live:session:{user_id}:*"):
                payload = _json_loads(client.get(key), {})
                if not payload:
                    continue
                connection_index = int(payload.get("connection_index") or 1)
                activity_sessions.append(
                    LiveWorkerSessionOut(
                        broker_code=str(payload.get("broker_code") or ""),
                        account_id=str(payload.get("account_id") or ""),
                        user_id=str(payload.get("user_id") or user_id),
                        adapter=str(payload.get("adapter") or "polling"),
                        connected=bool(payload.get("connected")),
                        connection_id=str(payload.get("connection_id") or "") or None,
                        connection_index=connection_index,
                        symbol_count=int(payload.get("symbol_count") or len(list(payload.get("symbols") or []))),
                        capacity=int(payload.get("capacity") or 1000),
                        symbols=list(payload.get("symbols") or []),
                        last_seen_at=datetime.fromisoformat(payload["last_seen_at"]) if payload.get("last_seen_at") else None,
                    )
                )
        except Exception:
            activity_sessions = []
    desired = list_subscriptions(db, user_id)
    activity_index = {
        (session.account_id, session.broker_code, session.connection_index): session
        for session in activity_sessions
        if session.account_id and session.broker_code
    }
    sessions = _chunk_sessions(desired, user_id, activity_index)
    return LiveStreamsStatusOut(
        redis_ok=ok,
        redis_error=error,
        worker_mode="redis-polling-live-data",
        active_sessions=sessions,
        desired_subscriptions=desired,
    )


def queue_delivery_for_pending_channels(db: Session, notification: UserAlertNotification) -> None:
    _ = db
    _ = notification


def deliver_pending_notifications(db: Session, *, limit: int = 50) -> int:
    deliveries = db.scalars(
        select(UserAlertChannelDelivery)
        .where(UserAlertChannelDelivery.status == "pending")
        .order_by(UserAlertChannelDelivery.created_at.asc())
        .limit(limit)
    ).all()
    sent = 0
    for delivery in deliveries:
        notification = db.get(UserAlertNotification, delivery.notification_id)
        channel = db.get(UserAlertChannel, delivery.channel_id) if delivery.channel_id else None
        config = _channel_config_payload(channel) if channel else {}
        payload = _json_loads(delivery.payload_json, {})
        message = str(payload.get("message") or notification.message if notification else "")
        ok = True
        error = ""
        if delivery.channel_type == "discord":
            ok, error = _discord_test_message(str(config.get("webhook_url") or ""), message)
        elif delivery.channel_type == "telegram":
            ok, error = _telegram_test_message(str(config.get("bot_token") or ""), str(config.get("chat_id") or ""), message)
        delivery.attempt_count += 1
        delivery.status = "delivered" if ok else "failed"
        delivery.last_error = None if ok else error
        delivery.delivered_at = _now() if ok else None
        db.add(delivery)
        sent += 1 if ok else 0
    db.commit()
    return sent
