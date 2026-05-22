"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type {
    LlmUsageEventsPage,
    LlmUsageFilters,
    LlmUsageGranularity,
    LlmUsageOverview,
    LlmUsageTimeseries,
    WorkflowLlmUsageSummary
} from "@/service/types/llm-usage";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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

function extractMessage(payload: unknown, fallback: string): string {
    if (!isJsonObject(payload)) return fallback;
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.message === "string") return payload.message;
    return fallback;
}

async function request<T>(path: string): Promise<T> {
    const response = await fetchFastApi(path);
    const payload = await parseJson(response);
    if (!response.ok) {
        throw new Error(extractMessage(payload, "LLM usage request failed."));
    }
    return payload as T;
}

function appendFilters(query: URLSearchParams, filters: LlmUsageFilters = {}) {
    Object.entries(filters).forEach(([key, value]) => {
        const clean = typeof value === "string" ? value.trim() : "";
        if (clean) query.set(key, clean);
    });
}

export async function getLlmUsageOverview(filters: LlmUsageFilters = {}): Promise<LlmUsageOverview> {
    const query = new URLSearchParams();
    appendFilters(query, filters);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<LlmUsageOverview>(`/llm-usage/overview${suffix}`);
}

export async function getLlmUsageTimeseries(
    filters: LlmUsageFilters = {},
    granularity: LlmUsageGranularity = "daily"
): Promise<LlmUsageTimeseries> {
    const query = new URLSearchParams({ granularity });
    appendFilters(query, filters);
    return request<LlmUsageTimeseries>(`/llm-usage/timeseries?${query.toString()}`);
}

export async function getLlmUsageEvents(
    filters: LlmUsageFilters = {},
    limit = 100
): Promise<LlmUsageEventsPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    appendFilters(query, filters);
    return request<LlmUsageEventsPage>(`/llm-usage/events?${query.toString()}`);
}

export async function getWorkflowLlmUsageSummary(
    workflowId: string,
    filters: Pick<LlmUsageFilters, "date_from" | "date_to"> = {}
): Promise<WorkflowLlmUsageSummary> {
    const query = new URLSearchParams();
    appendFilters(query, filters);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<WorkflowLlmUsageSummary>(`/alert-workflows/${workflowId}/llm/usage${suffix}`);
}
