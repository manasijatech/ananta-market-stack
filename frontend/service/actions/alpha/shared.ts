import "server-only";

import { MarketStackApiError, MarketStackClient, type QueryParams } from "@manasija/market-stack-sdk";
import { fetchFastApi } from "@/lib/fastapi";

type AlphaQueryValue = string | number | boolean | null | undefined;

export interface AlphaFeedParams {
    symbols?: string[];
    categories?: string[];
    sentiment?: "positive" | "negative" | "neutral" | string;
    type?: string;
    from?: string;
    to?: string;
    detailed?: boolean;
    page?: number;
    limit?: number;
}

const ALPHA_BATCH_LIMIT = 20;
const ALPHA_DEFAULT_BASE_URL = "https://developers.manasija.in";

export function alphaBaseUrl() {
    return (process.env.MANASIJA_API_BASE_URL || ALPHA_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function normalizeList(values: string[] | undefined, limit = ALPHA_BATCH_LIMIT) {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values ?? []) {
        const item = value.trim();
        if (!item || seen.has(item.toUpperCase())) continue;
        seen.add(item.toUpperCase());
        normalized.push(item);
        if (normalized.length >= limit) break;
    }
    return normalized;
}

export function appendParam(query: URLSearchParams, key: string, value: AlphaQueryValue) {
    if (value === null || value === undefined || value === "") return;
    query.set(key, String(value));
}

export function appendList(query: URLSearchParams, key: string, values: string[] | undefined) {
    const normalized = normalizeList(values);
    if (normalized.length) {
        query.set(key, normalized.join(","));
    }
}

export function feedQuery(params: AlphaFeedParams = {}) {
    const query = new URLSearchParams();
    appendList(query, "symbols", params.symbols);
    appendList(query, "categories", params.categories);
    appendParam(query, "sentiment", params.sentiment);
    appendParam(query, "type", params.type);
    appendParam(query, "from", params.from);
    appendParam(query, "to", params.to);
    appendParam(query, "detailed", params.detailed);
    appendParam(query, "page", params.page);
    appendParam(query, "limit", params.limit);
    return query;
}

async function parseJson(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { detail: text };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractMessage(payload: unknown, fallback: string) {
    if (!isRecord(payload)) return fallback;
    const detail = payload.detail;
    if (typeof detail === "string") return detail;
    if (isRecord(detail) && typeof detail.message === "string") return detail.message;
    if (isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
    if (typeof payload.message === "string") return payload.message;
    return fallback;
}

async function readResponse<T>(response: Response): Promise<T> {
    const payload = await parseJson(response);
    if (!response.ok) {
        const fallback =
            response.status >= 500
                ? "The Manasija Alpha API is unavailable. Please try again."
                : "Alpha API request failed.";
        throw new Error(
            JSON.stringify({
                status: response.status,
                message: extractMessage(payload, fallback),
                fieldErrors: {}
            })
        );
    }
    return payload as T;
}

export async function getAlphaApiKey() {
    const response = await fetchFastApi("/system-config/alpha/key");
    const payload = await parseJson(response);

    if (!response.ok) {
        throw new Error(
            JSON.stringify({
                status: response.status,
                message: extractMessage(payload, "Manasija Alpha API key is not configured. Add it in System Config."),
                fieldErrors: {}
            })
        );
    }

    if (!isRecord(payload) || typeof payload.api_key !== "string" || !payload.api_key.trim()) {
        throw new Error(
            JSON.stringify({
                status: 400,
                message: "Manasija Alpha API key is not configured. Add it in System Config.",
                fieldErrors: {}
            })
        );
    }

    return payload.api_key;
}

export async function getAlphaSdkClient() {
    const apiKey = await getAlphaApiKey();
    return new MarketStackClient({
        apiKey,
        baseUrl: alphaBaseUrl()
    });
}

function parseSdkError(error: unknown): never {
    if (error instanceof MarketStackApiError) {
        const fallback =
            error.statusCode >= 500
                ? "The Manasija Alpha API is unavailable. Please try again."
                : "Alpha API request failed.";
        throw new Error(
            JSON.stringify({
                status: error.statusCode,
                message: extractMessage(error.body, fallback),
                fieldErrors: {}
            })
        );
    }
    throw error;
}

export function queryParamsToObject(query: URLSearchParams): QueryParams {
    const out: QueryParams = {};
    for (const [key, value] of query.entries()) {
        out[key] = value;
    }
    return out;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    const apiKey = await getAlphaApiKey();
    try {
        response = await fetch(`${alphaBaseUrl()}${path}`, {
            ...init,
            cache: "no-store",
            headers: {
                "X-API-Key": apiKey,
                ...(init.body ? { "content-type": "application/json" } : {}),
                ...Object.fromEntries(new Headers(init.headers).entries())
            }
        });
    } catch {
        throw new Error(
            JSON.stringify({
                status: 502,
                message: "Could not reach the Manasija Alpha API.",
                fieldErrors: {}
            })
        );
    }
    return readResponse<T>(response);
}

export async function withAlphaSdk<T>(fn: (client: MarketStackClient) => Promise<T>): Promise<T> {
    const client = await getAlphaSdkClient();
    try {
        return await fn(client);
    } catch (error) {
        return parseSdkError(error);
    }
}

export function withQuery(path: string, query: URLSearchParams) {
    const suffix = query.toString();
    return suffix ? `${path}?${suffix}` : path;
}
