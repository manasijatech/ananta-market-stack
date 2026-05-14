from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.broker import BrokerDataSearchConfigOut

LlmProvider = Literal["openai", "openrouter", "gemini"]


class LlmModelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    provider: LlmProvider
    model_id: str
    label: str | None = None
    is_enabled: bool = True
    created_at: datetime
    updated_at: datetime


class LlmProviderConfigOut(BaseModel):
    provider: LlmProvider
    label: str
    base_url: str
    has_api_key: bool = False
    api_key_hint: str | None = None
    is_enabled: bool = False
    api_key_updated_at: datetime | None = None
    models: list[LlmModelOut] = Field(default_factory=list)
    documentation_url: str | None = None


class LlmProviderCredentialUpsertIn(BaseModel):
    api_key: str = Field(..., min_length=1)
    is_enabled: bool = True


class LlmModelCreateIn(BaseModel):
    provider: LlmProvider
    model_id: str = Field(..., min_length=1, max_length=256)
    label: str | None = Field(default=None, max_length=128)
    is_enabled: bool = True


class AlphaApiConfigOut(BaseModel):
    label: str = "Manasija Alpha API"
    has_api_key: bool = False
    api_key_hint: str | None = None
    is_enabled: bool = False
    api_key_updated_at: datetime | None = None
    account: dict[str, Any] = Field(default_factory=dict)
    account_checked_at: datetime | None = None
    account_error: str | None = None


class AlphaApiCredentialUpsertIn(BaseModel):
    api_key: str = Field(..., min_length=1)
    is_enabled: bool = True


class AlphaApiKeyOut(BaseModel):
    api_key: str


AlphaWebSocketScopeMode = Literal[
    "alert_subscriptions",
    "alerts_and_watchlists",
    "full_market",
]


class AlphaWebSocketAddonOut(BaseModel):
    product: str
    enabled: bool = False
    tier: str | None = None


class AlphaWebSocketConfigOut(BaseModel):
    is_enabled: bool = True
    products: list[str] = Field(default_factory=list)
    scope_mode: AlphaWebSocketScopeMode = "alert_subscriptions"
    watchlist_ids: list[str] = Field(default_factory=list)
    include_all_watchlists: bool = False
    full_market: bool = False
    entitled_addons: list[AlphaWebSocketAddonOut] = Field(default_factory=list)
    effective_products: list[str] = Field(default_factory=list)
    effective_symbols: list[str] = Field(default_factory=list)
    full_market_allowed: bool = False
    status: str = "unknown"
    last_error: str | None = None
    last_connected_at: datetime | None = None
    last_event_at: datetime | None = None


class AlphaWebSocketConfigUpdateIn(BaseModel):
    is_enabled: bool = True
    products: list[str] = Field(default_factory=list)
    scope_mode: AlphaWebSocketScopeMode = "alert_subscriptions"
    watchlist_ids: list[str] = Field(default_factory=list)
    include_all_watchlists: bool = False
    full_market: bool = False


class SystemConfigOut(BaseModel):
    broker_data_search: BrokerDataSearchConfigOut
    llm_providers: list[LlmProviderConfigOut] = Field(default_factory=list)
    alpha_api: AlphaApiConfigOut
    alpha_websocket: AlphaWebSocketConfigOut
