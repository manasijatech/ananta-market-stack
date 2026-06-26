"""SQLite models: users, broker account registry, LLM usage, and per-broker credential tables."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    workspace_memberships: Mapped[list[WorkspaceMember]] = relationship(
        "WorkspaceMember",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    broker_accounts: Mapped[list[BrokerAccount]] = relationship(
        "BrokerAccount", back_populates="user", cascade="all, delete-orphan"
    )
    broker_data_preference: Mapped[UserBrokerDataPreference | None] = relationship(
        "UserBrokerDataPreference",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    watchlists: Mapped[list[UserWatchlist]] = relationship(
        "UserWatchlist", back_populates="user", cascade="all, delete-orphan"
    )
    llm_provider_credentials: Mapped[list[UserLlmProviderCredential]] = relationship(
        "UserLlmProviderCredential",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    llm_models: Mapped[list[UserLlmModel]] = relationship(
        "UserLlmModel",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    llm_usage_events: Mapped[list[LlmUsageEvent]] = relationship(
        "LlmUsageEvent",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    llm_usage_daily_snapshots: Mapped[list[LlmUsageDailySnapshot]] = relationship(
        "LlmUsageDailySnapshot",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    alpha_api_credential: Mapped[UserAlphaApiCredential | None] = relationship(
        "UserAlphaApiCredential",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    alpha_websocket_config: Mapped[UserAlphaWebSocketConfig | None] = relationship(
        "UserAlphaWebSocketConfig",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    broker_chat_preference: Mapped[UserBrokerChatPreference | None] = relationship(
        "UserBrokerChatPreference",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    alert_workflow_chat_preference: Mapped[UserAlertWorkflowChatPreference | None] = relationship(
        "UserAlertWorkflowChatPreference",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    mcp_server_configs: Mapped[list[UserMcpServerConfig]] = relationship(
        "UserMcpServerConfig",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), default="Default workspace")
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    members: Mapped[list[WorkspaceMember]] = relationship(
        "WorkspaceMember",
        back_populates="workspace",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    broker_accounts: Mapped[list[BrokerAccount]] = relationship(
        "BrokerAccount",
        back_populates="workspace",
        passive_deletes=True,
    )


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(64), default="pending", index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    workspace: Mapped[Workspace] = relationship("Workspace", back_populates="members")
    user: Mapped[User] = relationship("User", back_populates="workspace_memberships")


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_roles_workspace_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(128), default="")
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    permissions: Mapped[list[RolePermission]] = relationship(
        "RolePermission",
        back_populates="role",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role_id", "permission", name="uq_role_permissions_role_permission"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    role_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("roles.id", ondelete="CASCADE"), index=True
    )
    permission: Mapped[str] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    role: Mapped[Role] = relationship("Role", back_populates="permissions")


class BrokerAccountGrant(Base):
    __tablename__ = "broker_account_grants"
    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "subject_type",
            "subject_id",
            name="uq_broker_account_grants_account_subject",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), index=True
    )
    subject_type: Mapped[str] = mapped_column(String(16), index=True)
    subject_id: Mapped[str] = mapped_column(String(64), index=True)
    permissions_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(128), index=True)
    resource_type: Mapped[str] = mapped_column(String(64), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class BrokerAccount(Base):
    """Logical broker connection: one row per linked account (multiple per user and per broker)."""

    __tablename__ = "broker_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    broker_code: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    session_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    automation_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    automation_mode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="broker_accounts")
    workspace: Mapped[Workspace | None] = relationship("Workspace", back_populates="broker_accounts")

    zerodha: Mapped[ZerodhaCredentials | None] = relationship(
        "ZerodhaCredentials",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )
    upstox: Mapped[UpstoxCredentials | None] = relationship(
        "UpstoxCredentials",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )
    angel: Mapped[AngelCredentials | None] = relationship(
        "AngelCredentials",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )
    dhan: Mapped[DhanCredentials | None] = relationship(
        "DhanCredentials",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )
    groww: Mapped[GrowwCredentials | None] = relationship(
        "GrowwCredentials",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )
    indmoney: Mapped[IndmoneyCredentials | None] = relationship(
        "IndmoneyCredentials",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )
    kotak: Mapped[KotakCredentials | None] = relationship(
        "KotakCredentials",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )
    holdings_snapshot: Mapped[BrokerHoldingsSnapshot | None] = relationship(
        "BrokerHoldingsSnapshot",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class UserBrokerDataPreference(Base):
    __tablename__ = "user_broker_data_preferences"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    preferred_search_account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    preferred_default_account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="broker_data_preference")


class UserBrokerChatPreference(Base):
    __tablename__ = "user_broker_chat_preferences"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    default_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    default_model: Mapped[str | None] = mapped_column(String(256), nullable=True)
    event_visibility: Mapped[str] = mapped_column(String(32), default="minimal")
    include_tool_outputs: Mapped[bool] = mapped_column(Boolean, default=False)
    include_reasoning: Mapped[bool] = mapped_column(Boolean, default=False)
    use_mcp: Mapped[bool] = mapped_column(Boolean, default=False)
    mcp_server_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="broker_chat_preference")


class UserMcpServerConfig(Base):
    __tablename__ = "user_mcp_server_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    use_by_default: Mapped[bool] = mapped_column(Boolean, default=True)
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    url: Mapped[str] = mapped_column(Text, default="")
    transport: Mapped[str] = mapped_column(String(32), default="streamable_http")
    api_key_cipher: Mapped[str] = mapped_column(Text, default="")
    api_key_header_name: Mapped[str] = mapped_column(String(128), default="Authorization")
    api_key_prefix: Mapped[str] = mapped_column(String(64), default="Bearer")
    oauth_access_token_cipher: Mapped[str] = mapped_column(Text, default="")
    oauth_refresh_token_cipher: Mapped[str] = mapped_column(Text, default="")
    oauth_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    oauth_client_id: Mapped[str] = mapped_column(Text, default="")
    oauth_client_secret_cipher: Mapped[str] = mapped_column(Text, default="")
    oauth_auth_metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    oauth_state: Mapped[str] = mapped_column(String(128), default="")
    oauth_code_verifier_cipher: Mapped[str] = mapped_column(Text, default="")
    oauth_redirect_uri: Mapped[str] = mapped_column(Text, default="")
    oauth_scope: Mapped[str] = mapped_column(Text, default="")
    oauth_authorized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    oauth_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    inventory_json: Mapped[str] = mapped_column(Text, default="{}")
    inventory_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    inventory_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_headers_json: Mapped[str] = mapped_column(Text, default="{}")
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=15)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="mcp_server_configs")


class BrokerChatSession(Base):
    __tablename__ = "broker_chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(256), default="Broker chat")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )


class BrokerChatRun(Base):
    __tablename__ = "broker_chat_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    job_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(32), default="")
    model_id: Mapped[str] = mapped_column(String(256), default="")
    message: Mapped[str] = mapped_column(Text)
    response_text: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_visibility: Mapped[str] = mapped_column(String(32), default="minimal")
    include_tool_outputs: Mapped[bool] = mapped_column(Boolean, default=False)
    include_reasoning: Mapped[bool] = mapped_column(Boolean, default=False)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    queued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )


class BrokerChatEvent(Base):
    __tablename__ = "broker_chat_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_chat_runs.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    public_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    full_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    redis_stream_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UserAlertWorkflowChatPreference(Base):
    __tablename__ = "user_alert_workflow_chat_preferences"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    default_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    default_model: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="alert_workflow_chat_preference")


class AlertWorkflowChatSession(Base):
    __tablename__ = "alert_workflow_chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workflow_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflows.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(256), default="Workflow AI chat")
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    active_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )


class AlertWorkflowChatRun(Base):
    __tablename__ = "alert_workflow_chat_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alert_workflow_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workflow_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflows.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    job_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(32), default="")
    model_id: Mapped[str] = mapped_column(String(256), default="")
    message: Mapped[str] = mapped_column(Text)
    response_text: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    queued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )


class AlertWorkflowChatEvent(Base):
    __tablename__ = "alert_workflow_chat_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alert_workflow_chat_runs.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alert_workflow_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    public_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    full_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    redis_stream_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AlertWorkflowChatSnapshot(Base):
    __tablename__ = "alert_workflow_chat_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alert_workflow_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflow_chat_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    workflow_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alert_workflows.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1, index=True)
    label: Mapped[str] = mapped_column(String(256), default="Workflow snapshot")
    workflow_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    validation_json: Mapped[str] = mapped_column(Text, default="{}")
    compile_json: Mapped[str] = mapped_column(Text, default="{}")
    explanation_json: Mapped[str] = mapped_column(Text, default="{}")
    samples_json: Mapped[str] = mapped_column(Text, default="{}")
    diff_json: Mapped[str] = mapped_column(Text, default="{}")
    valid: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class BrokerHoldingsSnapshot(Base):
    __tablename__ = "broker_holdings_snapshots"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    broker_code: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    holdings_count: Mapped[int] = mapped_column(Integer, default=0)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="holdings_snapshot")


class UserLlmProviderCredential(Base):
    __tablename__ = "user_llm_provider_credentials"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32), index=True)
    api_key_cipher: Mapped[str] = mapped_column(Text, default="")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="llm_provider_credentials")


class UserLlmModel(Base):
    __tablename__ = "user_llm_models"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32), index=True)
    model_id: Mapped[str] = mapped_column(String(256), index=True)
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="llm_models")


class LlmUsageEvent(Base):
    __tablename__ = "llm_usage_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32), index=True)
    model_id: Mapped[str] = mapped_column(String(256), index=True)
    api_surface: Mapped[str] = mapped_column(String(64), default="chat_completions", index=True)
    request_kind: Mapped[str] = mapped_column(String(64), default="generic", index=True)
    status: Mapped[str] = mapped_column(String(32), default="success", index=True)
    provider_response_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    workflow_ref: Mapped[str] = mapped_column(String(64), default="", index=True)
    workflow_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    workflow_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    workflow_status: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    workflow_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    template_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    account_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, default=0)
    input_audio_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_audio_tokens: Mapped[int] = mapped_column(Integer, default=0)
    image_tokens: Mapped[int] = mapped_column(Integer, default=0)
    video_tokens: Mapped[int] = mapped_column(Integer, default=0)
    provider_cost: Mapped[float | None] = mapped_column(nullable=True)
    provider_cost_currency: Mapped[str | None] = mapped_column(String(32), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_byok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    usage_json: Mapped[str] = mapped_column(Text, default="{}")
    cost_details_json: Mapped[str] = mapped_column(Text, default="{}")
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    user: Mapped[User] = relationship("User", back_populates="llm_usage_events")


class LlmUsageDailySnapshot(Base):
    __tablename__ = "llm_usage_daily_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "bucket_date",
            "provider",
            "model_id",
            "api_surface",
            "request_kind",
            "workflow_ref",
            name="uq_llm_usage_daily_snapshot_dimensions",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    bucket_date: Mapped[date] = mapped_column(Date, index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    model_id: Mapped[str] = mapped_column(String(256), index=True)
    api_surface: Mapped[str] = mapped_column(String(64), default="chat_completions", index=True)
    request_kind: Mapped[str] = mapped_column(String(64), default="generic", index=True)
    workflow_ref: Mapped[str] = mapped_column(String(64), default="", index=True)
    workflow_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    workflow_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    workflow_status: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    workflow_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    template_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    account_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    request_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens_reported_count: Mapped[int] = mapped_column(Integer, default=0)
    reasoning_tokens_reported_count: Mapped[int] = mapped_column(Integer, default=0)
    input_audio_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_audio_tokens: Mapped[int] = mapped_column(Integer, default=0)
    image_tokens: Mapped[int] = mapped_column(Integer, default=0)
    video_tokens: Mapped[int] = mapped_column(Integer, default=0)
    provider_cost_total: Mapped[float] = mapped_column(default=0.0)
    priced_request_count: Mapped[int] = mapped_column(Integer, default=0)
    last_request_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="llm_usage_daily_snapshots")


class UserAlphaApiCredential(Base):
    __tablename__ = "user_alpha_api_credentials"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    api_key_cipher: Mapped[str] = mapped_column(Text, default="")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    account_json: Mapped[str] = mapped_column(Text, default="{}")
    account_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    account_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="alpha_api_credential")


class UserAlphaWebSocketConfig(Base):
    __tablename__ = "user_alpha_websocket_configs"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    products_json: Mapped[str] = mapped_column(Text, default="[]")
    scope_mode: Mapped[str] = mapped_column(String(32), default="alert_subscriptions")
    watchlist_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    include_all_watchlists: Mapped[bool] = mapped_column(Boolean, default=False)
    full_market: Mapped[bool] = mapped_column(Boolean, default=False)
    last_status: Mapped[str] = mapped_column(String(32), default="unknown")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_connected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="alpha_websocket_config")


class AlphaWebSocketEvent(Base):
    __tablename__ = "alpha_websocket_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    product: Mapped[str] = mapped_column(String(32), index=True)
    symbol: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    event_key: Mapped[str] = mapped_column(String(256), index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class AlphaSymbolMetadataCache(Base):
    __tablename__ = "alpha_symbol_metadata_cache"

    symbol: Mapped[str] = mapped_column(String(128), primary_key=True)
    company_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    market_cap: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    basic_industry: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    industry: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    macro_economic_indicator: Mapped[str | None] = mapped_column(String(128), nullable=True)
    theme: Mapped[str | None] = mapped_column(String(128), nullable=True)
    scrip_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    raw_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class ZerodhaCredentials(Base):
    __tablename__ = "broker_zerodha_credentials"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    api_key_cipher: Mapped[str] = mapped_column(Text)
    api_secret_cipher: Mapped[str] = mapped_column(Text)
    access_token_cipher: Mapped[str] = mapped_column(Text)
    request_token_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_token_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_user_id_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    login_user_id_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    login_password_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_secret_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="zerodha")


class UpstoxCredentials(Base):
    __tablename__ = "broker_upstox_credentials"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    api_key_cipher: Mapped[str] = mapped_column(Text)
    api_secret_cipher: Mapped[str] = mapped_column(Text)
    redirect_uri_cipher: Mapped[str] = mapped_column(Text)
    access_token_cipher: Mapped[str] = mapped_column(Text)
    access_token_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    extended_token_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_user_id_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_request_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="upstox")


class AngelCredentials(Base):
    __tablename__ = "broker_angel_credentials"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    api_key_cipher: Mapped[str] = mapped_column(Text)
    client_code_cipher: Mapped[str] = mapped_column(Text)
    pin_cipher: Mapped[str] = mapped_column(Text, nullable=True)
    jwt_token_cipher: Mapped[str] = mapped_column(Text)
    feed_token_cipher: Mapped[str] = mapped_column(Text, nullable=True)
    totp_secret_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    jwt_token_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="angel")


class DhanCredentials(Base):
    __tablename__ = "broker_dhan_credentials"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    app_id_cipher: Mapped[str] = mapped_column(Text)
    app_secret_cipher: Mapped[str] = mapped_column(Text)
    client_id_cipher: Mapped[str] = mapped_column(Text)
    access_token_cipher: Mapped[str] = mapped_column(Text)
    pin_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_secret_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="dhan")


class GrowwCredentials(Base):
    __tablename__ = "broker_groww_credentials"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    api_key_cipher: Mapped[str] = mapped_column(Text)
    api_secret_cipher: Mapped[str] = mapped_column(Text)
    access_token_cipher: Mapped[str] = mapped_column(Text)
    totp_token_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_secret_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="groww")


class IndmoneyCredentials(Base):
    __tablename__ = "broker_indmoney_credentials"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    access_token_cipher: Mapped[str] = mapped_column(Text)
    access_token_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="indmoney")


class KotakCredentials(Base):
    __tablename__ = "broker_kotak_credentials"

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    ucc_cipher: Mapped[str] = mapped_column(Text)
    portal_access_token_cipher: Mapped[str] = mapped_column(Text)
    mobile_number_cipher: Mapped[str] = mapped_column(Text, nullable=True)
    session_bundle_cipher: Mapped[str] = mapped_column(Text, nullable=True)
    mpin_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_secret_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_bundle_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[BrokerAccount] = relationship("BrokerAccount", back_populates="kotak")


class BrokerNotification(Base):
    __tablename__ = "broker_notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="SET NULL"), index=True, nullable=True
    )
    broker_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    level: Mapped[str] = mapped_column(String(16), default="info")
    kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(256))
    message: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SystemMaintenanceLog(Base):
    __tablename__ = "system_maintenance_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_name: Mapped[str] = mapped_column(String(64), index=True)
    trigger: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    deleted_rows: Mapped[int] = mapped_column(Integer, default=0)
    deleted_redis_keys: Mapped[int] = mapped_column(Integer, default=0)
    rebuilt_redis_keys: Mapped[int] = mapped_column(Integer, default=0)
    vacuum_performed: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class SystemDeploymentState(Base):
    __tablename__ = "system_deployment_state"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    running_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    running_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    running_digest: Mapped[str | None] = mapped_column(String(128), nullable=True)
    latest_digest: Mapped[str | None] = mapped_column(String(128), nullable=True)
    update_available: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_check_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class UserWatchlist(Base):
    __tablename__ = "user_watchlists"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_user_watchlists_user_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="manual", index=True)
    system_preset_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("system_watchlist_presets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, index=True
    )

    user: Mapped[User] = relationship("User", back_populates="watchlists")
    system_preset: Mapped[SystemWatchlistPreset | None] = relationship(
        "SystemWatchlistPreset",
        back_populates="watchlist_links",
    )
    symbols: Mapped[list[UserWatchlistSymbol]] = relationship(
        "UserWatchlistSymbol",
        back_populates="watchlist",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="UserWatchlistSymbol.sort_order",
    )


class UserWatchlistSymbol(Base):
    __tablename__ = "user_watchlist_symbols"
    __table_args__ = (
        UniqueConstraint(
            "watchlist_id",
            "symbol",
            "exchange",
            name="uq_user_watchlist_symbols_symbol_exchange",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    watchlist_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("user_watchlists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    instrument_ref_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    watchlist: Mapped[UserWatchlist] = relationship("UserWatchlist", back_populates="symbols")


class SystemWatchlistPreset(Base):
    __tablename__ = "system_watchlist_presets"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_system_watchlist_presets_slug"),
        UniqueConstraint("trading_index_name", name="uq_system_watchlist_presets_trading_index_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    slug: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    trading_index_name: Mapped[str] = mapped_column(String(256), nullable=False)
    constituent_csv_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    constituent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    search_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sync_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_popular: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    auto_sync_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    last_catalog_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_constituents_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, index=True
    )

    symbols: Mapped[list[SystemWatchlistPresetSymbol]] = relationship(
        "SystemWatchlistPresetSymbol",
        back_populates="preset",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="SystemWatchlistPresetSymbol.sort_order",
    )
    watchlist_links: Mapped[list[UserWatchlist]] = relationship(
        "UserWatchlist",
        back_populates="system_preset",
    )


class SystemWatchlistPresetSymbol(Base):
    __tablename__ = "system_watchlist_preset_symbols"
    __table_args__ = (
        UniqueConstraint(
            "preset_id",
            "symbol",
            "exchange",
            name="uq_system_watchlist_preset_symbols_symbol_exchange",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    preset_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("system_watchlist_presets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    symbol: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False, default="NSE")
    company_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(256), nullable=True)
    isin: Mapped[str | None] = mapped_column(String(64), nullable=True)
    series: Mapped[str | None] = mapped_column(String(32), nullable=True)
    weight: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    raw_row_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    preset: Mapped[SystemWatchlistPreset] = relationship("SystemWatchlistPreset", back_populates="symbols")


class BrokerInstrument(Base):
    __tablename__ = "broker_instruments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    broker_code: Mapped[str] = mapped_column(String(32), index=True)
    exchange: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    segment: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    symbol: Mapped[str] = mapped_column(String(128), index=True)
    trading_symbol: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    isin: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    instrument_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    expiry: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    strike: Mapped[str | None] = mapped_column(String(64), nullable=True)
    option_type: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    lot_size: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tick_size: Mapped[str | None] = mapped_column(String(32), nullable=True)
    zerodha_instrument_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    upstox_instrument_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    angel_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    dhan_security_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    dhan_exchange_segment: Mapped[str | None] = mapped_column(String(64), nullable=True)
    groww_exchange: Mapped[str | None] = mapped_column(String(32), nullable=True)
    groww_segment: Mapped[str | None] = mapped_column(String(32), nullable=True)
    groww_trading_symbol: Mapped[str | None] = mapped_column(String(128), nullable=True)
    indmoney_scrip_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    kotak_query: Mapped[str | None] = mapped_column(String(256), nullable=True)
    kotak_segment: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kotak_psymbol: Mapped[str | None] = mapped_column(String(128), nullable=True)
    searchable_text: Mapped[str] = mapped_column(Text, index=True)
    native_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    raw_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class BrokerMarketCandleCache(Base):
    __tablename__ = "broker_market_candle_cache"
    __table_args__ = (
        UniqueConstraint(
            "broker_code",
            "symbol",
            "exchange",
            "interval",
            "candle_time",
            name="uq_broker_market_candle_cache_series_time",
        ),
    )

    broker_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(128), primary_key=True)
    exchange: Mapped[str] = mapped_column(String(32), primary_key=True, default="")
    interval: Mapped[str] = mapped_column(String(32), primary_key=True)
    candle_time: Mapped[datetime] = mapped_column(DateTime, primary_key=True, index=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )


class BrokerInstrumentSyncRun(Base):
    __tablename__ = "broker_instrument_sync_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    broker_code: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    row_count: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AlertWorkflowTemplate(Base):
    __tablename__ = "alert_workflow_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(64), default="general")
    workflow_dsl_json: Mapped[str] = mapped_column(Text, default="{}")
    graph_dsl_json: Mapped[str] = mapped_column(Text, default="{}")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class AlertWorkflow(Base):
    __tablename__ = "alert_workflows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    template_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflow_templates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    broker_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    symbol: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    exchange: Mapped[str | None] = mapped_column(String(32), nullable=True)
    instrument_ref_json: Mapped[str] = mapped_column(Text, default="{}")
    workflow_dsl_json: Mapped[str] = mapped_column(Text, default="{}")
    graph_dsl_json: Mapped[str] = mapped_column(Text, default="{}")
    editor_mode: Mapped[str] = mapped_column(String(32), default="rule")
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    channel_override_json: Mapped[str] = mapped_column(Text, default="{}")
    deployment_status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    deploy_version: Mapped[int] = mapped_column(Integer, default=0)
    compiled_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_compiled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_runtime_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class AlertWorkflowRun(Base):
    __tablename__ = "alert_workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("alert_workflows.id", ondelete="CASCADE"), index=True
    )
    notification_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user_alert_notifications.id", ondelete="SET NULL"), nullable=True, index=True
    )
    matched: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    rendered_title: Mapped[str] = mapped_column(String(256), default="")
    rendered_message: Mapped[str] = mapped_column(Text, default="")
    channels_json: Mapped[str] = mapped_column(Text, default="[]")
    tick_json: Mapped[str] = mapped_column(Text, default="{}")
    evaluation_payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class LiveSymbolSubscription(Base):
    __tablename__ = "live_symbol_subscriptions"
    __mapper_args__ = {"confirm_deleted_rows": False}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workflow_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflows.id", ondelete="CASCADE"), nullable=True, index=True
    )
    account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    broker_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    symbol: Mapped[str] = mapped_column(String(128), index=True)
    exchange: Mapped[str | None] = mapped_column(String(32), nullable=True)
    instrument_ref_json: Mapped[str] = mapped_column(Text, default="{}")
    source_kind: Mapped[str] = mapped_column(String(32), default="manual")
    source_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    owner_kind: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    owner_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    last_quote_json: Mapped[str] = mapped_column(Text, default="{}")
    last_received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    health_status: Mapped[str] = mapped_column(String(32), default="unknown", index=True)
    health_reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class UserAlertNotification(Base):
    __tablename__ = "user_alert_notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workflow_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflows.id", ondelete="SET NULL"), nullable=True, index=True
    )
    template_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflow_templates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    broker_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    symbol: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    exchange: Mapped[str | None] = mapped_column(String(32), nullable=True)
    level: Mapped[str] = mapped_column(String(16), default="info")
    title: Mapped[str] = mapped_column(String(256))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="new", index=True)
    channels_json: Mapped[str] = mapped_column(Text, default="[]")
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    dedupe_key: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UserAlertChannel(Base):
    __tablename__ = "user_alert_channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    channel_type: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str] = mapped_column(String(128), default="")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    config_cipher: Mapped[str] = mapped_column(Text, default="")
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class UserAlertChannelDelivery(Base):
    __tablename__ = "user_alert_channel_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    notification_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("user_alert_notifications.id", ondelete="CASCADE"), index=True
    )
    channel_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user_alert_channels.id", ondelete="SET NULL"), nullable=True, index=True
    )
    channel_type: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
