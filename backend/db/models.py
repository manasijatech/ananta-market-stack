"""SQLite models: users, broker account registry, and per-broker credential tables."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

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


class BrokerAccount(Base):
    """Logical broker connection: one row per linked account (multiple per user and per broker)."""

    __tablename__ = "broker_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="broker_data_preference")


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
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), index=True, nullable=True
    )
    broker_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    level: Mapped[str] = mapped_column(String(16), default="info")
    kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(256))
    message: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, index=True
    )

    user: Mapped[User] = relationship("User", back_populates="watchlists")
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
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=True, index=True
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workflow_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("alert_workflows.id", ondelete="CASCADE"), nullable=True, index=True
    )
    account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    broker_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    symbol: Mapped[str] = mapped_column(String(128), index=True)
    exchange: Mapped[str | None] = mapped_column(String(32), nullable=True)
    instrument_ref_json: Mapped[str] = mapped_column(Text, default="{}")
    source_kind: Mapped[str] = mapped_column(String(32), default="manual")
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    last_quote_json: Mapped[str] = mapped_column(Text, default="{}")
    last_received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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
        String(36), ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=True, index=True
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
