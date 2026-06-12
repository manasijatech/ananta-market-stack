from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class WorkspaceOut(BaseModel):
    id: str
    name: str


class PrincipalOut(BaseModel):
    user_id: str
    workspace: WorkspaceOut
    role: str
    status: str
    permissions: list[str]
    is_admin: bool


class WorkspaceMemberOut(BaseModel):
    user_id: str
    display_name: str | None = None
    auth_name: str | None = None
    email: str | None = None
    role: str
    status: str
    created_at: datetime
    updated_at: datetime


class MemberRoleUpdateIn(BaseModel):
    role: str = Field(..., min_length=1, max_length=64)


class MemberApproveIn(BaseModel):
    role: str = Field("viewer", min_length=1, max_length=64)


class RoleOut(BaseModel):
    name: str
    label: str
    is_builtin: bool
    permissions: list[str]


class BrokerAccountGrantOut(BaseModel):
    id: str
    account_id: str
    subject_type: str
    subject_id: str
    subject_label: str
    subject_subtitle: str | None = None
    permissions: list[str]
    created_at: datetime
    updated_at: datetime


class BrokerAccountGrantUpdateIn(BaseModel):
    subject_type: str = Field(..., pattern="^(user|role)$")
    subject_id: str = Field(..., min_length=1, max_length=64)
    permissions: list[str] = Field(default_factory=list)


class SignupStatusOut(BaseModel):
    has_admin: bool
