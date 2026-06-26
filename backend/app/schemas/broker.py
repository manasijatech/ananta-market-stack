from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, model_validator

from broker.core.types import BrokerCode


class BrokerAccountOut(BaseModel):
    """Public representation of a broker account without sensitive credentials."""

    id: str = Field(..., description="Unique ID for the broker account.")
    workspace_id: str | None = Field(None, description="Workspace that owns this broker account.")
    user_id: str = Field(..., description="The user owning this account.")
    broker_code: str = Field(..., description="The broker identifier (e.g., 'zerodha', 'upstox').")
    label: str = Field(..., description="A friendly name for the account.")
    is_active: bool = Field(True, description="Whether the account is currently enabled.")
    last_verified_at: datetime | None = Field(None, description="Last successful connectivity check timestamp.")
    last_error: str | None = Field(None, description="The last error message from the broker.")
    session_status: str | None = Field(None, description="Internal session state (e.g. 'VALID', 'EXPIRED').")
    session_expires_at: datetime | None = Field(None, description="When the current session/access token is expected to expire.")
    automation_enabled: bool = Field(False, description="Whether the account is configured for automated token refresh.")
    automation_mode: str | None = Field(None, description="The mode used for automation (e.g. 'TOTP', 'EXPERIMENTAL').")
    is_preferred_instrument_search: bool = Field(
        False,
        description="Whether this account is pinned as the user's preferred symbol-search broker.",
    )
    access_permissions: list[str] = Field(
        default_factory=list,
        description="RBAC permissions granted to the current user for this account.",
    )
    is_shared: bool = Field(False, description="Whether the account is accessible through workspace sharing.")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ZerodhaCreate(BaseModel):
    """Information required to add a Zerodha (Kite Connect) account."""

    broker: Literal["zerodha"] = "zerodha"
    label: str = Field(..., max_length=128, description="A unique label for this account.")
    api_key: str = Field(..., description="Kite Connect API key from the developer portal.")
    api_secret: str = Field(..., description="Kite Connect API secret.")
    access_token: str | None = Field(
        default=None,
        description=(
            "Optional current-day access token. Usually omitted during creation and "
            "set later via the Zerodha session API using a request_token."
        ),
    )
    login_user_id: str | None = Field(
        default=None,
        description="Optional Zerodha user id for experimental automated login.",
    )
    login_password: str | None = Field(
        default=None,
        description="Optional Zerodha password for experimental automated login (encrypted at rest).",
    )
    totp_secret: str | None = Field(
        default=None,
        description="Optional TOTP secret for experimental automated login.",
    )

    @model_validator(mode="after")
    def _validate_zerodha_login_bundle(self) -> "ZerodhaCreate":
        login_fields = [self.login_user_id, self.login_password, self.totp_secret]
        provided = [bool((value or "").strip()) for value in login_fields]
        if any(provided) and not all(provided):
            raise ValueError(
                "For Zerodha experimental automation, provide all of login_user_id, "
                "login_password, and totp_secret, or leave all of them empty."
            )
        return self


class UpstoxCreate(BaseModel):
    """Information required to add an Upstox account."""

    broker: Literal["upstox"] = "upstox"
    label: str = Field(..., max_length=128, description="A unique label for this account.")
    api_key: str = Field(..., description="Upstox API key (client id).")
    api_secret: str = Field(..., description="Upstox API secret.")
    redirect_uri: str = Field("http://127.0.0.1", description="Must match the redirect URI in Upstox dev portal.")
    access_token: str | None = Field(None, description="Last valid access token.")
    extended_token: str | None = Field(None, description="Reserved for future use.")


class AngelCreate(BaseModel):
    """Information required to add an Angel One (SmartAPI) account."""

    broker: Literal["angel"] = "angel"
    label: str = Field(..., max_length=128, description="A unique label for this account.")
    api_key: str = Field(..., description="SmartAPI application key.")
    client_code: str = Field(..., description="Angel user / client id.")
    pin: str = Field("", description="The 4-digit PIN for login (encrypted at rest).")
    jwt_token: str | None = Field(None, description="Last valid JWT session token.")
    feed_token: str | None = Field(None, description="Last valid feed token for streaming.")
    totp_secret: str | None = Field(
        default=None,
        description="Optional authenticator secret for automated SmartAPI TOTP generation.",
    )


class DhanCreate(BaseModel):
    """Information required to add a Dhan account."""

    broker: Literal["dhan"] = "dhan"
    label: str = Field(..., max_length=128, description="A unique label for this account.")
    app_id: str = Field(..., description="The Dhan system application ID.")
    app_secret: str = Field(..., description="The Dhan system app secret.")
    client_id: str = Field(..., description="Your Dhan client id.")
    access_token: str | None = Field(None, description="Last generated access token.")
    pin: str | None = Field(None, description="The 6-digit PIN for login (encrypted at rest).")
    totp_secret: str | None = Field(
        default=None,
        description="Optional Dhan TOTP/QR secret for official automated token generation.",
    )


class GrowwCreate(BaseModel):
    """Information required to add a Groww account."""

    broker: Literal["groww"] = "groww"
    label: str = Field(..., max_length=128, description="A unique label for this account.")
    api_key: str | None = Field(None, description="Groww API key for approval flow.")
    api_secret: str | None = Field(None, description="Groww API secret for approval flow.")
    access_token: str | None = Field(None, description="Previous valid access token.")
    totp_token: str | None = Field(
        default=None,
        description="Groww user API key used for the TOTP auth flow.",
    )
    totp_secret: str | None = Field(
        default=None,
        description="Groww TOTP secret or QR secret used to generate the OTP.",
    )

    @model_validator(mode="after")
    def _validate_groww_auth(self) -> "GrowwCreate":
        has_approval_flow = bool((self.api_key or "").strip() and (self.api_secret or "").strip())
        has_totp_flow = bool((self.totp_token or "").strip() and (self.totp_secret or "").strip())
        if not has_approval_flow and not has_totp_flow and not (self.access_token or "").strip():
            raise ValueError(
                "Provide Groww api_key+api_secret, or totp_token+totp_secret, or a current access_token."
            )
        return self


class IndmoneyCreate(BaseModel):
    """Information required for INDmoney account tracking."""

    broker: Literal["indmoney"] = "indmoney"
    label: str = Field(..., max_length=128, description="A unique label for this account.")
    access_token: str | None = Field(None, description="The session Bearer token from the INDmoney web portal.")


class KotakCreate(BaseModel):
    """Information required for Kotak Neo / Securities account."""

    broker: Literal["kotak"] = "kotak"
    label: str = Field(..., max_length=128, description="A unique label for this account.")
    ucc: str = Field(..., description="Unique Client Code (UCC) for Kotak.")
    portal_access_token: str = Field(..., description="The Bearer access token from the Kotak Neo developer portal.")
    mobile_number: str | None = Field(None, description="Registered mobile number (for automation).")
    session_bundle: str | None = Field(None, description="The derived session identifier for trade operations.")
    mpin: str | None = Field(None, description="4-digit Kotak Neo MPIN (encrypted at rest).")
    totp_secret: str | None = Field(None, description="Secret for automated TOTP generation.")


BrokerAccountCreate = Annotated[
    Union[
        ZerodhaCreate,
        UpstoxCreate,
        AngelCreate,
        DhanCreate,
        GrowwCreate,
        IndmoneyCreate,
        KotakCreate,
    ],
    Field(discriminator="broker"),
]


class InstrumentRef(BaseModel):
    """Broker-specific identifiers; supply those matching the account broker."""

    symbol: str | None = None
    exchange: str | None = None
    zerodha_instrument_token: int | None = None
    upstox_instrument_key: str | None = None
    angel_exchange: str | None = None
    angel_token: int | None = None
    dhan_exchange_segment: str | None = None
    dhan_security_id: str | None = None
    groww_exchange: str | None = None
    groww_segment: str | None = None
    groww_trading_symbol: str | None = None
    groww_exchange_token: str | None = None
    indmoney_scrip_code: str | None = None
    kotak_query: str | None = None
    kotak_segment: str | None = None
    kotak_psymbol: str | None = None


class QuoteRequest(BaseModel):
    instruments: list[InstrumentRef] = Field(default_factory=list)


class QuoteRow(BaseModel):
    symbol: str | None = None
    ltp: float = 0.0
    broker_code: str
    account_id: str
    detail: dict[str, Any] = Field(default_factory=dict)


class VerifyOut(BaseModel):
    ok: bool
    message: str = ""
    instrument_sync_scheduled: bool = False
    instrument_sync_status: str | None = Field(
        default=None,
        description="Background instrument sync state: scheduled, running, completed, failed, pending, or not_needed.",
    )
    instrument_sync_message: str | None = Field(
        default=None,
        description="User-facing note while instrument master data is downloading or if sync failed.",
    )


class SessionZerodhaIn(BaseModel):
    request_token: str = Field(
        ...,
        description=(
            "Short-lived token returned by Zerodha to your redirect URL after the user "
            "successfully logs in and authorizes the app."
        ),
    )


class ZerodhaSessionStatusOut(BaseModel):
    broker: Literal["zerodha"] = "zerodha"
    account_id: str
    login_url: str
    has_access_token: bool
    session_active: bool
    access_token_generated_at: datetime | None = None
    access_token_expires_at: datetime | None = None
    session_user_id: str | None = None
    guidance: str


class BrokerSessionStatusOut(BaseModel):
    broker: str
    account_id: str
    session_active: bool
    automation_supported: bool
    automation_enabled: bool
    automation_mode: str | None = None
    login_url: str | None = None
    has_access_token: bool = False
    token_generated_at: datetime | None = None
    token_expires_at: datetime | None = None
    fields_required: list[str] = Field(default_factory=list)
    guidance: str


class SessionGrowwIn(BaseModel):
    access_token: str | None = None
    totp: str | None = None


class SessionIndmoneyIn(BaseModel):
    access_token: str


class SessionStartOut(BaseModel):
    account_id: str
    broker: str
    login_url: str
    state: str
    guidance: str


class SessionUpstoxIn(BaseModel):
    authorization_code: str


class SessionUpstoxRequestOut(BaseModel):
    account_id: str
    broker: Literal["upstox"] = "upstox"
    token_request_expires_at: datetime | None = None
    notifier_url: str | None = None
    guidance: str


class SessionZerodhaRefreshOut(BaseModel):
    request_token: str
    access_token_generated_at: datetime
    access_token_expires_at: datetime
    guidance: str


class SessionAngelIn(BaseModel):
    client_code: str
    pin: str
    totp: str


class SessionDhanIn(BaseModel):
    token_id: str


class SessionKotakIn(BaseModel):
    mobile_number: str
    totp: str
    mpin: str


class DataCapabilityItem(BaseModel):
    supported: bool
    guidance: str = ""


class DataCapabilitiesOut(BaseModel):
    broker: str
    account_id: str
    capabilities: dict[str, DataCapabilityItem]


class InstrumentSyncOut(BaseModel):
    broker: str
    sync_status: str
    row_count: int
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    storage_target: str = "db"
    csv_path: str | None = None
    deleted_db_rows: int | None = None
    deleted_csv: bool | None = None


class InstrumentSearchRow(BaseModel):
    symbol: str
    source: str = "db"
    broker_code: str | None = None
    account_id: str | None = None
    account_label: str | None = None
    exchange: str | None = None
    segment: str | None = None
    trading_symbol: str | None = None
    name: str | None = None
    isin: str | None = None
    instrument_type: str | None = None
    expiry: datetime | None = None
    strike: str | None = None
    option_type: str | None = None
    lot_size: str | None = None
    tick_size: str | None = None
    identifiers: dict[str, str | None] = Field(default_factory=dict)


class OhlcRequest(BaseModel):
    instruments: list[InstrumentRef] = Field(default_factory=list)


class HistoricalRequest(BaseModel):
    instrument: InstrumentRef
    interval: str = Field(..., description="Broker-native interval such as minute, day, 5minute.")
    from_date: datetime
    to_date: datetime


class MarketChartRequest(BaseModel):
    instrument: InstrumentRef
    history_days: int = Field(default=90, ge=5, le=365)
    daily_interval: str = Field(default="day")
    intraday_interval: str = Field(default="1minute")
    include_live_quote: bool = Field(default=True)


class MarketChartCandleOut(BaseModel):
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None
    interval: str


class MarketChartCacheStatusOut(BaseModel):
    used_cached_daily: bool = False
    used_cached_intraday: bool = False
    fetched_daily: bool = False
    fetched_intraday: bool = False


class MarketChartSnapshotOut(BaseModel):
    broker_code: str
    symbol: str
    exchange: str | None = None
    candles: list[MarketChartCandleOut] = Field(default_factory=list)
    latest_quote: QuoteRow | None = None
    last_price_time: datetime | None = None
    cache_status: MarketChartCacheStatusOut = Field(default_factory=MarketChartCacheStatusOut)


class OptionChainRequest(BaseModel):
    symbol: str
    exchange: str = "NSE"
    expiry: str | None = None


class GreeksRequest(BaseModel):
    symbol: str
    exchange: str = "NSE"
    expiry: str | None = None
    strike: str | None = None
    option_type: str | None = None
    price: float | None = None
    underlying_price: float | None = None
    volatility: float | None = None
    interest_rate: float | None = None
    days_to_expiry: int | None = None


class StreamStatusOut(BaseModel):
    broker: str
    account_id: str
    websocket_enabled: bool
    subscription_count: int
    subscriptions: list[dict[str, Any]] = Field(default_factory=list)
    guidance: str = ""


class HoldingsSnapshotOut(BaseModel):
    account_id: str
    broker_code: str
    status: str
    holdings_count: int = 0
    fetched_at: datetime | None = None
    error: str | None = None


class BrokerDataSearchAccountOut(BaseModel):
    account_id: str
    broker_code: str
    label: str
    is_verified: bool
    session_status: str | None = None
    session_active: bool = False
    is_preferred: bool = False
    is_effective: bool = False
    search_available: bool = False
    holdings_status: str | None = None
    holdings_count: int = 0
    holdings_fetched_at: datetime | None = None
    latest_instrument_sync_status: str | None = None
    latest_instrument_sync_started_at: datetime | None = None
    latest_instrument_sync_finished_at: datetime | None = None
    latest_instrument_sync_error: str | None = None
    last_error: str | None = None


class BrokerDataSearchConfigOut(BaseModel):
    preferred_search_account_id: str | None = None
    effective_search_account_id: str | None = None
    fallback_used: bool = False
    accounts: list[BrokerDataSearchAccountOut] = Field(default_factory=list)


class BrokerDataSearchConfigUpdateIn(BaseModel):
    preferred_search_account_id: str | None = None


class BrokerDataDefaultAccountOut(BaseModel):
    account_id: str
    broker_code: str
    label: str
    is_verified: bool
    session_status: str | None = None
    session_active: bool = False
    is_preferred: bool = False
    is_effective: bool = False
    last_verified_at: datetime | None = None
    last_error: str | None = None


class BrokerDataDefaultConfigOut(BaseModel):
    preferred_default_account_id: str | None = None
    effective_default_account_id: str | None = None
    fallback_used: bool = False
    accounts: list[BrokerDataDefaultAccountOut] = Field(default_factory=list)


class BrokerDataDefaultConfigUpdateIn(BaseModel):
    preferred_default_account_id: str | None = None


def supported_brokers() -> list[str]:
    return [b.value for b in BrokerCode]
