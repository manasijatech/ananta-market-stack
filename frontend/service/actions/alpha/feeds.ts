"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import { fetchFastApi } from "@/lib/fastapi";
import type { AlphaFeedParams } from "@/service/actions/alpha/shared";

export type AlphaFeedProduct = "news" | "announcements" | "earnings" | "concalls" | "alerts";

export type AlphaCachedFeedPage<T> = AlphaPaginatedResponse<T> & {
    total?: number;
    from_cache?: boolean;
};

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

async function request<T>(path: string): Promise<T> {
    const response = await fetchFastApi(path);
    const payload = await parseJson(response);
    if (!response.ok) {
        throw new Error(extractMessage(payload, "Could not load alpha feed."));
    }
    return payload as T;
}

function buildFeedQuery(params: AlphaFeedParams & { force_refresh?: boolean } = {}): string {
    const query = new URLSearchParams();
    const symbols = (params.symbols ?? [])
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    if (symbols.length) {
        // Backend accepts full watchlist comma lists; stale/missing symbols refresh in batches.
        query.set("symbols", Array.from(new Set(symbols)).join(","));
    }
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.force_refresh) query.set("force_refresh", "true");
    return query.toString();
}

export async function getCachedAlphaFeed<T = Record<string, unknown>>(
    product: AlphaFeedProduct,
    params: AlphaFeedParams & { force_refresh?: boolean } = {}
): Promise<AlphaCachedFeedPage<T>> {
    const query = buildFeedQuery(params);
    return request<AlphaCachedFeedPage<T>>(`/alpha/feeds/${product}?${query}`);
}
