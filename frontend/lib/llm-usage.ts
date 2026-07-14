import type { LlmUsageEvent, LlmUsageGroup, LlmUsageTotals } from "@/service/types/llm-usage";

export function formatLlmCost(value: number, pricedRequestCount: number): string {
    if (!pricedRequestCount) return "Not reported";
    return `$${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6, minimumFractionDigits: 0 }).format(value || 0)}`;
}

export function costSourceLabel(source?: string | null): string {
    if (source === "provider_reported") return "Provider-reported cost";
    if (source === "pricing_config") return "Estimated cost";
    if (source === "openrouter_pricing") return "Estimated cost";
    return "Not priced";
}

export function formatDisplayLlmCost(value?: number | null, requestCount = 0): string {
    if (!requestCount || value === null || value === undefined) return "Not priced";
    return formatLlmCost(value, requestCount);
}

export function aggregateCostSource(totals: LlmUsageTotals): string {
    if (totals.display_cost_request_count <= 0) return "unpriced";
    if (totals.estimated_cost_request_count > 0) return "pricing_config";
    return "provider_reported";
}

export function metricReportingLabel(total: number, reportedCount: number, requestCount: number, label: string): string {
    if (!requestCount) return `No ${label.toLowerCase()} data`;
    if (!reportedCount) return `${label} not reported`;
    return `${new Intl.NumberFormat("en-IN").format(total || 0)} ${label.toLowerCase()}`;
}

export function requestKindDisplay(value?: string | null, label?: string | null): string {
    return label?.trim() || value?.trim() || "Unknown";
}

export function apiSurfaceDisplay(value?: string | null, label?: string | null): string {
    return label?.trim() || value?.trim() || "Unknown surface";
}

export function workflowDisplayName(workflowName?: string | null, workflowId?: string | null, metadata?: Record<string, unknown>): string {
    const direct = workflowName?.trim() || workflowId?.trim();
    if (direct) return direct;
    const workflowCount = Number(metadata?.workflow_count ?? 0);
    if (workflowCount > 1) return `${workflowCount} workflows batched`;
    const workflowIds = Array.isArray(metadata?.workflow_ids) ? metadata.workflow_ids.filter((item) => typeof item === "string") : [];
    if (workflowIds.length === 1) return workflowIds[0] as string;
    return "Unassigned";
}

export function groupWorkflowDisplayName(row: LlmUsageGroup): string {
    return workflowDisplayName(row.workflow_name, row.workflow_id);
}

export function eventWorkflowDisplayName(event: LlmUsageEvent): string {
    return workflowDisplayName(event.workflow_name, event.workflow_id, event.metadata);
}

export function hasReportedCachedMetrics(totals: LlmUsageTotals): boolean {
    return totals.cached_tokens_reported_count > 0;
}

export function hasReportedReasoningMetrics(totals: LlmUsageTotals): boolean {
    return totals.reasoning_tokens_reported_count > 0;
}
