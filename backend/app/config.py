from functools import lru_cache
from urllib.parse import urlparse

from pydantic import Field
from pydantic import field_validator
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Ananta Market Stack"
    debug: bool = Field(default=False, validation_alias="APP_DEBUG")
    log_to_file: bool | None = Field(default=None, validation_alias="LOG_TO_FILE")
    log_file_path: str = Field(default="./data/logs/backend-debug.log", validation_alias="LOG_FILE_PATH")
    log_file_max_bytes: int = Field(default=50 * 1024 * 1024, validation_alias="LOG_FILE_MAX_BYTES")
    log_file_backup_count: int = Field(default=3, validation_alias="LOG_FILE_BACKUP_COUNT")
    log_level: str | None = Field(default=None, validation_alias="LOG_LEVEL")
    database_url: str = Field(
        default="sqlite:///./data/app.db",
        validation_alias="DATABASE_URL",
    )
    app_public_base_url: str | None = Field(default=None, validation_alias="APP_PUBLIC_BASE_URL")
    market_stack_public_app_url: str | None = Field(default=None, validation_alias="MARKET_STACK_PUBLIC_APP_URL")
    next_public_app_url: str | None = Field(default=None, validation_alias="NEXT_PUBLIC_APP_URL")
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
    redis_username: str | None = None
    redis_password: str | None = None
    redis_db: int = 0
    redis_ssl: bool = False
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
    redis_quote_ttl_seconds: int = 30
    redis_live_price_ttl_seconds: int = Field(
        default=30 * 60,
        validation_alias="REDIS_LIVE_PRICE_TTL_SECONDS",
    )
    arrow_enable_greeks: bool = Field(default=False, validation_alias="ARROW_ENABLE_GREEKS")
    arrow_standard_stream_symbol_limit: int = Field(
        default=1000,
        ge=1,
        validation_alias="ARROW_STANDARD_STREAM_SYMBOL_LIMIT",
    )
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
    broker_chat_worker_poll_seconds: float = Field(
        default=1.0,
        validation_alias="BROKER_CHAT_WORKER_POLL_SECONDS",
    )
    alert_workflow_chat_queue_name: str = Field(
        default="alert-workflow-chat",
        validation_alias="ALERT_WORKFLOW_CHAT_QUEUE_NAME",
    )
    alert_workflow_chat_job_timeout_seconds: int = Field(
        default=600,
        validation_alias="ALERT_WORKFLOW_CHAT_JOB_TIMEOUT_SECONDS",
    )
    alert_workflow_chat_result_ttl_seconds: int = Field(
        default=24 * 60 * 60,
        validation_alias="ALERT_WORKFLOW_CHAT_RESULT_TTL_SECONDS",
    )
    alert_workflow_chat_stream_maxlen: int = Field(
        default=5000,
        validation_alias="ALERT_WORKFLOW_CHAT_STREAM_MAXLEN",
    )
    alert_workflow_chat_history_turn_limit: int = Field(
        default=20,
        validation_alias="ALERT_WORKFLOW_CHAT_HISTORY_TURN_LIMIT",
    )
    alert_workflow_chat_worker_poll_seconds: float = Field(
        default=1.0,
        validation_alias="ALERT_WORKFLOW_CHAT_WORKER_POLL_SECONDS",
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
    deployment_update_checks_enabled: bool = Field(
        default=True,
        validation_alias="DEPLOYMENT_UPDATE_CHECKS_ENABLED",
    )
    deployment_update_check_interval_seconds: int = Field(
        default=12 * 60 * 60,
        validation_alias="DEPLOYMENT_UPDATE_CHECK_INTERVAL_SECONDS",
    )
    deployment_update_check_timeout_seconds: float = Field(
        default=20.0,
        validation_alias="DEPLOYMENT_UPDATE_CHECK_TIMEOUT_SECONDS",
    )
    deployment_image_repository: str = Field(
        default="ghcr.io/manasijatech/ananta-market-stack",
        validation_alias="DEPLOYMENT_IMAGE_REPOSITORY",
    )
    deployment_image_tag: str = Field(
        default="latest",
        validation_alias="DEPLOYMENT_IMAGE_TAG",
    )
    market_stack_build_sha: str | None = Field(
        default=None,
        validation_alias="MARKET_STACK_BUILD_SHA",
    )
    market_stack_build_version: str | None = Field(
        default=None,
        validation_alias="MARKET_STACK_BUILD_VERSION",
    )
    market_stack_image_digest: str | None = Field(
        default=None,
        validation_alias="MARKET_STACK_IMAGE_DIGEST",
    )

    mcp_google_drive_oauth_client_id: str | None = Field(
        default=None,
        validation_alias="MCP_GOOGLE_DRIVE_OAUTH_CLIENT_ID",
    )
    mcp_google_drive_oauth_client_secret: str | None = Field(
        default=None,
        validation_alias="MCP_GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
    )
    mcp_slack_oauth_client_id: str | None = Field(
        default=None,
        validation_alias="MCP_SLACK_OAUTH_CLIENT_ID",
    )
    mcp_slack_oauth_client_secret: str | None = Field(
        default=None,
        validation_alias="MCP_SLACK_OAUTH_CLIENT_SECRET",
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
    live_ui_demand_ttl_seconds: int = Field(
        default=5 * 60,
        validation_alias="LIVE_UI_DEMAND_TTL_SECONDS",
    )
    desktop_audio_storage_dir: str = Field(
        default="./data/alert-audio",
        validation_alias="DESKTOP_AUDIO_STORAGE_DIR",
    )
    desktop_audio_retention_days: int = Field(
        default=15,
        validation_alias="DESKTOP_AUDIO_RETENTION_DAYS",
    )
    desktop_audio_pairing_ttl_seconds: int = Field(
        default=5 * 60,
        validation_alias="DESKTOP_AUDIO_PAIRING_TTL_SECONDS",
    )
    watchlist_preset_worker_interval_seconds: int = Field(
        default=60 * 60,
        validation_alias="WATCHLIST_PRESET_WORKER_INTERVAL_SECONDS",
    )

    # Development-only fallback if no key set (not for production).
    allow_insecure_dev_credentials: bool = False

    @field_validator("log_to_file", mode="before")
    @classmethod
    def _empty_log_to_file_is_unset(cls, value: object) -> object:
        if value == "":
            return None
        return value

    @model_validator(mode="after")
    def _apply_redis_url(self) -> "Settings":
        if not self.redis_url:
            return self

        parsed = urlparse(self.redis_url)
        if parsed.scheme not in {"redis", "rediss"}:
            return self

        if parsed.hostname:
            self.redis_host = parsed.hostname
        if parsed.port:
            self.redis_port = parsed.port
        if parsed.username:
            self.redis_username = parsed.username
        if parsed.password:
            self.redis_password = parsed.password
        self.redis_ssl = parsed.scheme == "rediss"
        if parsed.path and parsed.path != "/":
            db_value = parsed.path.lstrip("/").split("/", 1)[0]
            if db_value.isdigit():
                self.redis_db = int(db_value)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
