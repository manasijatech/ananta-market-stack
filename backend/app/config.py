from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Market Stack"
    debug: bool = Field(default=False, validation_alias="APP_DEBUG")
    database_url: str = Field(
        default="sqlite:///./data/app.db",
        validation_alias="DATABASE_URL",
    )
    app_public_base_url: str | None = Field(default=None, validation_alias="APP_PUBLIC_BASE_URL")
    cors_allowed_origins: str = Field(
        default="http://localhost:3000,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002",
        validation_alias="CORS_ALLOWED_ORIGINS",
    )
    cors_allow_origin_regex: str | None = Field(
        default=r"http://(localhost|127\.0\.0\.1):\d+",
        validation_alias="CORS_ALLOW_ORIGIN_REGEX",
    )
    alpha_api_base_url: str = Field(
        default="https://developers.manasija.in",
        validation_alias="MANASIJA_API_BASE_URL",
    )

    redis_host: str = "127.0.0.1"
    redis_port: int = 6379
    redis_password: str | None = None
    redis_db: int = 0
    redis_quote_ttl_seconds: int = 30
    broker_chat_queue_name: str = Field(default="broker-chat", validation_alias="BROKER_CHAT_QUEUE_NAME")
    broker_chat_job_timeout_seconds: int = Field(
        default=600,
        validation_alias="BROKER_CHAT_JOB_TIMEOUT_SECONDS",
    )
    broker_chat_result_ttl_seconds: int = Field(
        default=24 * 60 * 60,
        validation_alias="BROKER_CHAT_RESULT_TTL_SECONDS",
    )
    broker_chat_stream_maxlen: int = Field(default=5000, validation_alias="BROKER_CHAT_STREAM_MAXLEN")
    broker_chat_history_turn_limit: int = Field(
        default=20,
        validation_alias="BROKER_CHAT_HISTORY_TURN_LIMIT",
    )
    enable_in_process_broker_chat_worker: bool = Field(
        default=False,
        validation_alias="ENABLE_IN_PROCESS_BROKER_CHAT_WORKER",
    )
    broker_chat_worker_poll_seconds: float = Field(
        default=1.0,
        validation_alias="BROKER_CHAT_WORKER_POLL_SECONDS",
    )
    system_maintenance_interval_seconds: int = Field(
        default=6 * 60 * 60,
        validation_alias="SYSTEM_MAINTENANCE_INTERVAL_SECONDS",
    )
    system_runtime_retention_days: int = Field(
        default=14,
        validation_alias="SYSTEM_RUNTIME_RETENTION_DAYS",
    )
    system_runtime_soft_row_limit: int = Field(
        default=100_000,
        validation_alias="SYSTEM_RUNTIME_SOFT_ROW_LIMIT",
    )
    system_notification_retention_days: int = Field(
        default=45,
        validation_alias="SYSTEM_NOTIFICATION_RETENTION_DAYS",
    )
    system_notification_soft_row_limit: int = Field(
        default=25_000,
        validation_alias="SYSTEM_NOTIFICATION_SOFT_ROW_LIMIT",
    )
    system_maintenance_log_retention_days: int = Field(
        default=30,
        validation_alias="SYSTEM_MAINTENANCE_LOG_RETENTION_DAYS",
    )
    system_maintenance_log_soft_row_limit: int = Field(
        default=5_000,
        validation_alias="SYSTEM_MAINTENANCE_LOG_SOFT_ROW_LIMIT",
    )
    system_llm_usage_event_retention_days: int = Field(
        default=180,
        validation_alias="SYSTEM_LLM_USAGE_EVENT_RETENTION_DAYS",
    )
    system_llm_usage_event_soft_row_limit: int = Field(
        default=250_000,
        validation_alias="SYSTEM_LLM_USAGE_EVENT_SOFT_ROW_LIMIT",
    )
    system_llm_usage_snapshot_retention_days: int = Field(
        default=730,
        validation_alias="SYSTEM_LLM_USAGE_SNAPSHOT_RETENTION_DAYS",
    )
    system_llm_usage_snapshot_soft_row_limit: int = Field(
        default=500_000,
        validation_alias="SYSTEM_LLM_USAGE_SNAPSHOT_SOFT_ROW_LIMIT",
    )
    system_sqlite_vacuum_min_interval_seconds: int = Field(
        default=24 * 60 * 60,
        validation_alias="SYSTEM_SQLITE_VACUUM_MIN_INTERVAL_SECONDS",
    )
    system_redis_rebuild_on_startup: bool = Field(
        default=True,
        validation_alias="SYSTEM_REDIS_REBUILD_ON_STARTUP",
    )

    # Fernet key (urlsafe base64 32-byte). Required for production; see AGENTS.md.
    credential_encryption_key: str | None = None
    enable_order_mutations: bool = Field(default=False, validation_alias="ENABLE_ORDER_MUTATIONS")
    enable_in_process_alert_workers: bool = Field(
        default=True,
        validation_alias="ENABLE_IN_PROCESS_ALERT_WORKERS",
    )
    enable_in_process_alpha_ws_worker: bool = Field(
        default=True,
        validation_alias="ENABLE_IN_PROCESS_ALPHA_WS_WORKER",
    )
    enable_in_process_watchlist_preset_worker: bool = Field(
        default=True,
        validation_alias="ENABLE_IN_PROCESS_WATCHLIST_PRESET_WORKER",
    )
    watchlist_preset_worker_interval_seconds: int = Field(
        default=60 * 60,
        validation_alias="WATCHLIST_PRESET_WORKER_INTERVAL_SECONDS",
    )

    # Development-only fallback if no key set (not for production).
    allow_insecure_dev_credentials: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
