import type { LlmUsageFilters, LlmUsageGranularity } from "@/service/types/llm-usage";

export const LLM_USAGE_ALL_FILTER_VALUE = "__all__";

export type LlmUsageFilterOption = {
    label: string;
    value: string;
    detail?: string;
};

export type LlmUsageActiveFilterChip = {
    key: keyof LlmUsageFilters | "granularity";
    label: string;
    value: string;
};

const DEFAULT_GRANULARITY: LlmUsageGranularity = "daily";

function clean(value?: string | null): string {
    return value?.trim() ?? "";
}

export function hasActiveLlmUsageFilters(
    filters: LlmUsageFilters,
    granularity: LlmUsageGranularity = DEFAULT_GRANULARITY
): boolean {
    return (
        Boolean(clean(filters.date_from)) ||
        Boolean(clean(filters.date_to)) ||
        Boolean(clean(filters.provider)) ||
        Boolean(clean(filters.model_id)) ||
        Boolean(clean(filters.workflow_id)) ||
        Boolean(clean(filters.request_kind)) ||
        Boolean(clean(filters.api_surface)) ||
        granularity !== DEFAULT_GRANULARITY
    );
}

export function buildLlmUsageSearchParams(
    filters: LlmUsageFilters,
    granularity: LlmUsageGranularity = DEFAULT_GRANULARITY
): URLSearchParams {
    const params = new URLSearchParams();
    if (clean(filters.date_from)) params.set("date_from", clean(filters.date_from));
    if (clean(filters.date_to)) params.set("date_to", clean(filters.date_to));
    if (clean(filters.provider)) params.set("provider", clean(filters.provider));
    if (clean(filters.model_id)) params.set("model_id", clean(filters.model_id));
    if (clean(filters.workflow_id)) params.set("workflow_id", clean(filters.workflow_id));
    if (clean(filters.request_kind)) params.set("request_kind", clean(filters.request_kind));
    if (clean(filters.api_surface)) params.set("api_surface", clean(filters.api_surface));
    if (granularity !== DEFAULT_GRANULARITY) params.set("granularity", granularity);
    return params;
}

export function buildLlmUsageHref(
    filters: LlmUsageFilters,
    granularity: LlmUsageGranularity = DEFAULT_GRANULARITY
): string {
    const query = buildLlmUsageSearchParams(filters, granularity).toString();
    return query ? `/llm-usage?${query}` : "/llm-usage";
}

export function buildLlmUsageFilterChips(
    filters: LlmUsageFilters,
    granularity: LlmUsageGranularity,
    labels: {
        provider?: string;
        model_id?: string;
        workflow_id?: string;
        request_kind?: string;
        api_surface?: string;
    }
): LlmUsageActiveFilterChip[] {
    const chips: LlmUsageActiveFilterChip[] = [];
    if (clean(filters.date_from)) {
        chips.push({ key: "date_from", label: "From", value: clean(filters.date_from) });
    }
    if (clean(filters.date_to)) {
        chips.push({ key: "date_to", label: "To", value: clean(filters.date_to) });
    }
    if (clean(filters.provider)) {
        chips.push({
            key: "provider",
            label: "Provider",
            value: labels.provider || clean(filters.provider)
        });
    }
    if (clean(filters.model_id)) {
        chips.push({
            key: "model_id",
            label: "Model",
            value: labels.model_id || clean(filters.model_id)
        });
    }
    if (clean(filters.workflow_id)) {
        chips.push({
            key: "workflow_id",
            label: "Workflow",
            value: labels.workflow_id || clean(filters.workflow_id)
        });
    }
    if (clean(filters.request_kind)) {
        chips.push({
            key: "request_kind",
            label: "Request kind",
            value: labels.request_kind || clean(filters.request_kind)
        });
    }
    if (clean(filters.api_surface)) {
        chips.push({
            key: "api_surface",
            label: "API surface",
            value: labels.api_surface || clean(filters.api_surface)
        });
    }
    if (granularity !== DEFAULT_GRANULARITY) {
        chips.push({
            key: "granularity",
            label: "Bucket",
            value: granularity.charAt(0).toUpperCase() + granularity.slice(1)
        });
    }
    return chips;
}

export function removeLlmUsageFilterChip(
    filters: LlmUsageFilters,
    granularity: LlmUsageGranularity,
    key: LlmUsageActiveFilterChip["key"]
): { filters: LlmUsageFilters; granularity: LlmUsageGranularity } {
    const next = { ...filters };
    if (key === "granularity") {
        return { filters: next, granularity: DEFAULT_GRANULARITY };
    }
    next[key] = undefined;
    return { filters: next, granularity };
}

export function formatLlmUsageLastUpdated(iso: string): string {
    const timestamp = new Date(iso).getTime();
    if (Number.isNaN(timestamp)) return "Just now";
    const minutes = Math.floor((Date.now() - timestamp) / 60_000);
    if (minutes < 1) return "Just now";
    if (minutes === 1) return "Updated 1 min ago";
    return `Updated ${minutes} min ago`;
}

export function isLlmUsageEmpty(overview: { totals: { request_count: number } }): boolean {
    return overview.totals.request_count === 0;
}

export function allBreakdownTablesEmpty(overview: {
    by_provider: unknown[];
    by_model: unknown[];
    top_workflows: unknown[];
    request_kinds: unknown[];
}): boolean {
    return (
        overview.by_provider.length === 0 &&
        overview.by_model.length === 0 &&
        overview.top_workflows.length === 0 &&
        overview.request_kinds.length === 0
    );
}
