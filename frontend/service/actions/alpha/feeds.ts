"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import { fetchFastApi } from "@/lib/fastapi";
import type { AlphaFeedParams } from "@/service/actions/alpha/shared";

export type AlphaFeedProduct = "news" | "announcements" | "earnings" | "concalls" | "alerts";

export type AlphaCachedFeedPage<T> = AlphaPaginatedResponse<T> & {
    total?: number;
    from_cache?: boolean;
};

function buildFeedQuery(params: AlphaFeedParams = {}): string {
    const query = new URLSearchParams();
    const symbols = (params.symbols ?? [])
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    if (symbols.length) {
        // Backend accepts repeated symbols= or comma lists; prefer one comma list for large sets.
        query.set("symbols", Array.from(new Set(symbols)).join(","));
    }
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    return query.toString();
}

export async function getCachedAlphaFeed<T = Record<string, unknown>>(
    product: AlphaFeedProduct,
    params: AlphaFeedParams = {}
): Promise<AlphaCachedFeedPage<T>> {
    const query = buildFeedQuery(params);
    return fetchFastApi<AlphaCachedFeedPage<T>>(`/alpha/feeds/${product}?${query}`);
}
