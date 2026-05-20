from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.system_config import LlmProvider

BrokerChatVisibility = Literal["minimal", "tool_calls", "full"]
BrokerChatStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class BrokerChatPreferenceOut(BaseModel):
    default_provider: LlmProvider | None = None
    default_model: str | None = None
    event_visibility: BrokerChatVisibility = "minimal"
    include_tool_outputs: bool = False
    include_reasoning: bool = False


class BrokerChatPreferenceUpdateIn(BaseModel):
    default_provider: LlmProvider | None = None
    default_model: str | None = Field(default=None, max_length=256)
    event_visibility: BrokerChatVisibility = "minimal"
    include_tool_outputs: bool = False
    include_reasoning: bool = False


class BrokerChatSessionCreateIn(BaseModel):
    title: str | None = Field(default=None, max_length=256)


class BrokerChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    title: str
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
