export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type BrokerCode = "angel" | "dhan" | "groww" | "indmoney" | "kotak" | "upstox" | "zerodha";

export type SessionStatusValue = "pending" | "active" | "automation_ready" | "action_required" | string;

export interface BrokerAccount {
    id: string;
    user_id: string;
    broker_code: BrokerCode;
    label: string;
    is_active: boolean;
    last_verified_at?: string | null;
    last_error?: string | null;
    session_status?: SessionStatusValue | null;
    session_expires_at?: string | null;
    automation_enabled: boolean;
    automation_mode?: string | null;
    is_preferred_instrument_search?: boolean;
    created_at: string;
    updated_at: string;
}

export type BrokerAccountDetail = BrokerAccount;

interface CreatePayloadBase {
    broker: BrokerCode;
    label: string;
}

export interface ZerodhaCreatePayload extends CreatePayloadBase {
    broker: "zerodha";
    api_key: string;
    api_secret: string;
    access_token?: string | null;
    login_user_id?: string | null;
    login_password?: string | null;
    totp_secret?: string | null;
}

export interface UpstoxCreatePayload extends CreatePayloadBase {
    broker: "upstox";
    api_key: string;
    api_secret: string;
    redirect_uri: string;
    access_token?: string | null;
    extended_token?: string | null;
}

export interface AngelCreatePayload extends CreatePayloadBase {
    broker: "angel";
    api_key: string;
    client_code: string;
    pin?: string;
    jwt_token?: string | null;
    feed_token?: string | null;
    totp_secret?: string | null;
}

export interface DhanCreatePayload extends CreatePayloadBase {
    broker: "dhan";
    app_id: string;
    app_secret: string;
    client_id: string;
    access_token?: string | null;
    pin?: string | null;
    totp_secret?: string | null;
}

export interface GrowwCreatePayload extends CreatePayloadBase {
    broker: "groww";
    api_key?: string | null;
    api_secret?: string | null;
    access_token?: string | null;
    totp_token?: string | null;
    totp_secret?: string | null;
}

export interface IndmoneyCreatePayload extends CreatePayloadBase {
    broker: "indmoney";
    access_token?: string | null;
}

export interface KotakCreatePayload extends CreatePayloadBase {
    broker: "kotak";
    ucc: string;
    portal_access_token: string;
    mobile_number?: string | null;
    session_bundle?: string | null;
    mpin?: string | null;
    totp_secret?: string | null;
}

export type CreateBrokerAccountPayload =
    | ZerodhaCreatePayload
    | UpstoxCreatePayload
    | AngelCreatePayload
    | DhanCreatePayload
    | GrowwCreatePayload
    | IndmoneyCreatePayload
    | KotakCreatePayload;

export interface ZerodhaSessionStatus {
    broker: "zerodha";
    account_id: string;
    login_url: string;
    has_access_token: boolean;
    session_active: boolean;
    access_token_generated_at?: string | null;
    access_token_expires_at?: string | null;
    session_user_id?: string | null;
    guidance: string;
}

export interface BrokerSessionStatus {
    broker: BrokerCode;
    account_id: string;
    session_active: boolean;
    automation_supported: boolean;
    automation_enabled: boolean;
    automation_mode?: string | null;
    login_url?: string | null;
    has_access_token: boolean;
    token_generated_at?: string | null;
    token_expires_at?: string | null;
    fields_required: string[];
    guidance: string;
}

export type SessionStatus = ZerodhaSessionStatus | BrokerSessionStatus;

export interface ZerodhaSessionPayload {
    broker: "zerodha";
    request_token: string;
}

export interface UpstoxSessionPayload {
    broker: "upstox";
    authorization_code: string;
}

export interface AngelSessionPayload {
    broker: "angel";
    client_code: string;
    pin: string;
    totp: string;
}

export interface DhanSessionPayload {
    broker: "dhan";
    token_id: string;
}

export interface GrowwSessionPayload {
    broker: "groww";
    access_token?: string | null;
    totp?: string | null;
}

export interface KotakSessionPayload {
    broker: "kotak";
    mobile_number: string;
    totp: string;
    mpin: string;
}

export interface IndmoneySessionPayload {
    broker: "indmoney";
    access_token: string;
}

export type SessionLoginPayload =
    | ZerodhaSessionPayload
    | UpstoxSessionPayload
    | AngelSessionPayload
    | DhanSessionPayload
    | GrowwSessionPayload
    | KotakSessionPayload
    | IndmoneySessionPayload;

export interface InstrumentRef {
    symbol?: string | null;
    exchange?: string | null;
    zerodha_instrument_token?: number | null;
    upstox_instrument_key?: string | null;
    angel_exchange?: string | null;
    angel_token?: number | null;
    dhan_exchange_segment?: string | null;
    dhan_security_id?: string | null;
    groww_exchange?: string | null;
    groww_segment?: string | null;
    groww_trading_symbol?: string | null;
    indmoney_scrip_code?: string | null;
    kotak_query?: string | null;
    kotak_segment?: string | null;
    kotak_psymbol?: string | null;
}

export interface QuoteRequest {
    instruments: InstrumentRef[];
}

export interface OhlcRequest {
    instruments: InstrumentRef[];
}

export interface QuoteResponse {
    symbol?: string | null;
    ltp: number;
    broker_code: BrokerCode;
    account_id: string;
    detail: JsonObject;
}

export interface DataCapabilityItem {
    supported: boolean;
    guidance: string;
}

export interface DataCapabilities {
    broker: BrokerCode | string;
    account_id: string;
    capabilities: Record<string, DataCapabilityItem>;
}

export interface InstrumentSearchRow {
    symbol: string;
    source?: string;
    broker_code?: string | null;
    account_id?: string | null;
    account_label?: string | null;
    exchange?: string | null;
    segment?: string | null;
    trading_symbol?: string | null;
    name?: string | null;
    isin?: string | null;
    instrument_type?: string | null;
    expiry?: string | null;
    strike?: string | null;
    option_type?: string | null;
    lot_size?: string | null;
    tick_size?: string | null;
    identifiers: Record<string, string | null | undefined>;
}

export interface InstrumentSyncResult {
    broker: BrokerCode | string;
    sync_status: string;
    row_count: number;
    started_at?: string | null;
    finished_at?: string | null;
    error?: string | null;
    storage_target?: string;
    csv_path?: string | null;
    deleted_db_rows?: number | null;
    deleted_csv?: boolean | null;
}

export interface HistoricalRequest {
    instrument: InstrumentRef;
    interval: string;
    from_date: string;
    to_date: string;
}

export interface OptionChainRequest {
    symbol: string;
    exchange?: string;
    expiry?: string | null;
}

export interface GreeksRequest {
    symbol: string;
    exchange?: string;
    expiry?: string | null;
    strike?: string | null;
    option_type?: string | null;
    price?: number;
    underlying_price?: number;
    volatility?: number;
    interest_rate?: number;
    days_to_expiry?: number;
}

export interface StreamStatus {
    broker: BrokerCode | string;
    account_id: string;
    websocket_enabled: boolean;
    subscription_count: number;
    subscriptions: JsonObject[];
    guidance: string;
}

export interface BrokerDataSearchAccount {
    account_id: string;
    broker_code: BrokerCode | string;
    label: string;
    is_verified: boolean;
    session_status?: string | null;
    session_active: boolean;
    is_preferred: boolean;
    is_effective: boolean;
    search_available: boolean;
    holdings_status?: string | null;
    holdings_count: number;
    holdings_fetched_at?: string | null;
    latest_instrument_sync_status?: string | null;
    latest_instrument_sync_started_at?: string | null;
    latest_instrument_sync_finished_at?: string | null;
    latest_instrument_sync_error?: string | null;
    last_error?: string | null;
}

export interface BrokerDataSearchConfig {
    preferred_search_account_id?: string | null;
    effective_search_account_id?: string | null;
    fallback_used: boolean;
    accounts: BrokerDataSearchAccount[];
}

export interface BrokerDataDefaultAccount {
    account_id: string;
    broker_code: BrokerCode | string;
    label: string;
    is_verified: boolean;
    session_status?: string | null;
    session_active: boolean;
    is_preferred: boolean;
    is_effective: boolean;
    last_verified_at?: string | null;
    last_error?: string | null;
}

export interface BrokerDataDefaultConfig {
    preferred_default_account_id?: string | null;
    effective_default_account_id?: string | null;
    fallback_used: boolean;
    accounts: BrokerDataDefaultAccount[];
}

export type LlmProvider = "openai" | "openrouter" | "gemini" | "anthropic";

export interface LlmModelConfig {
    id: string;
    provider: LlmProvider;
    model_id: string;
    label?: string | null;
    is_enabled: boolean;
    created_at: string;
    updated_at: string;
}

export interface LlmProviderConfig {
    provider: LlmProvider;
    label: string;
    base_url: string;
    has_api_key: boolean;
    api_key_hint?: string | null;
    is_enabled: boolean;
    api_key_updated_at?: string | null;
    models: LlmModelConfig[];
    documentation_url?: string | null;
}

export interface AlphaApiConfig {
    label: string;
    has_api_key: boolean;
    api_key_hint?: string | null;
    is_enabled: boolean;
    api_key_updated_at?: string | null;
    account?: JsonObject;
    account_checked_at?: string | null;
    account_error?: string | null;
}

export type AlphaWebSocketProduct = "news" | "announcements" | "earnings" | "concalls" | "alerts";
export type AlphaWebSocketScopeMode = "alert_subscriptions" | "alerts_and_watchlists" | "full_market";

export interface AlphaWebSocketAddon {
    product: AlphaWebSocketProduct | string;
    enabled: boolean;
    tier?: string | null;
}

export interface AlphaWebSocketConfig {
    is_enabled: boolean;
    products: string[];
    scope_mode: AlphaWebSocketScopeMode;
    watchlist_ids: string[];
    include_all_watchlists: boolean;
    full_market: boolean;
    entitled_addons: AlphaWebSocketAddon[];
    effective_products: string[];
    effective_symbols: string[];
    plan_id?: string | null;
    plan_name?: string | null;
    live_symbol_limit?: number | null;
    monthly_unique_symbol_limit?: number | null;
    effective_symbol_count: number;
    full_market_products: string[];
    full_market_allowed: boolean;
    status: string;
    last_error?: string | null;
    last_connected_at?: string | null;
    last_event_at?: string | null;
}

export type McpTransport = "streamable_http" | "sse";
export type McpAuthMode = "oauth" | "api_key";

export interface McpServerConfig {
    id?: string | null;
    is_enabled: boolean;
    use_by_default: boolean;
    name?: string | null;
    url: string;
    transport: McpTransport;
    auth_mode: McpAuthMode;
    has_api_key: boolean;
    api_key_hint?: string | null;
    api_key_header_name: string;
    api_key_prefix: string;
    oauth_authenticated: boolean;
    oauth_authorized_at?: string | null;
    oauth_token_expires_at?: string | null;
    oauth_last_error?: string | null;
    inventory: {
        tools?: Array<{ name?: string; description?: string } & Record<string, unknown>>;
        prompts?: Array<{ name?: string; description?: string } & Record<string, unknown>>;
        resources?: Array<{ name?: string; uri?: string; description?: string } & Record<string, unknown>>;
        errors?: Record<string, string>;
    };
    inventory_checked_at?: string | null;
    inventory_error?: string | null;
    extra_headers: Record<string, string>;
    timeout_seconds: number;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface SystemConfig {
    broker_data_default: BrokerDataDefaultConfig;
    broker_data_search: BrokerDataSearchConfig;
    llm_providers: LlmProviderConfig[];
    alpha_api: AlphaApiConfig;
    alpha_websocket: AlphaWebSocketConfig;
    mcp_server: McpServerConfig;
    mcp_servers: McpServerConfig[];
}

export interface Notification {
    id: string;
    account_id?: string | null;
    broker_code?: BrokerCode | string | null;
    level: string;
    kind: string;
    title: string;
    message: string;
    is_read: boolean;
    created_at: string;
}

export interface VerifyResponse {
    ok: boolean;
    message: string;
    instrument_sync_scheduled?: boolean;
    instrument_sync_status?: string | null;
    instrument_sync_message?: string | null;
}

export interface SessionStartResponse {
    account_id: string;
    broker: BrokerCode | string;
    login_url: string;
    state: string;
    guidance: string;
}

export interface ZerodhaRefreshResponse {
    request_token: string;
    access_token_generated_at: string;
    access_token_expires_at: string;
    guidance: string;
}

export interface UpstoxTokenRequestResponse {
    account_id: string;
    broker: "upstox";
    token_request_expires_at?: string | null;
    notifier_url?: string | null;
    guidance: string;
}

export type SessionMutationResponse =
    | VerifyResponse
    | ZerodhaRefreshResponse
    | UpstoxTokenRequestResponse
    | SessionStartResponse;

export interface OrderBody {
    symbol?: string | null;
    exchange?: string | null;
    action?: string | null;
    pricetype?: string;
    quantity?: string;
    product?: string;
    price?: string;
    trigger_price?: string;
    disclosed_quantity?: string;
    orderid?: string | null;
    position_size?: number | null;
    extra?: JsonObject;
}

export interface Order {
    id: string;
    symbol: string;
    action: string;
    quantity: number;
    price?: number | null;
    status: string;
    time?: string | null;
    raw: JsonObject;
}

export interface Trade {
    id: string;
    symbol: string;
    action: string;
    quantity: number;
    avg_price?: number | null;
    time?: string | null;
    raw: JsonObject;
}

export interface Position {
    id: string;
    symbol: string;
    product?: string | null;
    quantity: number;
    pnl?: number | null;
    raw: JsonObject;
}

export interface Holding {
    id: string;
    symbol: string;
    quantity: number;
    average_price?: number | null;
    last_price?: number | null;
    pnl?: number | null;
    pnl_percent?: number | null;
    raw: JsonObject;
}

export interface FundsResponse {
    available?: number | null;
    used?: number | null;
    opening_balance?: number | null;
    total?: number | null;
    raw: JsonObject;
}

export interface Profile {
    name?: string | null;
    email?: string | null;
    broker_user_id?: string | null;
    raw: JsonObject;
}

export interface FieldErrors {
    [field: string]: string;
}
