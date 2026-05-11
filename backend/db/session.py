import os
import sqlite3
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


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


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_sqlite_legacy_patches_if_needed()


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
        primary_key = ", PRIMARY KEY (id)" if "id" in columns else ""
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
