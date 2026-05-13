from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.broker import InstrumentRef


AlertChannelType = Literal["in_app", "discord", "telegram"]
WorkflowStatus = Literal["active", "inactive"]
EditorMode = Literal["rule", "graph"]


class AlertCondition(BaseModel):
    field: str
    operator: str
    value: float | int | str | bool | None = None
    window_seconds: int | None = None
    compare_to: str | None = None


class AlertNotificationConfig(BaseModel):
    level: str = "info"
    title_template: str = "{symbol} alert"
    message_template: str = "{symbol} matched workflow"


class AlertChannelSelection(BaseModel):
    inherit_defaults: bool = True
    enabled: list[AlertChannelType] = Field(default_factory=lambda: ["in_app"])


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
    combine: Literal["all", "any"] = "all"
    cooldown_seconds: int = 300
    conditions: list[AlertCondition] = Field(default_factory=list)
    targeting: AlertWorkflowTargeting = Field(default_factory=AlertWorkflowTargeting)
    notification: AlertNotificationConfig = Field(default_factory=AlertNotificationConfig)
    channels: AlertChannelSelection = Field(default_factory=AlertChannelSelection)


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


class AlertNotificationTestIn(BaseModel):
    title: str = "Test alert"
    message: str = "This is a test alert from Market Stack."
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
    message: str = "Market Stack channel test"


class LiveSubscriptionCreateIn(BaseModel):
    account_id: str | None = None
    broker_code: str | None = None
    workflow_id: str | None = None
    symbol: str
    exchange: str | None = None
    instrument_ref: InstrumentRef = Field(default_factory=InstrumentRef)
    source_kind: str = "manual"


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
    status: str
    last_quote: dict[str, Any] = Field(default_factory=dict)
    last_received_at: datetime | None
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
    broker_statuses: list[LiveBrokerAccountStatusOut] = Field(default_factory=list)
