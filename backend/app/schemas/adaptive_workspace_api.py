from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.adaptive_workspace import WorkspaceSpec


class AdaptiveWorkspaceSnapshotCreateIn(BaseModel):
    workspace_payload: dict[str, Any]
    label: str | None = Field(default=None, max_length=256)
    apply: bool = True


class AdaptiveWorkspaceSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    user_id: str
    version: int
    label: str
    workspace_payload: dict[str, Any]
    validation: dict[str, Any] = Field(default_factory=dict)
    valid: bool
    applied_at: datetime | None = None
    created_at: datetime


class AdaptiveWorkspaceCurrentOut(BaseModel):
    snapshot: AdaptiveWorkspaceSnapshotOut | None = None
    spec: WorkspaceSpec


WorkspacePatchOperation = Literal[
    "replace",
    "add",
    "remove",
    "move",
    "update",
    "duplicate",
    "set_title",
]
