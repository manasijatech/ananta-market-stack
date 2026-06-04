from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.broker import InstrumentRef
from app.schemas.system_config import LlmProvider


AlertChannelType = Literal["in_app", "discord", "telegram"]
WorkflowStatus = Literal["active", "inactive", "draft", "validated", "paused", "error"]
EditorMode = Literal["rule", "graph"]


class AlertCondition(BaseModel):
    field: str
    operator: str
    value: float | int | str | bool | None = None
    window_seconds: int | None = None
    compare_to: str | None = None
    hold_seconds: int | None = None
    occurrences: int | None = None
    occurrence_window_seconds: int | None = None
    trigger_mode: Literal["level", "rising_edge", "falling_edge", "every_match"] = "level"
    config: dict[str, Any] = Field(default_factory=dict)


class AlertNotificationConfig(BaseModel):
    level: str = "info"
    title_template: str = "{symbol} alert"
    message_template: str = "{symbol} matched workflow"


class AlertChannelSelection(BaseModel):
    inherit_defaults: bool = True
    enabled: list[AlertChannelType] = Field(default_factory=lambda: ["in_app"])


class AlertLlmAnalysisConfig(BaseModel):
    enabled: bool = False
    provider: LlmProvider | None = None
    model_id: str | None = None
    prompt_template: str = ""
    context_placeholders: list[dict[str, Any]] = Field(default_factory=list)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_completion_tokens: int = Field(default=500, ge=1, le=8000)
    timeout_seconds: int = Field(default=25, ge=1, le=120)


class AlertFeedTriggerConfig(BaseModel):
    enabled: bool = False
    products: list[Literal["news", "announcements", "earnings", "concalls", "alerts"]] = Field(default_factory=list)
    announcement_categories: list[str] = Field(default_factory=list)
    include_related_categories: bool = True
    condition_prompt: str = ""
    source_scope: Literal[
        "current_alpha_subscription",
        "watchlists",
        "preset_lists",
        "full_market",
    ] = "current_alpha_subscription"
    watchlist_ids: list[str] = Field(default_factory=list)
    preset_ids: list[str] = Field(default_factory=list)
    include_all_watchlists: bool = False
    provider: LlmProvider | None = None
    model_id: str | None = None
    temperature: float = Field(default=0.1, ge=0, le=2)
    max_completion_tokens: int = Field(default=400, ge=1, le=4000)
    timeout_seconds: int = Field(default=25, ge=1, le=120)


class AlertMarketCapFilterConfig(BaseModel):
    mode: Literal["all", "custom"] = "all"
    min_value: float | None = Field(default=None, ge=0)
    max_value: float | None = Field(default=None, ge=0)


class AlertMarketSessionWindow(BaseModel):
    label: str = "Regular market"
    start: str = Field(default="09:15", pattern=r"^\d{2}:\d{2}$")
    end: str = Field(default="15:30", pattern=r"^\d{2}:\d{2}$")


class AlertWorkflowActivePeriod(BaseModel):
    enabled: bool = True
    timezone: str = "Asia/Kolkata"
    days: list[str] = Field(default_factory=lambda: ["mon", "tue", "wed", "thu", "fri"])
    sessions: list[AlertMarketSessionWindow] = Field(default_factory=lambda: [AlertMarketSessionWindow()])
    exchanges: list[str] = Field(default_factory=list)
    exchange_types: list[str] = Field(default_factory=list)
    segments: list[str] = Field(default_factory=list)
    instrument_types: list[str] = Field(default_factory=list)


class AlertTargetEntry(BaseModel):
    symbol: str
    exchange: str | None = None
    instrument_ref: InstrumentRef = Field(default_factory=InstrumentRef)
    label: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AlertWorkflowTargeting(BaseModel):
    mode: Literal["single_symbol", "symbol_list", "preset_universe"] = "single_symbol"
    entries: list[AlertTargetEntry] = Field(default_factory=list)
    preset_id: str | None = None
    preset_label: str | None = None
    filters: dict[str, Any] = Field(default_factory=dict)


class AlertWorkflowDsl(BaseModel):
    version: int = 2
    workflow_type: Literal["market_data", "alpha_feed"] = "market_data"
    combine: Literal["all", "any"] = "all"
    cooldown_seconds: int = 300
    conditions: list[AlertCondition] = Field(default_factory=list)
    targeting: AlertWorkflowTargeting = Field(default_factory=AlertWorkflowTargeting)
    notification: AlertNotificationConfig = Field(default_factory=AlertNotificationConfig)
    channels: AlertChannelSelection = Field(default_factory=AlertChannelSelection)
    llm_analysis: AlertLlmAnalysisConfig = Field(default_factory=AlertLlmAnalysisConfig)
    feed_trigger: AlertFeedTriggerConfig = Field(default_factory=AlertFeedTriggerConfig)
    market_cap_filter: AlertMarketCapFilterConfig = Field(default_factory=AlertMarketCapFilterConfig)
    active_period: AlertWorkflowActivePeriod = Field(default_factory=AlertWorkflowActivePeriod)
    workflow_ast: dict[str, Any] | None = None
    dsl_text: str | None = None
    validation_status: Literal["unknown", "valid", "invalid"] = "unknown"
    compiled_summary: dict[str, Any] = Field(default_factory=dict)


class AlertGraphNode(BaseModel):
    id: str
    kind: Literal["trigger", "condition", "notification", "channel"]
    label: str
    config: dict[str, Any] = Field(default_factory=dict)


class AlertGraphEdge(BaseModel):
    source: str
    target: str


class AlertGraphDsl(BaseModel):
    nodes: list[AlertGraphNode] = Field(default_factory=list)
    edges: list[AlertGraphEdge] = Field(default_factory=list)


class AlertTemplateOut(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    category: str
    workflow_dsl: AlertWorkflowDsl
    graph_dsl: AlertGraphDsl
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AlertWorkflowBase(BaseModel):
    name: str = Field(..., max_length=128)
    description: str = ""
    account_id: str | None = None
    broker_code: str | None = None
    symbol: str | None = None
    exchange: str | None = None
    instrument_ref: InstrumentRef = Field(default_factory=InstrumentRef)
    workflow_dsl: AlertWorkflowDsl
    graph_dsl: AlertGraphDsl = Field(default_factory=AlertGraphDsl)
    editor_mode: EditorMode = "rule"
    channel_override: AlertChannelSelection | None = None


class AlertWorkflowCreate(AlertWorkflowBase):
    template_id: str | None = None


class AlertWorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    description: str | None = None
    account_id: str | None = None
    broker_code: str | None = None
    symbol: str | None = None
    exchange: str | None = None
    instrument_ref: InstrumentRef | None = None
    workflow_dsl: AlertWorkflowDsl | None = None
    graph_dsl: AlertGraphDsl | None = None
    editor_mode: EditorMode | None = None
    channel_override: AlertChannelSelection | None = None
    status: WorkflowStatus | None = None


class AlertWorkflowOut(BaseModel):
    id: str
    user_id: str
    template_id: str | None
    account_id: str | None
    broker_code: str | None
    name: str
    description: str
    symbol: str | None
    exchange: str | None
    instrument_ref: InstrumentRef
    workflow_dsl: AlertWorkflowDsl
    graph_dsl: AlertGraphDsl
    editor_mode: EditorMode
    status: WorkflowStatus
    channel_override: AlertChannelSelection | None
    deployment_status: str = "draft"
    deploy_version: int = 0
    compiled_summary: dict[str, Any] = Field(default_factory=dict)
    last_validated_at: datetime | None = None
    last_compiled_at: datetime | None = None
    last_runtime_error: str | None = None
    last_triggered_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AlertWorkflowInstantiateIn(BaseModel):
    template_id: str
    name: str | None = None
    account_id: str | None = None
    broker_code: str | None = None
    symbol: str | None = None
    exchange: str | None = None
    instrument_ref: InstrumentRef = Field(default_factory=InstrumentRef)


class AlertWorkflowTestIn(BaseModel):
    tick: dict[str, Any] = Field(default_factory=dict)


class AlertWorkflowLlmPreviewIn(BaseModel):
    tick: dict[str, Any] = Field(default_factory=dict)
    previous_tick: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = None
    llm_analysis: AlertLlmAnalysisConfig | None = None


class AlertWorkflowLlmContextPreviewOut(BaseModel):
    symbol: str
    rendered_prompt: str
    placeholders: dict[str, Any] = Field(default_factory=dict)
    context_errors: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AlertWorkflowLlmTestOut(AlertWorkflowLlmContextPreviewOut):
    llm_analysis: dict[str, Any] = Field(default_factory=dict)


class AlertWorkflowValidationOut(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    workflow_ast: dict[str, Any] | None = None
    compiled_summary: dict[str, Any] = Field(default_factory=dict)


class AlertUniversePreviewIn(BaseModel):
    target_universe: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=50, ge=1, le=5000)


class AlertUniversePreviewOut(BaseModel):
    count: int
    sample: list[dict[str, Any]] = Field(default_factory=list)


class AlertReconcileReportOut(BaseModel):
    user_id: str | None = None
    users: int | None = None
    created: int = 0
    restored: int = 0
    updated: int = 0
    deactivated: int = 0
    orphaned: int = 0
    errors: int = 0
    desired: int = 0
    ran_at: str | None = None
    reports: list[dict[str, Any]] = Field(default_factory=list)


class AlertWorkflowRunOut(BaseModel):
    id: str
    workflow_id: str
    notification_id: str | None
    matched: bool
    reason: str
    rendered_title: str
    rendered_message: str
    channels: list[str] = Field(default_factory=list)
    tick: dict[str, Any] = Field(default_factory=dict)
    evaluation_payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AlertNotificationOut(BaseModel):
    id: str
    user_id: str
    workflow_id: str | None
    template_id: str | None
    account_id: str | None
    broker_code: str | None
    symbol: str | None
    exchange: str | None
    level: str
    title: str
    message: str
    status: str
    channels: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    dedupe_key: str | None = None
    is_read: bool
    created_at: datetime
    read_at: datetime | None


class AlertNotificationUnreadCountOut(BaseModel):
    unread_count: int


class AlphaWebSocketEventOut(BaseModel):
    id: str
    user_id: str
    product: str
    symbol: str | None = None
    event_key: str
    payload: dict[str, Any] = Field(default_factory=dict)
    received_at: datetime
    processed_at: datetime | None = None


class AlertNotificationTestIn(BaseModel):
    title: str = "Test alert"
    message: str = "This is a test alert from Ananta Market Stack."
    level: str = "info"
    channels: list[AlertChannelType] = Field(default_factory=lambda: ["in_app"])


class AlertChannelConfigIn(BaseModel):
    label: str = ""
    is_enabled: bool = True
    is_default: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


class AlertChannelOut(BaseModel):
    id: str
    channel_type: AlertChannelType
    label: str
    is_enabled: bool
    is_default: bool
    config: dict[str, Any] = Field(default_factory=dict)
    last_tested_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class AlertChannelTestIn(BaseModel):
    message: str = "Ananta Market Stack channel test"


class LiveSubscriptionCreateIn(BaseModel):
    account_id: str | None = None
    broker_code: str | None = None
    workflow_id: str | None = None
    symbol: str
    exchange: str | None = None
    instrument_ref: InstrumentRef = Field(default_factory=InstrumentRef)
    source_kind: str = "manual"
    source_type: str | None = None
    source_id: str | None = None
    source_label: str | None = None
    owner_kind: str | None = None
    owner_id: str | None = None


class LiveSubscriptionReplaceIn(BaseModel):
    subscriptions: list[LiveSubscriptionCreateIn] = Field(default_factory=list)


class LiveSubscriptionBulkIn(BaseModel):
    subscriptions: list[LiveSubscriptionCreateIn] = Field(default_factory=list)


class LiveSubscriptionOut(BaseModel):
    id: str
    user_id: str
    workflow_id: str | None
    account_id: str | None
    broker_code: str | None
    symbol: str
    exchange: str | None
    instrument_ref: InstrumentRef
    source_kind: str
    source_type: str | None = None
    source_id: str | None = None
    source_label: str | None = None
    owner_kind: str | None = None
    owner_id: str | None = None
    status: str
    last_quote: dict[str, Any] = Field(default_factory=dict)
    last_received_at: datetime | None
    reconciled_at: datetime | None = None
    health_status: str = "unknown"
    health_reason: str = ""
    created_at: datetime
    updated_at: datetime


class LiveWorkerSessionOut(BaseModel):
    broker_code: str
    account_id: str
    user_id: str
    adapter: str
    connected: bool
    connection_id: str | None = None
    connection_index: int = 1
    symbol_count: int = 0
    capacity: int = 1000
    symbols: list[str] = Field(default_factory=list)
    last_seen_at: datetime | None = None


class LiveBrokerAccountStatusOut(BaseModel):
    broker_code: str
    account_id: str
    label: str
    session_status: str | None = None
    session_active: bool = False
    can_stream: bool = False
    action_required: bool = False
    automation_enabled: bool = False
    automation_mode: str | None = None
    has_access_token: bool = False
    token_expires_at: datetime | None = None
    desired_symbol_count: int = 0
    active_worker_sessions: int = 0
    last_verified_at: datetime | None = None
    last_error: str | None = None
    guidance: str | None = None


class LiveStreamsStatusOut(BaseModel):
    redis_ok: bool
    redis_error: str = ""
    worker_mode: str
    active_sessions: list[LiveWorkerSessionOut] = Field(default_factory=list)
    desired_subscriptions: list[LiveSubscriptionOut] = Field(default_factory=list)
    inactive_subscriptions: list[LiveSubscriptionOut] = Field(default_factory=list)
    broker_statuses: list[LiveBrokerAccountStatusOut] = Field(default_factory=list)
