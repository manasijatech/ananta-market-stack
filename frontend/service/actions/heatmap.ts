"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type { HeatmapResponse, HeatmapScope } from "@/service/types/heatmap";

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
    if (payload && typeof payload === "object") {
        const detail = (payload as { detail?: unknown }).detail;
        if (typeof detail === "string") return detail;
        const message = (payload as { message?: unknown }).message;
        if (typeof message === "string") return message;
    }
    return fallback;
}

export async function getLiveHeatmap(params?: {
    limit?: number;
    days?: number | null;
    scope?: HeatmapScope;
    watchlist_id?: string | null;
    account_id?: string | null;
}): Promise<HeatmapResponse> {
    const query = new URLSearchParams();
    query.set("limit", String(params?.limit ?? 100));
    query.set("days", String(params?.days ?? 30));
    if (params?.scope) query.set("scope", params.scope);
    if (params?.watchlist_id) query.set("watchlist_id", params.watchlist_id);
    if (params?.account_id) query.set("account_id", params.account_id);

    const response = await fetchFastApi(`/live-streams/heatmap?${query.toString()}`);
    const payload = await parseJson(response);
    if (!response.ok) {
        throw new Error(extractMessage(payload, "Could not load heatmap."));
    }
    return payload as HeatmapResponse;
}
