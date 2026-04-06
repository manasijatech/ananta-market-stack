"""SQLite models: users, broker account registry, and per-broker credential tables."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
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
