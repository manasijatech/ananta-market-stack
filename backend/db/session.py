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
_SQLITE_BUSY_TIMEOUT_MS = 30_000

engine = create_engine(
    _settings.database_url,
    connect_args={
        "check_same_thread": False,
        "timeout": _SQLITE_BUSY_TIMEOUT_MS / 1000,
    }
    if "sqlite" in _settings.database_url
    else {},
)

if _settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA wal_autocheckpoint=1000")
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
        _enable_sqlite_wal()
        _check_database_health()
        if _requires_sqlite_legacy_bootstrap():
            logger.info("Applying legacy SQLite bootstrap for ananta-market-stack database")
            Base.metadata.create_all(bind=engine)
            _apply_sqlite_legacy_patches_if_needed()
            _stamp_database_at_head()
            _repair_installation_access_after_migration()
            return
        _upgrade_database_to_head()
        _repair_installation_access_after_migration()


def _enable_sqlite_wal() -> None:
    if not _settings.database_url.startswith("sqlite"):
        return
    with engine.connect() as conn:
        journal_mode = conn.exec_driver_sql("PRAGMA journal_mode=WAL").scalar()
    if str(journal_mode).lower() != "wal":
        raise RuntimeError(f"Could not enable SQLite WAL mode; active mode is {journal_mode!r}")


def _repair_installation_access_after_migration() -> None:
    try:
        from app.services.rbac import repair_installation_without_admin

        db = SessionLocal()
        try:
            repaired = repair_installation_without_admin(db)
            if repaired:
                logger.info("Repaired RBAC admin access for %s pending member(s)", repaired)
        finally:
            db.close()
    except Exception:
        logger.exception("Failed to repair installation RBAC access")


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
            "users",
            {
                "email": "VARCHAR(320)",
            },
        )
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
                "preferred_default_account_id": "VARCHAR(36)",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_broker_chat_preferences",
            {
                "user_id": "VARCHAR(36)",
                "default_provider": "VARCHAR(32)",
                "default_model": "VARCHAR(256)",
                "event_visibility": "VARCHAR(32) DEFAULT 'minimal'",
                "include_tool_outputs": "BOOLEAN DEFAULT 0",
                "include_reasoning": "BOOLEAN DEFAULT 0",
                "use_mcp": "BOOLEAN DEFAULT 0",
                "mcp_server_ids_json": "TEXT DEFAULT '[]'",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_alert_workflow_chat_preferences",
            {
                "user_id": "VARCHAR(36)",
                "default_provider": "VARCHAR(32)",
                "default_model": "VARCHAR(256)",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "user_mcp_server_configs",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "is_enabled": "BOOLEAN DEFAULT 0",
                "use_by_default": "BOOLEAN DEFAULT 1",
                "name": "VARCHAR(128)",
                "url": "TEXT DEFAULT ''",
                "transport": "VARCHAR(32) DEFAULT 'streamable_http'",
                "api_key_cipher": "TEXT DEFAULT ''",
                "api_key_header_name": "VARCHAR(128) DEFAULT 'Authorization'",
                "api_key_prefix": "VARCHAR(64) DEFAULT 'Bearer'",
                "oauth_access_token_cipher": "TEXT DEFAULT ''",
                "oauth_refresh_token_cipher": "TEXT DEFAULT ''",
                "oauth_token_expires_at": "DATETIME",
                "oauth_client_id": "TEXT DEFAULT ''",
                "oauth_client_secret_cipher": "TEXT DEFAULT ''",
                "oauth_auth_metadata_json": "TEXT DEFAULT '{}'",
                "oauth_state": "VARCHAR(128) DEFAULT ''",
                "oauth_code_verifier_cipher": "TEXT DEFAULT ''",
                "oauth_redirect_uri": "TEXT DEFAULT ''",
                "oauth_scope": "TEXT DEFAULT ''",
                "oauth_authorized_at": "DATETIME",
                "oauth_last_error": "TEXT",
                "inventory_json": "TEXT DEFAULT '{}'",
                "inventory_checked_at": "DATETIME",
                "inventory_error": "TEXT",
                "extra_headers_json": "TEXT DEFAULT '{}'",
                "timeout_seconds": "INTEGER DEFAULT 15",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_mcp_server_configs_multi_server_table(conn)
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
            "alpha_symbol_metadata_cache",
            {
                "symbol": "VARCHAR(128)",
                "company_name": "VARCHAR(256)",
                "logo": "TEXT",
                "market_cap": "VARCHAR(64)",
                "sector": "VARCHAR(128)",
                "basic_industry": "VARCHAR(128)",
                "industry": "VARCHAR(128)",
                "macro_economic_indicator": "VARCHAR(128)",
                "theme": "VARCHAR(128)",
                "scrip_code": "VARCHAR(64)",
                "raw_payload_json": "TEXT DEFAULT '{}'",
                "fetched_at": "DATETIME",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
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
            "alert_workflow_chat_sessions",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "workflow_id": "VARCHAR(36)",
                "title": "VARCHAR(256) DEFAULT 'Workflow AI chat'",
                "status": "VARCHAR(32) DEFAULT 'active'",
                "active_snapshot_id": "VARCHAR(36)",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alert_workflow_chat_runs",
            {
                "id": "VARCHAR(36)",
                "session_id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "workflow_id": "VARCHAR(36)",
                "status": "VARCHAR(32) DEFAULT 'queued'",
                "job_id": "VARCHAR(128)",
                "provider": "VARCHAR(32) DEFAULT ''",
                "model_id": "VARCHAR(256) DEFAULT ''",
                "message": "TEXT",
                "response_text": "TEXT DEFAULT ''",
                "error": "TEXT",
                "metadata_json": "TEXT DEFAULT '{}'",
                "queued_at": "DATETIME",
                "started_at": "DATETIME",
                "completed_at": "DATETIME",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alert_workflow_chat_events",
            {
                "id": "VARCHAR(36)",
                "run_id": "VARCHAR(36)",
                "session_id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "sequence": "INTEGER",
                "event_type": "VARCHAR(64)",
                "public_payload_json": "TEXT DEFAULT '{}'",
                "full_payload_json": "TEXT DEFAULT '{}'",
                "redis_stream_id": "VARCHAR(64)",
                "created_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alert_workflow_chat_snapshots",
            {
                "id": "VARCHAR(36)",
                "session_id": "VARCHAR(36)",
                "run_id": "VARCHAR(36)",
                "workflow_id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "version": "INTEGER DEFAULT 1",
                "label": "VARCHAR(256) DEFAULT 'Workflow snapshot'",
                "workflow_payload_json": "TEXT DEFAULT '{}'",
                "validation_json": "TEXT DEFAULT '{}'",
                "compile_json": "TEXT DEFAULT '{}'",
                "explanation_json": "TEXT DEFAULT '{}'",
                "samples_json": "TEXT DEFAULT '{}'",
                "diff_json": "TEXT DEFAULT '{}'",
                "valid": "BOOLEAN DEFAULT 0",
                "applied_at": "DATETIME",
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
        _ensure_table_columns(
            conn,
            "desktop_audio_devices",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "label": "VARCHAR(128) DEFAULT ''",
                "token_hash": "VARCHAR(128)",
                "status": "VARCHAR(32) DEFAULT 'active'",
                "last_seen_at": "DATETIME",
                "last_ack_asset_id": "VARCHAR(36)",
                "revoked_at": "DATETIME",
                "metadata_json": "TEXT DEFAULT '{}'",
                "created_at": "DATETIME",
                "updated_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "desktop_audio_pairings",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "secret_hash": "VARCHAR(128)",
                "status": "VARCHAR(32) DEFAULT 'pending'",
                "expires_at": "DATETIME",
                "completed_device_id": "VARCHAR(36)",
                "metadata_json": "TEXT DEFAULT '{}'",
                "created_at": "DATETIME",
                "completed_at": "DATETIME",
            },
        )
        _ensure_table_columns(
            conn,
            "alert_audio_assets",
            {
                "id": "VARCHAR(36)",
                "user_id": "VARCHAR(36)",
                "notification_id": "VARCHAR(36)",
                "delivery_id": "VARCHAR(36)",
                "device_id": "VARCHAR(36)",
                "generated_text": "TEXT DEFAULT ''",
                "model_id": "VARCHAR(256) DEFAULT ''",
                "voice": "VARCHAR(128) DEFAULT ''",
                "response_format": "VARCHAR(32) DEFAULT 'mp3'",
                "file_path": "TEXT DEFAULT ''",
                "mime_type": "VARCHAR(128) DEFAULT 'audio/mpeg'",
                "byte_size": "INTEGER DEFAULT 0",
                "status": "VARCHAR(32) DEFAULT 'pending'",
                "last_error": "TEXT",
                "acknowledged_at": "DATETIME",
                "created_at": "DATETIME",
                "expires_at": "DATETIME",
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
            "user_broker_chat_preferences",
            "user_alert_workflow_chat_preferences",
            "user_mcp_server_configs",
            "user_alpha_api_credentials",
            "user_alpha_websocket_configs",
        }:
            primary_key = ", PRIMARY KEY (user_id)"
        elif table_name in {"broker_holdings_snapshots"}:
            primary_key = ", PRIMARY KEY (account_id)"
        elif table_name in {"alpha_symbol_metadata_cache"}:
            primary_key = ", PRIMARY KEY (symbol)"
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


def _ensure_mcp_server_configs_multi_server_table(conn: sqlite3.Connection) -> None:
    table_exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_mcp_server_configs'"
    ).fetchone()
    if table_exists is None:
        return
    columns = conn.execute("PRAGMA table_info('user_mcp_server_configs')").fetchall()
    id_column = next((row for row in columns if row[1] == "id"), None)
    if id_column is not None and int(id_column[5] or 0) == 1:
        return

    conn.execute("ALTER TABLE user_mcp_server_configs RENAME TO user_mcp_server_configs_single")
    conn.execute(
        """
        CREATE TABLE user_mcp_server_configs (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36),
            is_enabled BOOLEAN DEFAULT 0,
            use_by_default BOOLEAN DEFAULT 1,
            name VARCHAR(128),
            url TEXT DEFAULT '',
            transport VARCHAR(32) DEFAULT 'streamable_http',
            api_key_cipher TEXT DEFAULT '',
            api_key_header_name VARCHAR(128) DEFAULT 'Authorization',
            api_key_prefix VARCHAR(64) DEFAULT 'Bearer',
            oauth_access_token_cipher TEXT DEFAULT '',
            oauth_refresh_token_cipher TEXT DEFAULT '',
            oauth_token_expires_at DATETIME,
            oauth_client_id TEXT DEFAULT '',
            oauth_client_secret_cipher TEXT DEFAULT '',
            oauth_auth_metadata_json TEXT DEFAULT '{}',
            oauth_state VARCHAR(128) DEFAULT '',
            oauth_code_verifier_cipher TEXT DEFAULT '',
            oauth_redirect_uri TEXT DEFAULT '',
            oauth_scope TEXT DEFAULT '',
            oauth_authorized_at DATETIME,
            oauth_last_error TEXT,
            inventory_json TEXT DEFAULT '{}',
            inventory_checked_at DATETIME,
            inventory_error TEXT,
            extra_headers_json TEXT DEFAULT '{}',
            timeout_seconds INTEGER DEFAULT 15,
            created_at DATETIME,
            updated_at DATETIME
        )
        """
    )
    existing = {row[1] for row in columns}
    select_parts = [
        "COALESCE(NULLIF(id, ''), lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))"
        if "id" in existing
        else "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))",
        "user_id",
        "COALESCE(is_enabled, 0)",
        "COALESCE(use_by_default, 1)" if "use_by_default" in existing else "1",
        "name",
        "COALESCE(url, '')",
        "COALESCE(transport, 'streamable_http')",
        "COALESCE(api_key_cipher, '')",
        "COALESCE(api_key_header_name, 'Authorization')",
        "COALESCE(api_key_prefix, 'Bearer')",
        "COALESCE(oauth_access_token_cipher, '')" if "oauth_access_token_cipher" in existing else "''",
        "COALESCE(oauth_refresh_token_cipher, '')" if "oauth_refresh_token_cipher" in existing else "''",
        "oauth_token_expires_at" if "oauth_token_expires_at" in existing else "NULL",
        "COALESCE(oauth_client_id, '')" if "oauth_client_id" in existing else "''",
        "COALESCE(oauth_client_secret_cipher, '')" if "oauth_client_secret_cipher" in existing else "''",
        "COALESCE(oauth_auth_metadata_json, '{}')" if "oauth_auth_metadata_json" in existing else "'{}'",
        "COALESCE(oauth_state, '')" if "oauth_state" in existing else "''",
        "COALESCE(oauth_code_verifier_cipher, '')" if "oauth_code_verifier_cipher" in existing else "''",
        "COALESCE(oauth_redirect_uri, '')" if "oauth_redirect_uri" in existing else "''",
        "COALESCE(oauth_scope, '')" if "oauth_scope" in existing else "''",
        "oauth_authorized_at" if "oauth_authorized_at" in existing else "NULL",
        "oauth_last_error" if "oauth_last_error" in existing else "NULL",
        "COALESCE(inventory_json, '{}')" if "inventory_json" in existing else "'{}'",
        "inventory_checked_at" if "inventory_checked_at" in existing else "NULL",
        "inventory_error" if "inventory_error" in existing else "NULL",
        "COALESCE(extra_headers_json, '{}')",
        "COALESCE(timeout_seconds, 15)",
        "created_at",
        "updated_at",
    ]
    conn.execute(
        "INSERT INTO user_mcp_server_configs "
        "(id,user_id,is_enabled,use_by_default,name,url,transport,api_key_cipher,api_key_header_name,api_key_prefix,"
        "oauth_access_token_cipher,oauth_refresh_token_cipher,oauth_token_expires_at,oauth_client_id,oauth_client_secret_cipher,"
        "oauth_auth_metadata_json,oauth_state,oauth_code_verifier_cipher,oauth_redirect_uri,oauth_scope,oauth_authorized_at,"
        "oauth_last_error,inventory_json,inventory_checked_at,inventory_error,extra_headers_json,timeout_seconds,"
        "created_at,updated_at) "
        f"SELECT {', '.join(select_parts)} FROM user_mcp_server_configs_single"
    )
    conn.execute("DROP TABLE user_mcp_server_configs_single")
