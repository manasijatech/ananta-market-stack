from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.alert import AlertWorkflowCreate, AlertWorkflowOut
from app.schemas.system_config import LlmProvider


WorkflowChatStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class AlertWorkflowChatPreferenceOut(BaseModel):
    default_provider: LlmProvider | None = None
    default_model: str | None = None


class AlertWorkflowChatPreferenceUpdateIn(BaseModel):
    default_provider: LlmProvider | None = None
    default_model: str | None = Field(default=None, max_length=256)


class AlertWorkflowChatSessionCreateIn(BaseModel):
    title: str | None = Field(default=None, max_length=256)
    workflow_id: str | None = None
    draft_workflow: AlertWorkflowCreate | None = None


class AlertWorkflowChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    workflow_id: str | None = None
    title: str
    status: str = "active"
    active_snapshot_id: str | None = None
    created_at: datetime
    updated_at: datetime
    workflow: AlertWorkflowOut | None = None


class AlertWorkflowChatSubmitIn(BaseModel):
    message: str = Field(..., min_length=1)
    session_id: str | None = None
    session_title: str | None = Field(default=None, max_length=256)
    workflow_id: str | None = None
    draft_workflow: AlertWorkflowCreate | None = None
    editor_payload: dict[str, Any] = Field(default_factory=dict)
    provider: LlmProvider | None = None
    model: str | None = Field(default=None, max_length=256)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AlertWorkflowChatRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    user_id: str
    workflow_id: str | None = None
    status: WorkflowChatStatus | str
    job_id: str | None = None
    provider: str
    model_id: str
    message: str
    response_text: str = ""
    error: str | None = None
    metadata_json: str = "{}"
    queued_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AlertWorkflowChatSubmitOut(BaseModel):
    run: AlertWorkflowChatRunOut
    session: AlertWorkflowChatSessionOut
    stream_url: str
    status_url: str
    events_url: str


class AlertWorkflowChatEventOut(BaseModel):
    id: str
    run_id: str
    sequence: int
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AlertWorkflowChatEventsPageOut(BaseModel):
    run: AlertWorkflowChatRunOut
    events: list[AlertWorkflowChatEventOut] = Field(default_factory=list)
    next_after_sequence: int | None = None


class AlertWorkflowChatSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    run_id: str | None = None
    workflow_id: str
    user_id: str
    version: int
    label: str
    workflow_payload: dict[str, Any] = Field(default_factory=dict)
    validation: dict[str, Any] = Field(default_factory=dict)
    compile: dict[str, Any] = Field(default_factory=dict)
    explanation: dict[str, Any] = Field(default_factory=dict)
    samples: dict[str, Any] = Field(default_factory=dict)
    diff: dict[str, Any] = Field(default_factory=dict)
    valid: bool
    applied_at: datetime | None = None
    created_at: datetime


class AlertWorkflowChatSnapshotApplyOut(BaseModel):
    snapshot: AlertWorkflowChatSnapshotOut
    workflow: AlertWorkflowOut

