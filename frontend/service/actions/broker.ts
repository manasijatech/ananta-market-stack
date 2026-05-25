"use server";

import { revalidatePath } from "next/cache";
import { fetchFastApi } from "@/lib/fastapi";
import type {
    BrokerAccount,
    BrokerAccountDetail,
    AlphaApiConfig,
    AlphaWebSocketConfig,
    BrokerDataDefaultConfig,
    BrokerDataSearchConfig,
    BrokerCode,
    CreateBrokerAccountPayload,
    DataCapabilities,
    FieldErrors,
    GreeksRequest,
    HistoricalRequest,
    InstrumentSearchRow,
    InstrumentSyncResult,
    JsonObject,
    LlmProvider,
    LlmProviderConfig,
    Notification,
    OhlcRequest,
    OrderBody,
    OptionChainRequest,
    QuoteRequest,
    QuoteResponse,
    SessionLoginPayload,
    SessionMutationResponse,
    SessionStartResponse,
    SessionStatus,
    StreamStatus,
    SystemConfig,
    VerifyResponse
} from "@/service/types/broker";

type FastApiValidationItem = {
    loc?: (string | number)[];
    msg?: string;
    type?: string;
};

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationFieldErrors(detail: unknown): FieldErrors {
    if (!Array.isArray(detail)) {
        return {};
    }

    return detail.reduce<FieldErrors>((acc, item: unknown) => {
        if (!isJsonObject(item)) {
            return acc;
        }

        const loc = Array.isArray(item.loc) ? item.loc : [];
        const field = loc.length ? String(loc[loc.length - 1]) : "form";
        const message = typeof item.msg === "string" ? item.msg : "Invalid value";
        acc[field] = message;
        return acc;
    }, {});
}

async function parseJson(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { detail: text };
    }
}

function extractMessage(payload: unknown, fallback: string): string {
    if (!isJsonObject(payload)) {
        return fallback;
    }
    const detail = payload.detail;
    if (typeof detail === "string") {
        return detail;
    }
    if (Array.isArray(detail)) {
        const first = detail.find((item: unknown): item is FastApiValidationItem => {
            return isJsonObject(item) && typeof item.msg === "string";
        });
        if (first?.msg) {
            return first.msg;
        }
    }
    if (typeof payload.message === "string") {
        return payload.message;
    }
    return fallback;
}

async function readResponse<T>(response: Response): Promise<T> {
    const payload = await parseJson(response);

    if (!response.ok) {
        const fieldErrors =
            response.status === 422 && isJsonObject(payload) ? validationFieldErrors(payload.detail) : {};
        const message =
            response.status >= 500
                ? "The broker service is unavailable. Please try again."
                : extractMessage(payload, "Request failed.");
        throw new Error(JSON.stringify({ status: response.status, message, fieldErrors }));
    }

    return payload as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchFastApi(path, {
        ...init,
        headers: {
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...Object.fromEntries(new Headers(init.headers).entries())
        }
    });
    return readResponse<T>(response);
}

export async function getBrokerAccounts(): Promise<BrokerAccount[]> {
    return request<BrokerAccount[]>("/broker-accounts");
}

export async function getSupportedBrokers(): Promise<BrokerCode[]> {
    const data = await request<{ brokers: BrokerCode[] }>("/brokers/supported");
    return data.brokers;
}

export async function getBrokerAccount(id: string): Promise<BrokerAccountDetail> {
    return request<BrokerAccountDetail>(`/broker-accounts/${id}`);
}

export async function getSessionStatus(id: string, broker: BrokerCode): Promise<SessionStatus> {
    return request<SessionStatus>(`/broker-accounts/${id}/sessions/${broker}`);
}

export async function getNotifications(): Promise<Notification[]> {
    return request<Notification[]>("/notifications");
}

export async function getPortfolioFunds(id: string): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/portfolio/funds`);
}

export async function getProfile(id: string): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/profile`);
}

export async function getOrders(id: string): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/portfolio/orders`);
}

export async function getTrades(id: string): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/portfolio/trades`);
}

export async function getPositions(id: string): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/portfolio/positions`);
}

export async function getHoldings(id: string): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/portfolio/holdings`);
}

export async function getQuotes(id: string, payload: QuoteRequest): Promise<QuoteResponse[]> {
    return request<QuoteResponse[]>(`/broker-accounts/${id}/quotes`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}

export async function getDataCapabilities(id: string): Promise<DataCapabilities> {
    return request<DataCapabilities>(`/broker-accounts/${id}/data/capabilities`);
}

export async function syncInstrumentData(id: string): Promise<InstrumentSyncResult> {
    return request<InstrumentSyncResult>(`/broker-accounts/${id}/data/instruments/sync-db`, {
        method: "POST"
    });
}

export async function syncInstrumentCsv(id: string): Promise<InstrumentSyncResult> {
    return request<InstrumentSyncResult>(`/broker-accounts/${id}/data/instruments/sync-csv`, {
        method: "POST"
    });
}

export async function deleteInstrumentStorage(id: string): Promise<InstrumentSyncResult> {
    return request<InstrumentSyncResult>(`/broker-accounts/${id}/data/instruments`, {
        method: "DELETE"
    });
}

export async function searchBrokerInstruments(
    id: string,
    params: { q?: string; exchange?: string; segment?: string; limit?: number } = {}
): Promise<InstrumentSearchRow[]> {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.exchange) query.set("exchange", params.exchange);
    if (params.segment) query.set("segment", params.segment);
    if (params.limit) query.set("limit", String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<InstrumentSearchRow[]>(`/broker-accounts/${id}/data/instruments/search${suffix}`);
}

export async function searchDefaultBrokerInstruments(
    params: { q?: string; exchange?: string; segment?: string; limit?: number } = {}
): Promise<InstrumentSearchRow[]> {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.exchange) query.set("exchange", params.exchange);
    if (params.segment) query.set("segment", params.segment);
    if (params.limit) query.set("limit", String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<InstrumentSearchRow[]>(`/system-config/instruments/search${suffix}`);
}

export async function getBrokerDataSearchConfig(): Promise<BrokerDataSearchConfig> {
    return request<BrokerDataSearchConfig>("/system-config/broker-search");
}

export async function getBrokerDataDefaultConfig(): Promise<BrokerDataDefaultConfig> {
    return request<BrokerDataDefaultConfig>("/system-config/broker-default");
}

export async function updateBrokerDataDefaultConfig(
    preferredDefaultAccountId: string | null
): Promise<BrokerDataDefaultConfig> {
    const result = await request<BrokerDataDefaultConfig>("/system-config/broker-default", {
        method: "PUT",
        body: JSON.stringify({ preferred_default_account_id: preferredDefaultAccountId })
    });
    revalidatePath("/broker-connections");
    revalidatePath("/alerts-workspace");
    revalidatePath("/settings");
    return result;
}

export async function updateBrokerDataSearchConfig(
    preferredSearchAccountId: string | null
): Promise<BrokerDataSearchConfig> {
    const result = await request<BrokerDataSearchConfig>("/system-config/broker-search", {
        method: "PUT",
        body: JSON.stringify({ preferred_search_account_id: preferredSearchAccountId })
    });
    revalidatePath("/broker-connections");
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return result;
}

export async function getSystemConfig(): Promise<SystemConfig> {
    return request<SystemConfig>("/system-config");
}

export async function upsertAlphaApiCredential(payload: {
    api_key: string;
    is_enabled?: boolean;
}): Promise<AlphaApiConfig> {
    const result = await request<AlphaApiConfig>("/system-config/alpha", {
        method: "PUT",
        body: JSON.stringify({
            api_key: payload.api_key,
            is_enabled: payload.is_enabled ?? true
        })
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/market-intelligence");
    return result;
}

export async function deleteAlphaApiCredential(): Promise<AlphaApiConfig> {
    const result = await request<AlphaApiConfig>("/system-config/alpha", {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/market-intelligence");
    return result;
}

export async function updateAlphaWebSocketConfig(payload: {
    is_enabled: boolean;
    products: string[];
    scope_mode: "alert_subscriptions" | "alerts_and_watchlists" | "full_market";
    watchlist_ids?: string[];
    include_all_watchlists?: boolean;
    full_market?: boolean;
}): Promise<AlphaWebSocketConfig> {
    const result = await request<AlphaWebSocketConfig>("/system-config/alpha/websocket", {
        method: "PUT",
        body: JSON.stringify({
            is_enabled: payload.is_enabled,
            products: payload.products,
            scope_mode: payload.scope_mode,
            watchlist_ids: payload.watchlist_ids ?? [],
            include_all_watchlists: payload.include_all_watchlists ?? false,
            full_market: payload.full_market ?? false
        })
    });
    revalidatePath("/settings");
    revalidatePath("/market-intelligence");
    return result;
}

export async function updateMcpServerConfig(payload: {
    id?: string | null;
    is_enabled: boolean;
    use_by_default?: boolean;
    name?: string | null;
    url: string;
    transport: "streamable_http" | "sse";
    auth_mode?: "oauth" | "api_key";
    api_key?: string | null;
    api_key_header_name?: string;
    api_key_prefix?: string;
    extra_headers?: Record<string, string>;
    timeout_seconds?: number;
}): Promise<SystemConfig["mcp_server"]> {
    const path = payload.id ? `/system-config/mcp/servers/${payload.id}` : "/system-config/mcp";
    const result = await request<SystemConfig["mcp_server"]>(path, {
        method: "PUT",
        body: JSON.stringify({
            is_enabled: payload.is_enabled,
            use_by_default: payload.use_by_default ?? true,
            name: payload.name ?? null,
            url: payload.url,
            transport: payload.transport,
            auth_mode: payload.auth_mode ?? "oauth",
            api_key: payload.api_key || null,
            api_key_header_name: payload.api_key_header_name ?? "Authorization",
            api_key_prefix: payload.api_key_prefix ?? "Bearer",
            extra_headers: payload.extra_headers ?? {},
            timeout_seconds: payload.timeout_seconds ?? 15
        })
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function createMcpServerConfig(payload: Parameters<typeof updateMcpServerConfig>[0]): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>("/system-config/mcp/servers", {
        method: "POST",
        body: JSON.stringify({
            is_enabled: payload.is_enabled,
            use_by_default: payload.use_by_default ?? true,
            name: payload.name ?? null,
            url: payload.url,
            transport: payload.transport,
            auth_mode: payload.auth_mode ?? "oauth",
            api_key: payload.api_key || null,
            api_key_header_name: payload.api_key_header_name ?? "Authorization",
            api_key_prefix: payload.api_key_prefix ?? "Bearer",
            extra_headers: payload.extra_headers ?? {},
            timeout_seconds: payload.timeout_seconds ?? 15
        })
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function startMcpOAuth(
    redirectUri: string,
    serverId?: string | null
): Promise<{ authorization_url: string; redirect_uri: string; state: string }> {
    return request<{ authorization_url: string; redirect_uri: string; state: string }>("/system-config/mcp/oauth/start", {
        method: "POST",
        body: JSON.stringify({ redirect_uri: redirectUri, server_id: serverId ?? null })
    });
}

export async function completeMcpOAuth(payload: { code: string; state: string }): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>("/system-config/mcp/oauth/complete", {
        method: "POST",
        body: JSON.stringify(payload)
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function deleteMcpServerConfig(): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>("/system-config/mcp", {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function deleteMcpServerConfigById(serverId: string): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>(`/system-config/mcp/servers/${serverId}`, {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function clearMcpOAuth(): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>("/system-config/mcp/oauth", {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function clearMcpOAuthById(serverId: string): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>(`/system-config/mcp/servers/${serverId}/oauth`, {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function refreshMcpInventory(): Promise<SystemConfig["mcp_server"]> {
    const result = await request<{ config: SystemConfig["mcp_server"]; refreshed: boolean }>(
        "/system-config/mcp/inventory/refresh",
        {
            method: "POST"
        }
    );
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result.config;
}

export async function refreshMcpInventoryById(serverId: string): Promise<SystemConfig["mcp_server"]> {
    const result = await request<{ config: SystemConfig["mcp_server"]; refreshed: boolean }>(
        `/system-config/mcp/servers/${serverId}/inventory/refresh`,
        {
            method: "POST"
        }
    );
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result.config;
}

export async function clearMcpServerApiKey(): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>("/system-config/mcp/key", {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function clearMcpServerApiKeyById(serverId: string): Promise<SystemConfig["mcp_server"]> {
    const result = await request<SystemConfig["mcp_server"]>(`/system-config/mcp/servers/${serverId}/key`, {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    revalidatePath("/broker-chat");
    return result;
}

export async function refreshAlphaWebSocketAccount(): Promise<AlphaWebSocketConfig> {
    const result = await request<AlphaWebSocketConfig>("/system-config/alpha/websocket/refresh", {
        method: "POST"
    });
    revalidatePath("/settings");
    revalidatePath("/market-intelligence");
    return result;
}

export async function upsertLlmProviderCredential(
    provider: LlmProvider,
    payload: { api_key: string; is_enabled?: boolean }
): Promise<LlmProviderConfig> {
    const result = await request<LlmProviderConfig>(`/system-config/llm/providers/${provider}`, {
        method: "PUT",
        body: JSON.stringify({
            api_key: payload.api_key,
            is_enabled: payload.is_enabled ?? true
        })
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return result;
}

export async function deleteLlmProviderCredential(provider: LlmProvider): Promise<LlmProviderConfig[]> {
    const result = await request<LlmProviderConfig[]>(`/system-config/llm/providers/${provider}`, {
        method: "DELETE"
    });
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return result;
}

export async function addLlmProviderModel(payload: {
    provider: LlmProvider;
    model_id: string;
    label?: string | null;
    is_enabled?: boolean;
}): Promise<LlmProviderConfig[]> {
    const result = await request<LlmProviderConfig[]>("/system-config/llm/models", {
        method: "POST",
        body: JSON.stringify({
            provider: payload.provider,
            model_id: payload.model_id,
            label: payload.label ?? null,
            is_enabled: payload.is_enabled ?? true
        })
    });
    revalidatePath("/settings");
    return result;
}

export async function deleteLlmProviderModel(modelRowId: string): Promise<LlmProviderConfig[]> {
    const result = await request<LlmProviderConfig[]>(`/system-config/llm/models/${modelRowId}`, {
        method: "DELETE"
    });
    revalidatePath("/settings");
    return result;
}

export async function getDataQuotes(id: string, payload: QuoteRequest): Promise<QuoteResponse[]> {
    return request<QuoteResponse[]>(`/broker-accounts/${id}/data/quotes`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}

export async function getDataOhlc(id: string, payload: OhlcRequest): Promise<JsonObject[]> {
    return request<JsonObject[]>(`/broker-accounts/${id}/data/ohlc`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}

export async function getHistoricalData(id: string, payload: HistoricalRequest): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/data/historical`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}

export async function getOptionChainData(id: string, payload: OptionChainRequest): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/data/option-chain`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}

export async function getGreeksData(id: string, payload: GreeksRequest): Promise<JsonObject> {
    return request<JsonObject>(`/broker-accounts/${id}/data/greeks`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}

export async function getStreamStatus(id: string): Promise<StreamStatus> {
    return request<StreamStatus>(`/broker-accounts/${id}/data/stream/status`);
}

export async function createBrokerAccount(payload: CreateBrokerAccountPayload): Promise<BrokerAccount> {
    const result = await request<BrokerAccount>("/broker-accounts", {
        method: "POST",
        body: JSON.stringify(payload)
    });
    revalidatePath("/broker-connections");
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return result;
}

export async function deleteBrokerAccount(id: string): Promise<void> {
    await request<null>(`/broker-accounts/${id}`, { method: "DELETE" });
    revalidatePath("/broker-connections");
    revalidatePath("/dashboard");
    revalidatePath("/settings");
}

export async function verifyBrokerAccount(id: string): Promise<VerifyResponse> {
    const result = await request<VerifyResponse>(`/broker-accounts/${id}/verify`, {
        method: "POST"
    });
    revalidatePath(`/broker-connections/${id}`);
    revalidatePath("/broker-connections");
    revalidatePath("/settings");
    return result;
}

export async function createSession(
    id: string,
    broker: BrokerCode,
    payload: SessionLoginPayload
): Promise<VerifyResponse> {
    const body =
        broker === "groww"
            ? JSON.stringify({
                  access_token: payload.broker === "groww" ? payload.access_token : undefined,
                  totp: payload.broker === "groww" ? payload.totp : undefined
              })
            : JSON.stringify(payload);
    const result = await request<VerifyResponse>(`/broker-accounts/${id}/sessions/${broker}`, {
        method: "POST",
        body
    });
    revalidatePath(`/broker-connections/${id}`);
    revalidatePath("/settings");
    return result;
}

export async function refreshSession(id: string, broker: BrokerCode): Promise<SessionMutationResponse> {
    const pathByBroker: Partial<Record<BrokerCode, string>> = {
        angel: `/broker-accounts/${id}/sessions/angel/refresh`,
        dhan: `/broker-accounts/${id}/sessions/dhan/refresh`,
        kotak: `/broker-accounts/${id}/sessions/kotak/refresh`,
        zerodha: `/broker-accounts/${id}/sessions/zerodha/refresh`
    };
    const path = pathByBroker[broker];
    if (!path) {
        throw new Error(
            JSON.stringify({
                status: 400,
                message: `${broker} does not expose a refresh endpoint.`,
                fieldErrors: {}
            })
        );
    }
    const result = await request<SessionMutationResponse>(path, { method: "POST" });
    revalidatePath(`/broker-connections/${id}`);
    revalidatePath("/settings");
    return result;
}

export async function startDhanSession(id: string): Promise<SessionStartResponse> {
    return request<SessionStartResponse>(`/broker-accounts/${id}/sessions/dhan/start`, {
        method: "POST"
    });
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
    return request<Notification>(`/notifications/${notificationId}/read`, { method: "POST" });
}

export async function placeOrder(_accountId: string, _payload: OrderBody): Promise<never> {
    throw new Error("NotImplementedError: placeOrder is intentionally scaffolded.");
}

export async function cancelOrder(_accountId: string, _orderId: string): Promise<never> {
    throw new Error("NotImplementedError: cancelOrder is intentionally scaffolded.");
}

export async function cancelAllOrders(_accountId: string): Promise<never> {
    throw new Error("NotImplementedError: cancelAllOrders is intentionally scaffolded.");
}

export async function closeAllPositions(_accountId: string): Promise<never> {
    throw new Error("NotImplementedError: closeAllPositions is intentionally scaffolded.");
}
