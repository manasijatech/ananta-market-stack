from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.system_config import LlmProvider

BrokerChatVisibility = Literal["minimal", "tool_calls", "full"]
BrokerChatStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class BrokerChatRetryPolicyOut(BaseModel):
    enabled: bool = True
    max_retries: int = Field(default=3, ge=0)
    base_delay_seconds: float = Field(default=2.0, ge=0)
    max_delay_seconds: float = Field(default=12.0, ge=0)


class BrokerChatPreferenceOut(BaseModel):
    default_provider: LlmProvider | None = None
    default_model: str | None = None
    event_visibility: BrokerChatVisibility = "full"
    include_tool_outputs: bool = True
    include_reasoning: bool = True
    reasoning_effort: str | None = None
    use_mcp: bool = False
    mcp_server_ids: list[str] = Field(default_factory=list)
    retry: BrokerChatRetryPolicyOut = Field(default_factory=BrokerChatRetryPolicyOut)


class BrokerChatPreferenceUpdateIn(BaseModel):
    default_provider: LlmProvider | None = None
    default_model: str | None = Field(default=None, max_length=256)
    event_visibility: BrokerChatVisibility = "full"
    include_tool_outputs: bool = True
    include_reasoning: bool = True
    reasoning_effort: str | None = None
    use_mcp: bool = False
    mcp_server_ids: list[str] = Field(default_factory=list)
    retry: BrokerChatRetryPolicyOut | None = None


BrokerChatSurface = Literal["broker_chat", "adaptive_workspace"]


class BrokerChatSessionCreateIn(BaseModel):
    title: str | None = Field(default=None, max_length=256)
    surface: BrokerChatSurface | None = None


class BrokerChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    title: str
    surface: BrokerChatSurface | str = "broker_chat"
    created_at: datetime
    updated_at: datetime


class BrokerChatSubmitIn(BaseModel):
    message: str = Field(..., min_length=1)
    session_id: str | None = None
    session_title: str | None = Field(default=None, max_length=256)
    provider: LlmProvider | None = None
    model: str | None = Field(default=None, max_length=256)
    event_visibility: BrokerChatVisibility | None = None
    include_tool_outputs: bool | None = None
    include_reasoning: bool | None = None
    reasoning_effort: str | None = None
    use_mcp: bool | None = None
    mcp_server_ids: list[str] | None = None
    default_account_id: str | None = None
    search_account_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrokerChatRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    user_id: str
    status: BrokerChatStatus | str
    job_id: str | None = None
    provider: str
    model_id: str
    message: str
    response_text: str = ""
    error: str | None = None
    event_visibility: BrokerChatVisibility | str = "minimal"
    include_tool_outputs: bool = False
    include_reasoning: bool = False
    metadata_json: str = "{}"
    queued_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class BrokerChatSubmitOut(BaseModel):
    run: BrokerChatRunOut
    stream_url: str
    status_url: str
    events_url: str


class BrokerChatEventOut(BaseModel):
    id: str
    run_id: str
    sequence: int
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class BrokerChatEventsPageOut(BaseModel):
    run: BrokerChatRunOut
    events: list[BrokerChatEventOut] = Field(default_factory=list)
    next_after_sequence: int | None = None
