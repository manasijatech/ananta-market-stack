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
    alpha_api_base_url: str = Field(
        default="https://developers.manasija.in",
        validation_alias="MANASIJA_API_BASE_URL",
    )

    redis_host: str = "127.0.0.1"
    redis_port: int = 6379
    redis_password: str | None = None
    redis_db: int = 0
    redis_quote_ttl_seconds: int = 30

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
