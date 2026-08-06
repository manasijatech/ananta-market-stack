"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import { fetchFastApi } from "@/lib/fastapi";
import type { AlphaFeedParams } from "@/service/actions/alpha/shared";

export type AlphaFeedProduct = "news" | "announcements" | "earnings" | "concalls" | "alerts";

export type AlphaCachedFeedPage<T> = AlphaPaginatedResponse<T> & {
    total?: number;
    from_cache?: boolean;
};

function buildFeedQuery(params: AlphaFeedParams & { force_refresh?: boolean } = {}): string {
    const query = new URLSearchParams();
    const symbols = (params.symbols ?? [])
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    if (symbols.length) {
        // Backend accepts comma lists; large watchlists are OK — sync budget is applied server-side.
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
    return fetchFastApi<AlphaCachedFeedPage<T>>(`/alpha/feeds/${product}?${query}`);
}
