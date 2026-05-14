import logging
import os
import sqlite3
import threading
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_dir(url: str) -> None:
    if url.startswith("sqlite:///./") or url.startswith("sqlite:///../"):
        path = url.replace("sqlite:///./", "").replace("sqlite:///../", "../")
        if "/" in path:
            d = os.path.dirname(path)
            if d:
                os.makedirs(d, exist_ok=True)


_settings = get_settings()
_ensure_sqlite_dir(_settings.database_url)

engine = create_engine(
    _settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in _settings.database_url else {},
)

if _settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
_INIT_LOCK = threading.Lock()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from db import models  # noqa: F401

    with _INIT_LOCK:
        _check_database_health()
        if _requires_sqlite_legacy_bootstrap():
            logger.info("Applying legacy SQLite bootstrap for Market-Stack database")
            Base.metadata.create_all(bind=engine)
            _apply_sqlite_legacy_patches_if_needed()
            _stamp_database_at_head()
            return
        _upgrade_database_to_head()


def _check_database_health() -> None:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))


def _requires_sqlite_legacy_bootstrap() -> bool:
    if not _settings.database_url.startswith("sqlite:///"):
        return False
    conn = sqlite3.connect(_settings.database_url.replace("sqlite:///", "", 1))
    try:
        return not _has_alembic_version_table(conn)
    finally:
        conn.close()


def _alembic_config():
    from alembic.config import Config

    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    return config


def _upgrade_database_to_head() -> None:
    from alembic import command

    logger.info("Running database migrations to head")
    command.upgrade(_alembic_config(), "head")


def _stamp_database_at_head() -> None:
    from alembic import command

    try:
        command.stamp(_alembic_config(), "head")
    except Exception:
        logger.exception("Failed to stamp legacy SQLite database at Alembic head")
        raise


def _apply_sqlite_legacy_patches_if_needed() -> None:
    if not _settings.database_url.startswith("sqlite:///"):
        return
    db_path = _settings.database_url.replace("sqlite:///", "", 1)
    conn = sqlite3.connect(db_path)
    try:
        if _has_alembic_version_table(conn):
            return
        _ensure_table_columns(
            conn,
            "broker_accounts",
            {
                "session_status": "VARCHAR(32)",
                "session_expires_at": "DATETIME",
                "automation_enabled": "BOOLEAN DEFAULT 0",
                "automation_mode": "VARCHAR(64)",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_zerodha_credentials",
            {
                "request_token_cipher": "TEXT",
                "public_token_cipher": "TEXT",
                "session_user_id_cipher": "TEXT",
                "access_token_generated_at": "DATETIME",
                "login_user_id_cipher": "TEXT",
                "login_password_cipher": "TEXT",
                "totp_secret_cipher": "TEXT",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_upstox_credentials",
            {
                "access_token_generated_at": "DATETIME",
                "extended_token_cipher": "TEXT",
                "session_user_id_cipher": "TEXT",
                "token_request_expires_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_angel_credentials",
            {
                "totp_secret_cipher": "TEXT",
                "jwt_token_generated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_dhan_credentials",
            {
                "pin_cipher": "TEXT",
                "totp_secret_cipher": "TEXT",
                "access_token_generated_at": "DATETIME",
                "access_token_expires_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_groww_credentials",
            {
                "totp_token_cipher": "TEXT",
                "totp_secret_cipher": "TEXT",
                "access_token_generated_at": "DATETIME",
                "access_token_expires_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_indmoney_credentials",
            {
                "access_token_generated_at": "DATETIME",
                "access_token_expires_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_kotak_credentials",
            {
                "mpin_cipher": "TEXT",
                "totp_secret_cipher": "TEXT",
                "session_bundle_generated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_instruments",
            {
                "id": "VARCHAR(36)",
                "broker_code": "VARCHAR(32)",
                "exchange": "VARCHAR(32)",
                "segment": "VARCHAR(64)",
                "symbol": "VARCHAR(128)",
                "trading_symbol": "VARCHAR(128)",
                "name": "VARCHAR(256)",
                "isin": "VARCHAR(64)",
                "instrument_type": "VARCHAR(64)",
                "expiry": "DATETIME",
                "strike": "VARCHAR(64)",
                "option_type": "VARCHAR(16)",
                "lot_size": "VARCHAR(32)",
                "tick_size": "VARCHAR(32)",
                "zerodha_instrument_token": "VARCHAR(64)",
                "upstox_instrument_key": "VARCHAR(128)",
                "angel_token": "VARCHAR(64)",
                "dhan_security_id": "VARCHAR(64)",
                "dhan_exchange_segment": "VARCHAR(64)",
                "groww_exchange": "VARCHAR(32)",
                "groww_segment": "VARCHAR(32)",
                "groww_trading_symbol": "VARCHAR(128)",
                "indmoney_scrip_code": "VARCHAR(64)",
                "kotak_query": "VARCHAR(256)",
                "kotak_segment": "VARCHAR(64)",
                "kotak_psymbol": "VARCHAR(128)",
                "searchable_text": "TEXT",
                "native_payload_json": "TEXT DEFAULT '{}'",
                "raw_payload_json": "TEXT DEFAULT '{}'",
                "fetched_at": "DATETIME",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_instrument_sync_runs",
            {
                "id": "VARCHAR(36)",
                "broker_code": "VARCHAR(32)",
                "status": "VARCHAR(32)",
                "started_at": "DATETIME",
                "finished_at": "DATETIME",
                "row_count": "INTEGER DEFAULT 0",
                "error": "TEXT",
            },
        )
        _ensure_table_columns(
            conn,
            "user_broker_data_preferences",
            {
                "user_id": "VARCHAR(36)",
                "preferred_search_account_id": "VARCHAR(36)",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "broker_holdings_snapshots",
            {
                "account_id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "broker_code": "VARCHAR(32)",
                "status": "VARCHAR(32) DEFAULT 'pending'",
                "holdings_count": "INTEGER DEFAULT 0",
                "payload_json": "TEXT DEFAULT '{}'",
                "error": "TEXT",
                "fetched_at": "DATETIME",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_llm_provider_credentials",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "provider": "VARCHAR(32)",
                "api_key_cipher": "TEXT DEFAULT ''",
                "is_enabled": "BOOLEAN DEFAULT 1",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_llm_models",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "provider": "VARCHAR(32)",
                "model_id": "VARCHAR(256)",
                "label": "VARCHAR(128)",
                "is_enabled": "BOOLEAN DEFAULT 1",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_alpha_api_credentials",
            {
                "user_id": "VARCHAR(36)",
                "api_key_cipher": "TEXT DEFAULT ''",
                "is_enabled": "BOOLEAN DEFAULT 1",
                "account_json": "TEXT DEFAULT '{}'",
                "account_checked_at": "DATETIME",
                "account_error": "TEXT",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_alpha_websocket_configs",
            {
                "user_id": "VARCHAR(36)",
                "is_enabled": "BOOLEAN DEFAULT 1",
                "products_json": "TEXT DEFAULT '[]'",
                "scope_mode": "VARCHAR(32) DEFAULT 'alert_subscriptions'",
                "watchlist_ids_json": "TEXT DEFAULT '[]'",
                "include_all_watchlists": "BOOLEAN DEFAULT 0",
                "full_market": "BOOLEAN DEFAULT 0",
                "last_status": "VARCHAR(32) DEFAULT 'unknown'",
                "last_error": "TEXT",
                "last_connected_at": "DATETIME",
                "last_event_at": "DATETIME",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alpha_websocket_events",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "product": "VARCHAR(32)",
                "symbol": "VARCHAR(128)",
                "event_key": "VARCHAR(256)",
                "payload_json": "TEXT DEFAULT '{}'",
                "received_at": "DATETIME",
                "processed_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alert_workflow_templates",
            {
                "id": "VARCHAR(36)",
                "slug": "VARCHAR(64)",
                "name": "VARCHAR(128)",
                "description": "TEXT DEFAULT ''",
                "category": "VARCHAR(64) DEFAULT 'general'",
                "workflow_dsl_json": "TEXT DEFAULT '{}'",
                "graph_dsl_json": "TEXT DEFAULT '{}'",
                "is_active": "BOOLEAN DEFAULT 1",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alert_workflows",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "template_id": "VARCHAR(36)",
                "account_id": "VARCHAR(36)",
                "broker_code": "VARCHAR(32)",
                "name": "VARCHAR(128)",
                "description": "TEXT DEFAULT ''",
                "symbol": "VARCHAR(128)",
                "exchange": "VARCHAR(32)",
                "instrument_ref_json": "TEXT DEFAULT '{}'",
                "workflow_dsl_json": "TEXT DEFAULT '{}'",
                "graph_dsl_json": "TEXT DEFAULT '{}'",
                "editor_mode": "VARCHAR(32) DEFAULT 'rule'",
                "status": "VARCHAR(32) DEFAULT 'active'",
                "channel_override_json": "TEXT DEFAULT '{}'",
                "deployment_status": "VARCHAR(32) DEFAULT 'draft'",
                "deploy_version": "INTEGER DEFAULT 0",
                "compiled_summary_json": "TEXT DEFAULT '{}'",
                "last_validated_at": "DATETIME",
                "last_compiled_at": "DATETIME",
                "last_runtime_error": "TEXT",
                "last_triggered_at": "DATETIME",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alert_workflow_runs",
            {
                "id": "VARCHAR(36)",
                "workflow_id": "VARCHAR(36)",
                "notification_id": "VARCHAR(36)",
                "matched": "BOOLEAN DEFAULT 0",
                "reason": "TEXT DEFAULT ''",
                "rendered_title": "VARCHAR(256) DEFAULT ''",
                "rendered_message": "TEXT DEFAULT ''",
                "channels_json": "TEXT DEFAULT '[]'",
                "tick_json": "TEXT DEFAULT '{}'",
                "evaluation_payload_json": "TEXT DEFAULT '{}'",
                "created_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "live_symbol_subscriptions",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "workflow_id": "VARCHAR(36)",
                "account_id": "VARCHAR(36)",
                "broker_code": "VARCHAR(32)",
                "symbol": "VARCHAR(128)",
                "exchange": "VARCHAR(32)",
                "instrument_ref_json": "TEXT DEFAULT '{}'",
                "source_kind": "VARCHAR(32) DEFAULT 'manual'",
                "source_type": "VARCHAR(64)",
                "source_id": "VARCHAR(64)",
                "source_label": "VARCHAR(128)",
                "owner_kind": "VARCHAR(32)",
                "owner_id": "VARCHAR(64)",
                "status": "VARCHAR(32) DEFAULT 'active'",
                "last_quote_json": "TEXT DEFAULT '{}'",
                "last_received_at": "DATETIME",
                "reconciled_at": "DATETIME",
                "health_status": "VARCHAR(32) DEFAULT 'unknown'",
                "health_reason": "TEXT DEFAULT ''",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_alert_notifications",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "workflow_id": "VARCHAR(36)",
                "template_id": "VARCHAR(36)",
                "account_id": "VARCHAR(36)",
                "broker_code": "VARCHAR(32)",
                "symbol": "VARCHAR(128)",
                "exchange": "VARCHAR(32)",
                "level": "VARCHAR(16) DEFAULT 'info'",
                "title": "VARCHAR(256)",
                "message": "TEXT",
                "status": "VARCHAR(32) DEFAULT 'new'",
                "channels_json": "TEXT DEFAULT '[]'",
                "payload_json": "TEXT DEFAULT '{}'",
                "dedupe_key": "VARCHAR(256)",
                "is_read": "BOOLEAN DEFAULT 0",
                "created_at": "DATETIME",
                "read_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_alert_channels",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "channel_type": "VARCHAR(32)",
                "label": "VARCHAR(128) DEFAULT ''",
                "is_enabled": "BOOLEAN DEFAULT 1",
                "is_default": "BOOLEAN DEFAULT 0",
                "config_cipher": "TEXT DEFAULT ''",
                "last_tested_at": "DATETIME",
                "last_error": "TEXT",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_alert_channel_deliveries",
            {
                "id": "VARCHAR(36)",
                "notification_id": "VARCHAR(36)",
                "channel_id": "VARCHAR(36)",
                "channel_type": "VARCHAR(32)",
                "status": "VARCHAR(32) DEFAULT 'pending'",
                "attempt_count": "INTEGER DEFAULT 0",
                "last_error": "TEXT",
                "payload_json": "TEXT DEFAULT '{}'",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
                "delivered_at": "DATETIME",
            },
        )
        conn.commit()
    finally:
        conn.close()


def _has_alembic_version_table(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'"
    ).fetchone()
    return row is not None


def _ensure_table_columns(
    conn: sqlite3.Connection,
    table_name: str,
    columns: dict[str, str],
) -> None:
    table_exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    if table_exists is None:
        definitions = ", ".join(f"{name} {column_type}" for name, column_type in columns.items())
        primary_key = ""
        if "id" in columns:
            primary_key = ", PRIMARY KEY (id)"
        elif table_name in {
            "user_broker_data_preferences",
            "user_alpha_api_credentials",
            "user_alpha_websocket_configs",
        }:
            primary_key = ", PRIMARY KEY (user_id)"
        elif table_name in {"broker_holdings_snapshots"}:
            primary_key = ", PRIMARY KEY (account_id)"
        conn.execute(f"CREATE TABLE {table_name} ({definitions}{primary_key})")
        return
    existing = {
        row[1]
        for row in conn.execute(f"PRAGMA table_info('{table_name}')").fetchall()
    }
    for column_name, column_type in columns.items():
        if column_name in existing:
            continue
        conn.execute(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
        )
