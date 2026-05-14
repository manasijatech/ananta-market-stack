from __future__ import annotations

import html
import json
import queue
import threading
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import delete, desc, func, select
from sqlalchemy.orm import Session

from app.schemas.alert import (
    AlertChannelConfigIn,
    AlertChannelOut,
    AlertChannelSelection,
    AlertCondition,
    AlertGraphDsl,
    AlertNotificationOut,
    AlertTargetEntry,
    AlertNotificationTestIn,
    AlertTemplateOut,
    AlertWorkflowCreate,
    AlertWorkflowDsl,
    AlertWorkflowOut,
    AlertWorkflowTargeting,
    AlertWorkflowRunOut,
    AlertWorkflowUpdate,
    InstrumentRef,
    LiveBrokerAccountStatusOut,
    LiveStreamsStatusOut,
    LiveSubscriptionBulkIn,
    LiveSubscriptionCreateIn,
    LiveSubscriptionOut,
    LiveWorkerSessionOut,
)
from app.services.alerts_engine.ast import AlertUniverseNode, ast_to_dict, ensure_workflow_ast
from app.services.alerts_engine.compiler import compile_workflow_dsl
from app.services.alerts_engine.conditions import ConditionEvaluation, condition_registry_payload, evaluate_logic
from app.services.alerts_engine.explain import explain_ast
from app.services.alerts_engine.reconcile import reconcile_user_subscriptions
from app.services.alerts_engine.samples import sample_alerts_for_ast
from app.services.alerts_engine.universes import list_presets, resolve_universe
from app.services.alert_llm_analysis import run_workflow_llm_analysis
from app.services.alert_llm_context import (
    default_prompt_template,
    placeholder_catalog,
    prompt_placeholders_from_config,
    resolve_llm_context,
)
from app.services import broker_sessions as broker_session_svc
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
ALERT_NOTIFICATION_STREAM_MAXLEN = 2000


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


def _alert_notification_stream(user_id: str) -> str:
    return f"alert:notifications:{user_id}"


def _ping_redis_with_timeout(timeout_seconds: float = 2.0) -> tuple[bool, str]:
    result_queue: queue.Queue[tuple[bool, str]] = queue.Queue(maxsize=1)

    def run_ping() -> None:
        try:
            result_queue.put(ping_redis(), block=False)
        except Exception as exc:
            result_queue.put((False, str(exc)), block=False)

    thread = threading.Thread(target=run_ping, daemon=True)
    thread.start()
    try:
        return result_queue.get(timeout=timeout_seconds)
    except queue.Empty:
        return False, "redis ping timed out"


def _instrument_ref(ref: dict[str, Any] | None) -> InstrumentRef:
    return InstrumentRef(**(ref or {}))


def _workflow_dsl(payload: dict[str, Any] | None) -> AlertWorkflowDsl:
    dsl = AlertWorkflowDsl(**(payload or {}))
    if dsl.workflow_ast is None:
        dsl.workflow_ast = ast_to_dict(ensure_workflow_ast(dsl))
    if not dsl.compiled_summary:
        try:
            compiled = compile_workflow_dsl(dsl)
            dsl.compiled_summary = compiled["compiled_summary"]
            dsl.validation_status = "valid" if compiled["valid"] else "invalid"
        except Exception:
            dsl.validation_status = "invalid"
    return dsl


def _graph_dsl(payload: dict[str, Any] | None) -> AlertGraphDsl:
    return AlertGraphDsl(**(payload or {}))


def _channel_selection(payload: dict[str, Any] | None) -> AlertChannelSelection | None:
    if payload is None:
        return None
    return AlertChannelSelection(**payload)


def _normalize_target_entry(
    symbol: str | None,
    exchange: str | None,
    instrument_ref: InstrumentRef | dict[str, Any] | None = None,
    *,
    label: str | None = None,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> AlertTargetEntry | None:
    normalized_symbol = (symbol or "").strip().upper()
    if not normalized_symbol:
        return None
    normalized_exchange = (exchange or "").strip().upper() or None
    ref = instrument_ref if isinstance(instrument_ref, InstrumentRef) else InstrumentRef(**(instrument_ref or {}))
    if ref.symbol is None:
        ref.symbol = normalized_symbol
    if ref.exchange is None and normalized_exchange:
        ref.exchange = normalized_exchange
    return AlertTargetEntry(
        symbol=normalized_symbol,
        exchange=normalized_exchange,
        instrument_ref=ref,
        label=label,
        tags=tags or [],
        metadata=metadata or {},
    )


def _default_targeting(
    symbol: str | None,
    exchange: str | None,
    instrument_ref: InstrumentRef | dict[str, Any] | None = None,
) -> AlertWorkflowTargeting:
    entry = _normalize_target_entry(symbol, exchange, instrument_ref)
    return AlertWorkflowTargeting(mode="single_symbol", entries=[entry] if entry else [])


def _normalize_targeting(targeting: AlertWorkflowTargeting | dict[str, Any] | None) -> AlertWorkflowTargeting:
    raw = targeting if isinstance(targeting, AlertWorkflowTargeting) else AlertWorkflowTargeting(**(targeting or {}))
    entries: list[AlertTargetEntry] = []
    seen: set[tuple[str, str | None]] = set()
    for item in raw.entries:
        entry = _normalize_target_entry(
            item.symbol,
            item.exchange,
            item.instrument_ref,
            label=item.label,
            tags=item.tags,
            metadata=item.metadata,
        )
        if not entry:
            continue
        key = (entry.symbol, entry.exchange)
        if key in seen:
            continue
        seen.add(key)
        entries.append(entry)
    mode = raw.mode
    if mode == "single_symbol" and len(entries) > 1:
        entries = entries[:1]
    return AlertWorkflowTargeting(
        mode=mode,
        entries=entries,
        preset_id=raw.preset_id,
        preset_label=raw.preset_label,
        filters=raw.filters,
    )


def _workflow_targeting_for_row(row: AlertWorkflow) -> AlertWorkflowTargeting:
    dsl_payload = _json_loads(row.workflow_dsl_json, {})
    targeting_payload = dsl_payload.get("targeting") if isinstance(dsl_payload, dict) else None
    fallback_ref = _json_loads(row.instrument_ref_json, {})
    targeting = _normalize_targeting(targeting_payload)
    if targeting.entries:
        return targeting
    return _default_targeting(row.symbol, row.exchange, fallback_ref)


def _targeting_entries(targeting: AlertWorkflowTargeting) -> list[AlertTargetEntry]:
    targeting = _normalize_targeting(targeting)
    if targeting.entries:
        return targeting.entries
    return []


def _primary_target_entry(targeting: AlertWorkflowTargeting) -> AlertTargetEntry | None:
    entries = _targeting_entries(targeting)
    return entries[0] if entries else None


def workflow_target_entry_for_tick(workflow: AlertWorkflowOut, tick: dict[str, Any]) -> AlertTargetEntry | None:
    tick_symbol = (str(tick.get("symbol") or "")).strip().upper()
    tick_exchange = (str(tick.get("exchange") or "")).strip().upper() or None
    for entry in _targeting_entries(workflow.workflow_dsl.targeting):
        if entry.symbol != tick_symbol:
            continue
        if tick_exchange and entry.exchange and entry.exchange != tick_exchange:
            continue
        return entry
    return _primary_target_entry(workflow.workflow_dsl.targeting)


SYSTEM_TEMPLATES: list[dict[str, Any]] = [
    {
        "slug": "feed-order-wins",
        "name": "Feed Order Wins",
        "description": "Watch Alpha news and announcements for order-win or contract-award events using an LLM trigger.",
        "category": "alpha-feed",
        "workflow_dsl": {
            "workflow_type": "alpha_feed",
            "combine": "all",
            "cooldown_seconds": 900,
            "conditions": [{"field": "event", "operator": "always"}],
            "notification": {
                "level": "warning",
                "title_template": "{symbol} order-win update",
                "message_template": "{symbol} matched the feed trigger: {feed_trigger_reason}",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
            "feed_trigger": {
                "enabled": True,
                "products": ["news", "announcements"],
                "condition_prompt": "Tell me when this item is about a confirmed order win, contract award, significant deal, or large customer mandate.",
                "source_scope": "current_alpha_subscription",
            },
        },
    },
    {
        "slug": "feed-earnings-surprise",
        "name": "Feed Earnings Surprise",
        "description": "Watch earnings and concall feed items for material positive or negative surprises.",
        "category": "alpha-feed",
        "workflow_dsl": {
            "workflow_type": "alpha_feed",
            "combine": "all",
            "cooldown_seconds": 1800,
            "conditions": [{"field": "event", "operator": "always"}],
            "notification": {
                "level": "info",
                "title_template": "{symbol} earnings feed signal",
                "message_template": "{symbol} matched the earnings feed condition: {feed_trigger_reason}",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
            "feed_trigger": {
                "enabled": True,
                "products": ["earnings", "concalls"],
                "condition_prompt": "Tell me when this item points to a material earnings surprise, guidance change, margin shock, or management commentary that changes the business outlook.",
                "source_scope": "current_alpha_subscription",
            },
        },
    },
    {
        "slug": "price-cross",
        "name": "Price Cross",
        "description": "Alert when price crosses above or below a configured level.",
        "category": "price",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 300,
            "conditions": [{"field": "ltp", "operator": "crosses_above", "value": 3000}],
            "dsl_text": "crosses_above(ltp, value=3000)",
            "notification": {
                "level": "warning",
                "title_template": "{symbol} crossed price level",
                "message_template": "{symbol} crossed the configured price threshold at {ltp}. Day change {day_change_perc}%.",
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
            "dsl_text": "pct_change_gte(ltp, value=2, compare_to=open)",
            "notification": {
                "level": "warning",
                "title_template": "{symbol} moved sharply",
                "message_template": "{symbol} moved {change_pct}% from {reference_price}. LTP {ltp}, volume {volume}.",
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
                {"field": "ltp", "operator": "breaks_day_high", "compare_to": "high"},
                {"field": "ltp", "operator": "breaks_day_low", "compare_to": "low"},
            ],
            "dsl_text": "any(breaks_day_high(ltp, compare_to=high), breaks_day_low(ltp, compare_to=low))",
            "notification": {
                "level": "warning",
                "title_template": "{symbol} broke its day range",
                "message_template": "{symbol} moved outside the current day range. LTP {ltp}, high {high}, low {low}.",
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
            "conditions": [{"field": "volume", "operator": "volume_spike", "value": 2, "compare_to": "avg_volume"}],
            "dsl_text": "volume_spike(volume, value=2, compare_to=avg_volume)",
            "notification": {
                "level": "info",
                "title_template": "{symbol} volume spike",
                "message_template": "{symbol} volume reached {volume}, about {volume_ratio}x reference volume.",
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
            "conditions": [{"field": "open_interest", "operator": "oi_change_gte", "value": 10000}],
            "dsl_text": "oi_change_gte(open_interest, value=10000)",
            "notification": {
                "level": "info",
                "title_template": "{symbol} OI expansion",
                "message_template": "{symbol} open interest changed sharply. Current OI {open_interest}, LTP {ltp}.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
    {
        "slug": "gap-and-follow-through",
        "name": "Gap And Follow-Through",
        "description": "Alert when a symbol gaps up and price remains above the open, useful for morning momentum scans.",
        "category": "gap",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 600,
            "conditions": [
                {"field": "open", "operator": "gap_up_pct_gte", "value": 1.5, "compare_to": "close"},
                {"field": "ltp", "operator": "field_gte", "compare_to": "open"},
            ],
            "dsl_text": "all(gap_up_pct_gte(open, value=1.5, compare_to=close), ltp >= open)",
            "notification": {
                "level": "warning",
                "title_template": "{symbol} gap follow-through",
                "message_template": "{symbol} gapped {gap_pct}% and is trading at {ltp} vs open {open}. Volume {volume}.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
    {
        "slug": "price-volume-breakout",
        "name": "Price + Volume Breakout",
        "description": "Alert when price breaks the day high while volume is elevated versus average/reference volume.",
        "category": "breakout",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 600,
            "conditions": [
                {"field": "ltp", "operator": "breaks_day_high", "compare_to": "high"},
                {"field": "volume", "operator": "relative_volume_gte", "value": 2, "compare_to": "avg_volume"},
            ],
            "dsl_text": "all(breaks_day_high(ltp, compare_to=high), relative_volume_gte(volume, value=2, compare_to=avg_volume))",
            "notification": {
                "level": "critical",
                "title_template": "{symbol} price-volume breakout",
                "message_template": "{symbol} broke day high at {ltp} with volume {volume} ({volume_ratio}x reference).",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app", "discord"]},
        },
    },
    {
        "slug": "opening-reversal-down",
        "name": "Opening Reversal Down",
        "description": "Alert when a gap-up symbol loses the open and starts reversing lower.",
        "category": "reversal",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 600,
            "conditions": [
                {"field": "open", "operator": "gap_up_pct_gte", "value": 1, "compare_to": "close"},
                {"field": "ltp", "operator": "field_lte", "compare_to": "open"},
                {"field": "ltp", "operator": "pct_change_lte", "value": 0.5, "compare_to": "high"},
            ],
            "dsl_text": "all(gap_up_pct_gte(open, value=1, compare_to=close), ltp <= open, pct_change_lte(ltp, value=0.5, compare_to=high))",
            "notification": {
                "level": "warning",
                "title_template": "{symbol} opening reversal",
                "message_template": "{symbol} is losing the open after a gap. LTP {ltp}, open {open}, high {high}, change {change_pct}%.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app"]},
        },
    },
    {
        "slug": "derivative-oi-price-confirmation",
        "name": "Derivative OI + Price Confirmation",
        "description": "Alert when price rises with open-interest expansion, useful for derivative activity scans.",
        "category": "options",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 600,
            "conditions": [
                {"field": "ltp", "operator": "pct_change_gte", "value": 1, "compare_to": "open"},
                {"field": "open_interest", "operator": "oi_change_gte", "value": 10000},
            ],
            "dsl_text": "all(pct_change_gte(ltp, value=1, compare_to=open), oi_change_gte(open_interest, value=10000))",
            "notification": {
                "level": "warning",
                "title_template": "{symbol} OI-price confirmation",
                "message_template": "{symbol} is up {change_pct}% with OI {open_interest}. LTP {ltp}, volume {volume}.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app", "discord"]},
        },
    },
    {
        "slug": "rolling-rapid-move",
        "name": "Rolling Rapid Move",
        "description": "Alert when a symbol moves quickly against its previous rolling reference.",
        "category": "momentum",
        "workflow_dsl": {
            "combine": "all",
            "cooldown_seconds": 180,
            "conditions": [{"field": "ltp", "operator": "rolling_pct_change_gte", "value": 1.5, "window_seconds": 300}],
            "dsl_text": "rolling_pct_change_gte(ltp, value=1.5, window_seconds=300)",
            "notification": {
                "level": "critical",
                "title_template": "{symbol} rapid move",
                "message_template": "{symbol} moved {change_pct}% in the rolling window. LTP {ltp}, volume {volume}.",
            },
            "channels": {"inherit_defaults": True, "enabled": ["in_app", "discord"]},
        },
    },
]
_templates_seeded = False


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


def _legacy_conditions_from_logic(logic: dict[str, Any]) -> tuple[str, list[AlertCondition]]:
    kind = str(logic.get("kind") or "all")
    if kind not in {"all", "any"}:
        children = [logic]
        combine = "all"
    else:
        children = [child for child in logic.get("children") or [] if isinstance(child, dict)]
        combine = kind
    conditions: list[AlertCondition] = []
    for child in children:
        if str(child.get("kind") or "condition") != "condition":
            continue
        field = str(child.get("field") or "").strip()
        operator = str(child.get("operator") or "").strip()
        if not field and operator != "always":
            continue
        if not operator:
            continue
        conditions.append(
            AlertCondition(
                field=field or "ltp",
                operator=operator,
                value=child.get("value"),
                compare_to=child.get("compare_to"),
                window_seconds=child.get("window_seconds"),
            )
        )
    return combine, conditions


def _apply_compiled_ast_to_legacy_dsl(dsl: AlertWorkflowDsl, compiled_ast: dict[str, Any] | None) -> None:
    if not compiled_ast:
        return
    logic = compiled_ast.get("logic")
    if not isinstance(logic, dict):
        return
    combine, conditions = _legacy_conditions_from_logic(logic)
    if conditions:
        dsl.combine = "any" if combine == "any" else "all"
        dsl.conditions = conditions


def ensure_system_templates(db: Session) -> None:
    global _templates_seeded
    if _templates_seeded:
        return
    existing = {row.slug: row for row in db.scalars(select(AlertWorkflowTemplate)).all()}
    changed = False
    for payload in SYSTEM_TEMPLATES:
        row = existing.get(payload["slug"])
        workflow_dsl = AlertWorkflowDsl(**payload["workflow_dsl"])
        compiled = compile_workflow_dsl(workflow_dsl)
        _apply_compiled_ast_to_legacy_dsl(workflow_dsl, compiled.get("workflow_ast"))
        workflow_dsl.workflow_ast = compiled.get("workflow_ast")
        workflow_dsl.compiled_summary = compiled.get("compiled_summary") or {}
        workflow_dsl.validation_status = "valid" if compiled.get("valid") else "invalid"
        graph_dsl = _default_graph_from_dsl(workflow_dsl)
        workflow_dsl_json = _json_dumps(workflow_dsl.model_dump())
        graph_dsl_json = _json_dumps(graph_dsl.model_dump())
        if row is None:
            db.add(
                AlertWorkflowTemplate(
                    id=str(uuid.uuid4()),
                    slug=payload["slug"],
                    name=payload["name"],
                    description=payload["description"],
                    category=payload["category"],
                    workflow_dsl_json=workflow_dsl_json,
                    graph_dsl_json=graph_dsl_json,
                    is_active=True,
                )
            )
            changed = True
            continue
        if (
            row.name != payload["name"]
            or row.description != payload["description"]
            or row.category != payload["category"]
            or row.workflow_dsl_json != workflow_dsl_json
            or row.graph_dsl_json != graph_dsl_json
            or not row.is_active
        ):
            row.name = payload["name"]
            row.description = payload["description"]
            row.category = payload["category"]
            row.workflow_dsl_json = workflow_dsl_json
            row.graph_dsl_json = graph_dsl_json
            row.is_active = True
            db.add(row)
            changed = True
    if changed:
        db.commit()
    _templates_seeded = True


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


def _notification_to_out(row: UserAlertNotification) -> AlertNotificationOut:
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


def _publish_notification_event(notification: AlertNotificationOut) -> None:
    client = _redis_client()
    if not client:
        return
    try:
        client.xadd(
            _alert_notification_stream(notification.user_id),
            {"payload": _json_dumps(notification.model_dump(mode="json"))},
            maxlen=ALERT_NOTIFICATION_STREAM_MAXLEN,
            approximate=True,
        )
    except Exception:
        return


def list_templates(db: Session) -> list[AlertTemplateOut]:
    ensure_system_templates(db)
    rows = db.scalars(select(AlertWorkflowTemplate).order_by(AlertWorkflowTemplate.name.asc())).all()
    return [_template_to_out(row) for row in rows]


def get_template(db: Session, template_id: str) -> AlertTemplateOut | None:
    ensure_system_templates(db)
    row = db.get(AlertWorkflowTemplate, template_id)
    return _template_to_out(row) if row else None


def _workflow_to_out(row: AlertWorkflow) -> AlertWorkflowOut:
    instrument_ref_payload = _json_loads(row.instrument_ref_json, {})
    workflow_dsl_payload = _json_loads(row.workflow_dsl_json, {})
    workflow_dsl = _workflow_dsl(workflow_dsl_payload)
    workflow_dsl.targeting = _normalize_targeting(
        workflow_dsl_payload.get("targeting") if isinstance(workflow_dsl_payload, dict) else None
    )
    if not workflow_dsl.targeting.entries:
        workflow_dsl.targeting = _default_targeting(row.symbol, row.exchange, instrument_ref_payload)
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
        instrument_ref=_instrument_ref(instrument_ref_payload),
        workflow_dsl=workflow_dsl,
        graph_dsl=_graph_dsl(_json_loads(row.graph_dsl_json, {})),
        editor_mode=row.editor_mode,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        channel_override=_channel_selection(_json_loads(row.channel_override_json, None)),
        deployment_status=row.deployment_status,
        deploy_version=row.deploy_version,
        compiled_summary=_json_loads(row.compiled_summary_json, {}),
        last_validated_at=row.last_validated_at,
        last_compiled_at=row.last_compiled_at,
        last_runtime_error=row.last_runtime_error,
        last_triggered_at=row.last_triggered_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _clear_workflow_subscriptions(db: Session, workflow_id: str) -> None:
    rows = db.scalars(
        select(LiveSymbolSubscription).where(LiveSymbolSubscription.workflow_id == workflow_id)
    ).all()
    for row in rows:
        db.delete(row)
    if rows:
        db.commit()


def _sync_workflow_subscription(db: Session, workflow: AlertWorkflow) -> None:
    reconcile_user_subscriptions(db, workflow.user_id)


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
    incoming_symbol = getattr(payload, "symbol", None)
    incoming_exchange = getattr(payload, "exchange", None)
    instrument_ref = getattr(payload, "instrument_ref", None)
    next_instrument_ref = _instrument_ref(_json_loads(row.instrument_ref_json, {}))
    if instrument_ref is not None:
        next_instrument_ref = instrument_ref
    workflow_dsl = getattr(payload, "workflow_dsl", None)
    if workflow_dsl is not None:
        normalized_targeting = _normalize_targeting(workflow_dsl.targeting)
        if not normalized_targeting.entries:
            normalized_targeting = _default_targeting(incoming_symbol, incoming_exchange, next_instrument_ref)
        workflow_dsl.targeting = normalized_targeting
        compiled = compile_workflow_dsl(workflow_dsl)
        _apply_compiled_ast_to_legacy_dsl(workflow_dsl, compiled["workflow_ast"])
        workflow_dsl.workflow_ast = compiled["workflow_ast"]
        workflow_dsl.compiled_summary = compiled["compiled_summary"]
        workflow_dsl.validation_status = "valid" if compiled["valid"] else "invalid"
        row.workflow_dsl_json = _json_dumps(workflow_dsl.model_dump())
        row.compiled_summary_json = _json_dumps(compiled["compiled_summary"])
        row.last_validated_at = _now()
        row.last_compiled_at = _now() if compiled["valid"] else row.last_compiled_at
        row.last_runtime_error = "; ".join(compiled["errors"]) if compiled["errors"] else None
        row.deployment_status = "validated" if compiled["valid"] else "error"
        primary_target = _primary_target_entry(normalized_targeting)
        row.symbol = primary_target.symbol if primary_target else incoming_symbol
        row.exchange = primary_target.exchange if primary_target else incoming_exchange
        row.instrument_ref_json = _json_dumps(
            (primary_target.instrument_ref if primary_target else next_instrument_ref).model_dump(exclude_none=True)
        )
    else:
        if incoming_symbol is not None:
            row.symbol = incoming_symbol
        if incoming_exchange is not None:
            row.exchange = incoming_exchange
        if instrument_ref is not None:
            row.instrument_ref_json = _json_dumps(instrument_ref.model_dump(exclude_none=True))
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
    payload.workflow_dsl.targeting = _normalize_targeting(payload.workflow_dsl.targeting)
    if not payload.workflow_dsl.targeting.entries:
        payload.workflow_dsl.targeting = _default_targeting(payload.symbol, payload.exchange, payload.instrument_ref)
    compiled = compile_workflow_dsl(payload.workflow_dsl)
    _apply_compiled_ast_to_legacy_dsl(payload.workflow_dsl, compiled["workflow_ast"])
    payload.workflow_dsl.workflow_ast = compiled["workflow_ast"]
    payload.workflow_dsl.compiled_summary = compiled["compiled_summary"]
    payload.workflow_dsl.validation_status = "valid" if compiled["valid"] else "invalid"
    primary_target = _primary_target_entry(payload.workflow_dsl.targeting)
    graph = payload.graph_dsl if payload.graph_dsl.nodes else _default_graph_from_dsl(payload.workflow_dsl)
    row = AlertWorkflow(
        id=str(uuid.uuid4()),
        user_id=user_id,
        template_id=payload.template_id,
        name=payload.name,
        description=payload.description,
        account_id=payload.account_id,
        broker_code=payload.broker_code,
        symbol=primary_target.symbol if primary_target else payload.symbol,
        exchange=primary_target.exchange if primary_target else payload.exchange,
        instrument_ref_json=_json_dumps(
            (primary_target.instrument_ref if primary_target else payload.instrument_ref).model_dump(exclude_none=True)
        ),
        workflow_dsl_json=_json_dumps(payload.workflow_dsl.model_dump()),
        graph_dsl_json=_json_dumps(graph.model_dump()),
        editor_mode=payload.editor_mode,
        status="active",
        channel_override_json=_json_dumps(payload.channel_override.model_dump()) if payload.channel_override else "null",
        deployment_status="validated" if compiled["valid"] else "error",
        compiled_summary_json=_json_dumps(compiled["compiled_summary"]),
        last_validated_at=_now(),
        last_compiled_at=_now() if compiled["valid"] else None,
        last_runtime_error="; ".join(compiled["errors"]) if compiled["errors"] else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _sync_workflow_subscription(db, row)
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
    _sync_workflow_subscription(db, row)
    return _workflow_to_out(row)


def delete_workflow(db: Session, user_id: str, workflow_id: str) -> bool:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return False
    _clear_workflow_subscriptions(db, workflow_id)
    db.delete(row)
    db.commit()
    reconcile_user_subscriptions(db, user_id)
    return True


def set_workflow_status(db: Session, user_id: str, workflow_id: str, status: str) -> AlertWorkflowOut | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    row.status = status
    db.add(row)
    db.commit()
    db.refresh(row)
    _sync_workflow_subscription(db, row)
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
        return template.format_map(defaultdict(str, safe_context))
    except Exception:
        return template


def _notification_context(
    workflow: AlertWorkflowOut,
    tick: dict[str, Any],
    previous_tick: dict[str, Any] | None = None,
    llm_analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a template context with computed fields used by notification placeholders."""

    context: dict[str, Any] = dict(tick)
    context["symbol"] = str(context.get("symbol") or workflow.symbol or "")
    context["exchange"] = str(context.get("exchange") or workflow.exchange or "")
    if llm_analysis:
        context["llm_analysis"] = str(llm_analysis.get("output") or "")
        context["llm_analysis_status"] = str(llm_analysis.get("status") or "")
    else:
        context["llm_analysis"] = ""
        context["llm_analysis_status"] = ""

    if context.get("change_pct") is None:
        computed_change_pct: float | None = None
        prior = previous_tick or {}
        for condition in workflow.workflow_dsl.conditions:
            if condition.operator not in {"pct_change_gte", "pct_change_lte"}:
                continue
            current, reference = _condition_value(condition, tick, prior)
            if current is None or reference in (None, 0):
                continue
            computed_change_pct = ((current - reference) / reference) * 100
            break
        if computed_change_pct is None:
            fallback = context.get("day_change_perc")
            if fallback not in (None, ""):
                try:
                    computed_change_pct = float(fallback)
                except Exception:
                    computed_change_pct = None
        if computed_change_pct is None:
            try:
                ltp = float(context.get("ltp")) if context.get("ltp") not in (None, "") else None
            except Exception:
                ltp = None
            reference_candidates = ("close", "open")
            if ltp is not None:
                for key in reference_candidates:
                    ref = context.get(key)
                    if ref in (None, "", 0, "0"):
                        continue
                    try:
                        ref_value = float(ref)
                    except Exception:
                        continue
                    if ref_value != 0:
                        computed_change_pct = ((ltp - ref_value) / ref_value) * 100
                        break
        if computed_change_pct is not None:
            context["change_pct"] = round(computed_change_pct, 2)
    if context.get("reference_price") is None:
        for key in ("open", "close", "avg_volume"):
            if context.get(key) not in (None, ""):
                context["reference_price"] = context.get(key)
                break
    if context.get("abs_change") is None and context.get("ltp") not in (None, ""):
        ref = context.get("reference_price")
        try:
            context["abs_change"] = round(float(context["ltp"]) - float(ref), 2) if ref not in (None, "") else None
        except Exception:
            pass
    if context.get("volume_ratio") is None and context.get("volume") not in (None, "") and context.get("avg_volume") not in (None, "", 0, "0"):
        try:
            context["volume_ratio"] = round(float(context["volume"]) / float(context["avg_volume"]), 2)
        except Exception:
            pass

    return context


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
    result = evaluate_workflow_payload_detail(workflow, tick, previous_tick)
    return result.matched, result.reason


def evaluate_workflow_payload_detail(
    workflow: AlertWorkflowOut,
    tick: dict[str, Any],
    previous_tick: dict[str, Any] | None = None,
) -> ConditionEvaluation:
    workflow_ast = ensure_workflow_ast(workflow.workflow_dsl)
    return evaluate_logic(workflow_ast.logic, tick, previous_tick or {})


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


def validate_workflow(db: Session, user_id: str, workflow_id: str) -> dict[str, Any] | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    dsl = _workflow_dsl(_json_loads(row.workflow_dsl_json, {}))
    result = compile_workflow_dsl(dsl)
    _apply_compiled_ast_to_legacy_dsl(dsl, result["workflow_ast"])
    row.workflow_dsl_json = _json_dumps({**dsl.model_dump(), "workflow_ast": result["workflow_ast"], "validation_status": "valid" if result["valid"] else "invalid", "compiled_summary": result["compiled_summary"]})
    row.compiled_summary_json = _json_dumps(result["compiled_summary"])
    row.last_validated_at = _now()
    row.last_compiled_at = _now() if result["valid"] else row.last_compiled_at
    row.deployment_status = "validated" if result["valid"] else "error"
    row.last_runtime_error = "; ".join(result["errors"]) if result["errors"] else None
    db.add(row)
    db.commit()
    return result


def compile_preview_workflow(db: Session, user_id: str, workflow_id: str) -> dict[str, Any] | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    dsl = _workflow_dsl(_json_loads(row.workflow_dsl_json, {}))
    result = compile_workflow_dsl(dsl)
    _apply_compiled_ast_to_legacy_dsl(dsl, result["workflow_ast"])
    result["legacy_conditions"] = [condition.model_dump(exclude_none=True) for condition in dsl.conditions]
    result["legacy_combine"] = dsl.combine
    return result


def explain_workflow(db: Session, user_id: str, workflow_id: str) -> dict[str, Any] | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    dsl = _workflow_dsl(_json_loads(row.workflow_dsl_json, {}))
    explanation = explain_ast(ensure_workflow_ast(dsl))
    if dsl.llm_analysis.enabled:
        explanation["llm_analysis"] = {
            "enabled": True,
            "provider": dsl.llm_analysis.provider,
            "model_id": dsl.llm_analysis.model_id,
            "placeholders": prompt_placeholders_from_config(dsl.llm_analysis),
        }
    return explanation


def llm_placeholder_catalog() -> dict[str, Any]:
    return placeholder_catalog()


def preview_workflow_llm_context(
    db: Session,
    user_id: str,
    workflow_id: str,
    tick: dict[str, Any],
    previous_tick: dict[str, Any] | None = None,
    reason: str | None = None,
) -> dict[str, Any] | None:
    workflow = get_workflow(db, user_id, workflow_id)
    if workflow is None:
        return None
    evaluation = evaluate_workflow_payload_detail(workflow, tick, previous_tick)
    return resolve_llm_context(
        db,
        workflow=workflow,
        tick=tick,
        previous_tick=previous_tick,
        reason=reason or evaluation.reason,
        evaluation_details=evaluation.details,
    )


def test_workflow_llm_analysis(
    db: Session,
    user_id: str,
    workflow_id: str,
    tick: dict[str, Any],
    previous_tick: dict[str, Any] | None = None,
    reason: str | None = None,
) -> dict[str, Any] | None:
    workflow = get_workflow(db, user_id, workflow_id)
    if workflow is None:
        return None
    if not workflow.workflow_dsl.llm_analysis.prompt_template:
        workflow.workflow_dsl.llm_analysis.prompt_template = default_prompt_template()
    evaluation = evaluate_workflow_payload_detail(workflow, tick, previous_tick)
    analysis = run_workflow_llm_analysis(
        db,
        workflow=workflow,
        tick=tick,
        previous_tick=previous_tick,
        reason=reason or evaluation.reason,
        evaluation_details=evaluation.details,
        call_llm=True,
    )
    context = resolve_llm_context(
        db,
        workflow=workflow,
        tick=tick,
        previous_tick=previous_tick,
        reason=reason or evaluation.reason,
        evaluation_details=evaluation.details,
    )
    return {**context, "llm_analysis": analysis}


def sample_workflow_alerts(db: Session, user_id: str, workflow_id: str) -> dict[str, Any] | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    return sample_alerts_for_ast(ensure_workflow_ast(_workflow_dsl(_json_loads(row.workflow_dsl_json, {}))))


def deploy_workflow(db: Session, user_id: str, workflow_id: str) -> AlertWorkflowOut | None:
    row = db.get(AlertWorkflow, workflow_id)
    if not row or row.user_id != user_id:
        return None
    dsl = _workflow_dsl(_json_loads(row.workflow_dsl_json, {}))
    result = compile_workflow_dsl(dsl)
    if not result["valid"]:
        row.deployment_status = "error"
        row.last_runtime_error = "; ".join(result["errors"])
    else:
        _apply_compiled_ast_to_legacy_dsl(dsl, result["workflow_ast"])
        row.deploy_version = int(row.deploy_version or 0) + 1
        row.deployment_status = "active"
        row.status = "active"
        row.workflow_dsl_json = _json_dumps({**dsl.model_dump(), "workflow_ast": result["workflow_ast"], "validation_status": "valid", "compiled_summary": result["compiled_summary"]})
        row.compiled_summary_json = _json_dumps(result["compiled_summary"])
        row.last_runtime_error = None
        row.last_compiled_at = _now()
    row.last_validated_at = _now()
    db.add(row)
    db.commit()
    reconcile_user_subscriptions(db, user_id)
    db.refresh(row)
    return _workflow_to_out(row)


def preview_universe(db: Session, user_id: str, target_universe: dict[str, Any], limit: int = 50) -> dict[str, Any]:
    symbols = resolve_universe(db, user_id, AlertUniverseNode(**(target_universe or {})))
    return {
        "count": len(symbols),
        "sample": [
            {
                "symbol": item.symbol,
                "exchange": item.exchange,
                "source_type": item.source_type,
                "source_id": item.source_id,
                "source_label": item.source_label,
            }
            for item in symbols[:limit]
        ],
    }


def reconcile_subscriptions_for_user(db: Session, user_id: str) -> dict[str, Any]:
    return reconcile_user_subscriptions(db, user_id)


def alert_condition_registry() -> dict[str, Any]:
    return condition_registry_payload()


def alert_presets() -> list[dict[str, Any]]:
    return list_presets()


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


def resolve_workflow_channels(
    db: Session,
    workflow: AlertWorkflowOut,
) -> list[str]:
    if workflow.channel_override and not workflow.channel_override.inherit_defaults:
        return list(workflow.channel_override.enabled) or ["in_app"]
    defaults = [
        row.channel_type
        for row in db.scalars(
            select(UserAlertChannel).where(
                UserAlertChannel.user_id == workflow.user_id,
                UserAlertChannel.is_enabled.is_(True),
                UserAlertChannel.is_default.is_(True),
            )
        ).all()
    ]
    if workflow.channel_override and workflow.channel_override.enabled:
        defaults = sorted(set(defaults + list(workflow.channel_override.enabled)))
    if defaults:
        return defaults
    return workflow.workflow_dsl.channels.enabled or ["in_app"]


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
    enabled_channel_rows = db.scalars(
        select(UserAlertChannel).where(
            UserAlertChannel.user_id == user_id,
            UserAlertChannel.channel_type.in_(channels),
        )
    ).all() if channels else []
    channel_row_by_type = {row.channel_type: row for row in enabled_channel_rows}
    symbol_value = str(payload.get("symbol") or workflow.symbol or "").strip() if workflow else str(payload.get("symbol") or "").strip()
    exchange_value = str(payload.get("exchange") or workflow.exchange or "").strip() if workflow else str(payload.get("exchange") or "").strip()
    row = UserAlertNotification(
        id=str(uuid.uuid4()),
        user_id=user_id,
        workflow_id=workflow.id if workflow else None,
        template_id=workflow.template_id if workflow else None,
        account_id=workflow.account_id if workflow else None,
        broker_code=workflow.broker_code if workflow else None,
        symbol=symbol_value or None,
        exchange=exchange_value or None,
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
        channel_row = channel_row_by_type.get(channel_type)
        db.add(
            UserAlertChannelDelivery(
                id=str(uuid.uuid4()),
                notification_id=row.id,
                channel_id=channel_row.id if channel_row else None,
                channel_type=channel_type,
                status="delivered" if channel_type == "in_app" else "pending",
                delivered_at=_now() if channel_type == "in_app" else None,
                payload_json=_json_dumps(payload),
            )
        )
    db.commit()
    db.refresh(row)
    notification = _notification_to_out(row)
    _publish_notification_event(notification)
    return notification


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
    return [_notification_to_out(row) for row in rows]


def unread_alert_count(db: Session, user_id: str) -> int:
    return int(
        db.scalar(
            select(func.count(UserAlertNotification.id)).where(
                UserAlertNotification.user_id == user_id,
                UserAlertNotification.is_read.is_(False),
            )
        )
        or 0
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


def create_workflow_test_notification(
    db: Session,
    workflow: AlertWorkflowOut,
    tick: dict[str, Any],
) -> AlertNotificationOut:
    context = _notification_context(workflow, tick, None)
    title = _render_message(workflow.workflow_dsl.notification.title_template, context)
    message = _render_message(workflow.workflow_dsl.notification.message_template, context)
    notification = create_alert_notification(
        db,
        user_id=workflow.user_id,
        workflow=workflow,
        title=title,
        message=message,
        level=workflow.workflow_dsl.notification.level,
        channels=resolve_workflow_channels(db, workflow),
        payload=tick,
        dedupe_key=None,
    )
    return notification


def _notification_level_color(level: str) -> int:
    return {
        "info": 0x2563EB,
        "warning": 0xD97706,
        "critical": 0xDC2626,
        "success": 0x059669,
    }.get(level.lower(), 0x475569)


def _stringify_metric(value: Any) -> str:
    if value in (None, ""):
        return "-"
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value)


def _notification_facts(notification: UserAlertNotification, payload: dict[str, Any]) -> list[tuple[str, str]]:
    facts: list[tuple[str, str]] = []
    if notification.symbol:
        facts.append(("Symbol", notification.symbol))
    if notification.exchange:
        facts.append(("Exchange", notification.exchange))
    if notification.broker_code:
        facts.append(("Broker", notification.broker_code.upper()))
    for field, label in (
        ("ltp", "LTP"),
        ("day_change", "Day change"),
        ("day_change_perc", "Day change %"),
        ("volume", "Volume"),
        ("open_interest", "Open interest"),
        ("last_trade_time", "Last trade time"),
        ("received_at", "Received at"),
    ):
        if payload.get(field) not in (None, ""):
            facts.append((label, _stringify_metric(payload.get(field))))
    return facts[:10]


def _discord_notification_payload(notification: UserAlertNotification, payload: dict[str, Any]) -> dict[str, Any]:
    fields = [
        {
            "name": name,
            "value": value,
            "inline": True,
        }
        for name, value in _notification_facts(notification, payload)
    ]
    return {
        "username": "Market Stack Alerts",
        "embeds": [
            {
                "title": notification.title,
                "description": notification.message,
                "color": _notification_level_color(notification.level),
                "fields": fields,
                "footer": {"text": f"Workflow {notification.workflow_id or 'manual'}"},
                "timestamp": notification.created_at.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
            }
        ],
        "allowed_mentions": {"parse": []},
    }


def _telegram_notification_payload(notification: UserAlertNotification, payload: dict[str, Any], chat_id: str) -> dict[str, Any]:
    lines = [f"<b>{html.escape(notification.title)}</b>", html.escape(notification.message)]
    facts = _notification_facts(notification, payload)
    if facts:
        lines.append("")
        for name, value in facts:
            lines.append(f"<b>{html.escape(name)}:</b> <code>{html.escape(value)}</code>")
    return {
        "chat_id": chat_id,
        "text": "\n".join(lines),
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }


def _discord_test_payload(message: str) -> dict[str, Any]:
    return {
        "username": "Market Stack Alerts",
        "embeds": [
            {
                "title": "Channel test",
                "description": message,
                "color": _notification_level_color("info"),
            }
        ],
        "allowed_mentions": {"parse": []},
    }


def _telegram_test_payload(message: str, chat_id: str) -> dict[str, Any]:
    return {
        "chat_id": chat_id,
        "text": f"<b>Channel test</b>\n{html.escape(message)}",
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }


def _discord_test_message(webhook_url: str, body: dict[str, Any]) -> tuple[bool, str]:
    try:
        response = httpx.post(webhook_url, json=body, timeout=10)
        if response.status_code >= 400:
            return False, response.text[:1000]
        return True, ""
    except Exception as exc:
        return False, str(exc)


def _telegram_test_message(bot_token: str, body: dict[str, Any]) -> tuple[bool, str]:
    try:
        response = httpx.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json=body,
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
        ok, error = _discord_test_message(str(config.get("webhook_url") or ""), _discord_test_payload(message))
    elif channel_type == "telegram":
        ok, error = _telegram_test_message(
            str(config.get("bot_token") or ""),
            _telegram_test_payload(message, str(config.get("chat_id") or "")),
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
        source_type=row.source_type,
        source_id=row.source_id,
        source_label=row.source_label,
        owner_kind=row.owner_kind,
        owner_id=row.owner_id,
        status=row.status,
        last_quote=_json_loads(row.last_quote_json, {}),
        last_received_at=row.last_received_at,
        reconciled_at=row.reconciled_at,
        health_status=row.health_status,
        health_reason=row.health_reason,
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
    row.source_type = payload.source_type or payload.source_kind
    row.source_id = payload.source_id
    row.source_label = payload.source_label
    row.owner_kind = payload.owner_kind or payload.source_kind
    row.owner_id = payload.owner_id or payload.workflow_id
    row.status = "active"
    row.health_status = "healthy"
    row.health_reason = ""
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


def _broker_statuses(
    db: Session,
    user_id: str,
    desired: list[LiveSubscriptionOut],
    sessions: list[LiveWorkerSessionOut],
) -> list[LiveBrokerAccountStatusOut]:
    desired_counts: dict[tuple[str, str], int] = {}
    for row in desired:
        if not row.account_id or not row.broker_code:
            continue
        key = (row.account_id, row.broker_code)
        desired_counts[key] = desired_counts.get(key, 0) + 1

    worker_counts: dict[tuple[str, str], int] = {}
    for row in sessions:
        key = (row.account_id, row.broker_code)
        worker_counts[key] = worker_counts.get(key, 0) + 1

    relevant_keys = set(desired_counts) | set(worker_counts)
    if not relevant_keys:
        return []

    accounts = list(
        db.scalars(
            select(BrokerAccount).where(
                BrokerAccount.user_id == user_id,
                BrokerAccount.is_active.is_(True),
            )
        ).all()
    )
    account_index = {(row.id, row.broker_code): row for row in accounts}

    statuses: list[LiveBrokerAccountStatusOut] = []
    for account_id, broker_code in sorted(relevant_keys, key=lambda item: (item[1], item[0])):
        acc = account_index.get((account_id, broker_code))
        desired_symbol_count = desired_counts.get((account_id, broker_code), 0)
        active_worker_sessions = worker_counts.get((account_id, broker_code), 0)
        if acc is None:
            statuses.append(
                LiveBrokerAccountStatusOut(
                    broker_code=broker_code,
                    account_id=account_id,
                    label=account_id,
                    desired_symbol_count=desired_symbol_count,
                    active_worker_sessions=active_worker_sessions,
                    action_required=True,
                    guidance="The broker account record is missing or inactive.",
                    last_error="Broker account not found.",
                )
            )
            continue

        try:
            session = broker_session_svc.get_broker_session_status(acc)
            session_active = bool(session.session_active)
            guidance = session.guidance
            has_access_token = bool(session.has_access_token)
            token_expires_at = session.token_expires_at
            automation_enabled = bool(session.automation_enabled)
            automation_mode = session.automation_mode
        except Exception as exc:
            session_active = False
            guidance = str(exc)
            has_access_token = False
            token_expires_at = acc.session_expires_at
            automation_enabled = bool(acc.automation_enabled)
            automation_mode = acc.automation_mode

        action_required = desired_symbol_count > 0 and not session_active
        session_status = acc.session_status or ("active" if session_active else "pending")
        last_error = acc.last_error or (guidance if action_required else None)
        statuses.append(
            LiveBrokerAccountStatusOut(
                broker_code=broker_code,
                account_id=account_id,
                label=acc.label,
                session_status=session_status,
                session_active=session_active,
                can_stream=session_active and desired_symbol_count > 0,
                action_required=action_required,
                automation_enabled=automation_enabled,
                automation_mode=automation_mode,
                has_access_token=has_access_token,
                token_expires_at=token_expires_at,
                desired_symbol_count=desired_symbol_count,
                active_worker_sessions=active_worker_sessions,
                last_verified_at=acc.last_verified_at,
                last_error=last_error,
                guidance=guidance if action_required else None,
            )
        )
    return statuses


def live_stream_status(db: Session, user_id: str) -> LiveStreamsStatusOut:
    desired = list_subscriptions(db, user_id)
    if not desired:
        return LiveStreamsStatusOut(
            redis_ok=False,
            redis_error="no live subscriptions to monitor",
            worker_mode="redis-event-driven-alerts",
            active_sessions=[],
            desired_subscriptions=[],
            broker_statuses=[],
        )

    ok, error = _ping_redis_with_timeout()
    activity_sessions: list[LiveWorkerSessionOut] = []
    client = _redis_client() if ok else None
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
    activity_index = {
        (session.account_id, session.broker_code, session.connection_index): session
        for session in activity_sessions
        if session.account_id and session.broker_code
    }
    sessions = _chunk_sessions(desired, user_id, activity_index)
    broker_statuses = _broker_statuses(db, user_id, desired, sessions)
    return LiveStreamsStatusOut(
        redis_ok=ok,
        redis_error=error,
        worker_mode="redis-event-driven-alerts",
        active_sessions=sessions,
        desired_subscriptions=desired,
        broker_statuses=broker_statuses,
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
        if notification is None:
            delivery.attempt_count += 1
            delivery.status = "failed"
            delivery.last_error = "notification not found"
            db.add(delivery)
            continue
        channel = db.get(UserAlertChannel, delivery.channel_id) if delivery.channel_id else None
        config = _channel_config_payload(channel) if channel else {}
        payload = _json_loads(delivery.payload_json, {})
        ok = True
        error = ""
        if delivery.channel_type == "discord":
            ok, error = _discord_test_message(
                str(config.get("webhook_url") or ""),
                _discord_notification_payload(notification, payload),
            )
        elif delivery.channel_type == "telegram":
            ok, error = _telegram_test_message(
                str(config.get("bot_token") or ""),
                _telegram_notification_payload(notification, payload, str(config.get("chat_id") or "")),
            )
        delivery.attempt_count += 1
        delivery.status = "delivered" if ok else "failed"
        delivery.last_error = None if ok else error
        delivery.delivered_at = _now() if ok else None
        db.add(delivery)
        sent += 1 if ok else 0
    db.commit()
    return sent
