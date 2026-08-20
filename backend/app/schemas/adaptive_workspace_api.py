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


class AdaptiveWorkspaceSavedDeskCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    workspace_payload: dict[str, Any]


class AdaptiveWorkspaceSavedDeskRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class AdaptiveWorkspaceSavedDeskOut(BaseModel):
    id: str
    user_id: str
    name: str
    workspace_payload: dict[str, Any]
    valid: bool = True
    validation: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class AdaptiveWorkspacePreferencePutIn(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    value: Any = None


class AdaptiveWorkspacePreferenceOut(BaseModel):
    key: str
    value: Any = None
    updated_at: datetime
    deletable: bool = True


class AdaptiveWorkspaceSuggestionOut(BaseModel):
    id: str
    kind: Literal["template", "skill"]
    target_id: str
    message: str
    auto_apply: bool = False


class AdaptiveWorkspaceApplyIn(BaseModel):
    confirm: bool = True


class AdaptiveAlertStudioOut(BaseModel):
    workflow_id: str | None = None
    snapshot_id: str | None = None
    session_id: str | None = None
    source: Literal["snapshot", "workflow", "empty"] = "empty"
    name: str = ""
    status: str = ""
    workflow_payload: dict[str, Any] = Field(default_factory=dict)
    graph_dsl: dict[str, Any] = Field(default_factory=dict)
    validation: dict[str, Any] = Field(default_factory=dict)
    compile: dict[str, Any] = Field(default_factory=dict)
    explanation: dict[str, Any] = Field(default_factory=dict)
    samples: dict[str, Any] = Field(default_factory=dict)
    diff: dict[str, Any] = Field(default_factory=dict)
    valid: bool = False
    applied_at: datetime | None = None
    workflows: list[dict[str, Any]] = Field(default_factory=list)


class AdaptiveAlertStudioDeployIn(BaseModel):
    snapshot_id: str = Field(min_length=1, max_length=64)
    confirm: bool = False


WorkspacePatchOperation = Literal[
    "replace",
    "add",
    "remove",
    "move",
    "update",
    "duplicate",
    "set_title",
]
