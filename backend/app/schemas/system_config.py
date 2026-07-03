from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.broker import BrokerDataDefaultConfigOut, BrokerDataSearchConfigOut

LlmProvider = Literal["openai", "openrouter", "gemini", "anthropic"]
McpTransport = Literal["streamable_http", "sse"]
McpAuthMode = Literal["oauth", "api_key"]


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


class LlmModelPricingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    provider: str
    model_id: str
    input_cost_per_1m_tokens: float | None = None
    output_cost_per_1m_tokens: float | None = None
    cached_input_cost_per_1m_tokens: float | None = None
    cache_write_cost_per_1m_tokens: float | None = None
    reasoning_cost_per_1m_tokens: float | None = None
    input_audio_cost_per_1m_tokens: float | None = None
    output_audio_cost_per_1m_tokens: float | None = None
    source: str = "manual"
    source_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    effective_from: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LlmModelPricingUpsertIn(BaseModel):
    provider: LlmProvider
    model_id: str = Field(..., min_length=1, max_length=256)
    input_cost_per_1m_tokens: float | None = Field(default=None, ge=0)
    output_cost_per_1m_tokens: float | None = Field(default=None, ge=0)
    cached_input_cost_per_1m_tokens: float | None = Field(default=None, ge=0)
    cache_write_cost_per_1m_tokens: float | None = Field(default=None, ge=0)
    reasoning_cost_per_1m_tokens: float | None = Field(default=None, ge=0)
    input_audio_cost_per_1m_tokens: float | None = Field(default=None, ge=0)
    output_audio_cost_per_1m_tokens: float | None = Field(default=None, ge=0)
    source_url: str | None = Field(default=None, max_length=512)
    metadata: dict[str, Any] = Field(default_factory=dict)
    effective_from: datetime | None = None


class AlphaApiConfigOut(BaseModel):
    label: str = "Drishti API"
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
    plan_id: str | None = None
    plan_name: str | None = None
    live_symbol_limit: int | None = None
    monthly_unique_symbol_limit: int | None = None
    effective_symbol_count: int = 0
    full_market_products: list[str] = Field(default_factory=list)
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


class McpServerConfigOut(BaseModel):
    id: str | None = None
    is_enabled: bool = False
    use_by_default: bool = True
    name: str | None = None
    url: str = ""
    transport: McpTransport = "streamable_http"
    auth_mode: McpAuthMode = "oauth"
    has_api_key: bool = False
    api_key_hint: str | None = None
    api_key_header_name: str = "Authorization"
    api_key_prefix: str = "Bearer"
    oauth_authenticated: bool = False
    oauth_authorized_at: datetime | None = None
    oauth_token_expires_at: datetime | None = None
    oauth_last_error: str | None = None
    inventory: dict[str, Any] = Field(default_factory=dict)
    inventory_checked_at: datetime | None = None
    inventory_error: str | None = None
    extra_headers: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: int = 15
    created_at: datetime | None = None
    updated_at: datetime | None = None


class McpServerConfigUpdateIn(BaseModel):
    is_enabled: bool = False
    use_by_default: bool = True
    name: str | None = Field(default=None, max_length=128)
    url: str = Field(default="", max_length=2048)
    transport: McpTransport = "streamable_http"
    auth_mode: McpAuthMode = "oauth"
    api_key: str | None = Field(default=None, max_length=4096)
    api_key_header_name: str = Field(default="Authorization", max_length=128)
    api_key_prefix: str = Field(default="Bearer", max_length=64)
    extra_headers: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: int = Field(default=15, ge=1, le=120)


class McpOAuthStartIn(BaseModel):
    server_id: str | None = Field(default=None, max_length=64)
    redirect_uri: str | None = Field(default=None, max_length=2048)


class McpOAuthStartOut(BaseModel):
    authorization_url: str
    redirect_uri: str
    state: str


class McpOAuthCompleteIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=4096)
    state: str = Field(..., min_length=1, max_length=512)


class McpInventoryRefreshOut(BaseModel):
    config: McpServerConfigOut
    refreshed: bool = True


class SystemConfigOut(BaseModel):
    broker_data_default: BrokerDataDefaultConfigOut
    broker_data_search: BrokerDataSearchConfigOut
    llm_providers: list[LlmProviderConfigOut] = Field(default_factory=list)
    llm_model_pricing: list[LlmModelPricingOut] = Field(default_factory=list)
    alpha_api: AlphaApiConfigOut
    alpha_websocket: AlphaWebSocketConfigOut
    mcp_server: McpServerConfigOut
    mcp_servers: list[McpServerConfigOut] = Field(default_factory=list)
