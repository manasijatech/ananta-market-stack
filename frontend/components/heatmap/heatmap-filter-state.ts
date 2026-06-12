import type { HeatmapScope } from "@/service/types/heatmap";

export const HEATMAP_FILTER_STORAGE_KEY = "market-stack:heatmap-filters";
export const HEATMAP_FILTER_COOKIE_KEY = "market-stack-heatmap-filters";
export const HEATMAP_FILTER_CHANGE_EVENT = "market-stack:heatmap-filters-change";

export type StoredHeatmapFilters = {
    accountId?: string;
    scope?: HeatmapScope;
    watchlistId?: string;
};

export function isHeatmapScope(value: string | undefined): value is HeatmapScope {
    return value === "tracked" || value === "watchlist" || value === "portfolio_holdings";
}

export function parseStoredHeatmapFilters(raw: string | undefined): StoredHeatmapFilters {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw.startsWith("%7B") ? decodeURIComponent(raw) : raw) as StoredHeatmapFilters;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}
