import Link from "next/link";
import { Suspense } from "react";
import {
    IconActivity,
    IconCalendarStats,
    IconDatabase
} from "@tabler/icons-react";
import { LlmUsageFilterBar, type LlmUsageFilterOptions } from "@/components/llm-usage/llm-usage-filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIstDateTime } from "@/lib/datetime";
import {
    apiSurfaceDisplay,
    eventWorkflowDisplayName,
    formatDisplayLlmCost,
    groupWorkflowDisplayName,
    requestKindDisplay
} from "@/lib/llm-usage";
import {
    hasActiveLlmUsageFilters,
    isLlmUsageEmpty,
    type LlmUsageFilterOption
} from "@/lib/llm-usage-filters";
import { cn } from "@/lib/utils";
import type {
    LlmUsageEventsPage,
    LlmUsageFilters,
    LlmUsageGranularity,
    LlmUsageGroup,
    LlmUsageOverview,
    LlmUsageTimeBucket,
    LlmUsageTimeseries
} from "@/service/types/llm-usage";

export type { LlmUsageFilterOptions };

type LlmUsageDashboardProps = {
    overview: LlmUsageOverview;
    timeseries: LlmUsageTimeseries;
    events: LlmUsageEventsPage;
    filterOptions: LlmUsageFilterOptions;
    filters: LlmUsageFilters;
    granularity: LlmUsageGranularity;
};

const tokenFormatter = new Intl.NumberFormat("en-IN");
const surfaceClassName = "app-card-surface bg-card";

const DEFAULT_REQUEST_KIND_OPTIONS: LlmUsageFilterOption[] = [
    { value: "generic", label: "Generic request", detail: "generic" },
    { value: "workflow_llm_analysis", label: "Workflow analysis", detail: "workflow_llm_analysis" },
    { value: "workflow_llm_test", label: "Workflow test", detail: "workflow_llm_test" },
    { value: "workflow_feed_trigger", label: "Feed trigger", detail: "workflow_feed_trigger" },
    { value: "workflow_feed_trigger_batch", label: "Feed trigger batch", detail: "workflow_feed_trigger_batch" },
    { value: "workflow_followup_analysis", label: "Follow-up analysis", detail: "workflow_followup_analysis" },
    { value: "workflow_followup_analysis_batch", label: "Follow-up analysis batch", detail: "workflow_followup_analysis_batch" },
    { value: "broker_chat", label: "Broker chat", detail: "broker_chat" },
    { value: "alert_workflow_chat", label: "Alert workflow chat", detail: "alert_workflow_chat" }
];

const DEFAULT_API_SURFACE_OPTIONS: LlmUsageFilterOption[] = [
    { value: "chat_completions", label: "Chat Completions", detail: "chat_completions" },
    { value: "responses_api", label: "Responses API", detail: "responses_api" },
    { value: "agents_sdk", label: "Agents SDK", detail: "agents_sdk" }
];

function formatTokens(value: number): string {
    return tokenFormatter.format(value || 0);
}

function labelOrEmpty(value?: string | null): string {
    return value?.trim() || "Unassigned";
}

function optionValue(value?: string | null): string {
    return value?.trim() || "";
}

function addOption(options: Map<string, LlmUsageFilterOption>, option: LlmUsageFilterOption) {
    const value = optionValue(option.value);
    if (!value || options.has(value)) return;
    options.set(value, { ...option, value });
}

export function buildLlmUsageFilterOptions(
    overview: LlmUsageOverview,
    events: LlmUsageEventsPage
): LlmUsageFilterOptions {
    const providers = new Map<string, LlmUsageFilterOption>();
    const models = new Map<string, LlmUsageFilterOption>();
    const workflows = new Map<string, LlmUsageFilterOption>();
    const requestKinds = new Map<string, LlmUsageFilterOption>();
    const apiSurfaces = new Map<string, LlmUsageFilterOption>();

    DEFAULT_REQUEST_KIND_OPTIONS.forEach((option) => addOption(requestKinds, option));
    DEFAULT_API_SURFACE_OPTIONS.forEach((option) => addOption(apiSurfaces, option));

    overview.by_provider.forEach((row) => {
        const value = optionValue(row.provider);
        addOption(providers, {
            value,
            label: labelOrEmpty(value),
            detail: `${formatTokens(row.request_count)} requests`
        });
    });

    overview.by_model.forEach((row) => {
        const value = optionValue(row.model_id);
        addOption(models, {
            value,
            label: value,
            detail: [row.provider, `${formatTokens(row.request_count)} requests`].filter(Boolean).join(" / ")
        });
    });

    overview.top_workflows.forEach((row) => {
        const value = optionValue(row.workflow_id);
        addOption(workflows, {
            value,
            label: groupWorkflowDisplayName(row),
            detail: [row.workflow_status, row.provider, row.model_id].filter(Boolean).join(" / ")
        });
    });

    overview.request_kinds.forEach((row) => {
        const value = optionValue(row.request_kind);
        addOption(requestKinds, {
            value,
            label: requestKindDisplay(value, row.request_kind_label),
            detail: value
        });
    });

    events.items.forEach((event) => {
        addOption(providers, { value: event.provider, label: event.provider });
        addOption(models, { value: event.model_id, label: event.model_id, detail: event.provider });
        addOption(workflows, {
            value: optionValue(event.workflow_id),
            label: eventWorkflowDisplayName(event),
            detail: [event.workflow_status, event.provider, event.model_id].filter(Boolean).join(" / ")
        });
        addOption(requestKinds, {
            value: event.request_kind,
            label: requestKindDisplay(event.request_kind, event.request_kind_label),
            detail: event.request_kind
        });
        addOption(apiSurfaces, {
            value: event.api_surface,
            label: apiSurfaceDisplay(event.api_surface, event.api_surface_label),
            detail: event.api_surface
        });
    });

    return {
        providers: Array.from(providers.values()),
        models: Array.from(models.values()),
        workflows: Array.from(workflows.values()),
        requestKinds: Array.from(requestKinds.values()),
        apiSurfaces: Array.from(apiSurfaces.values())
    };
}

function UsageMetricCard({
    label,
    value,
    detail
}: {
    label: string;
    value: string;
    detail: string;
}) {
    return (
        <div className={cn(surfaceClassName, "p-4")}>
            <div className="flex min-h-20 flex-col justify-between gap-4">
                <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold leading-none tracking-normal text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
        </div>
    );
}

function UsageSummary({ overview }: { overview: LlmUsageOverview }) {
    const totalTokens = overview.totals.total_tokens;
    const totalRequests = overview.totals.request_count;
    const successfulRequests = overview.totals.success_count;
    const failedRequests = overview.totals.error_count;

    return (
        <section className="grid gap-3 lg:grid-cols-2">
            <UsageMetricCard
                detail={`${formatTokens(overview.totals.prompt_tokens)} input / ${formatTokens(overview.totals.completion_tokens)} output`}
                label="Total tokens"
                value={formatTokens(totalTokens)}
            />
            <UsageMetricCard
                label="Requests"
                detail={`${formatTokens(successfulRequests)} successful / ${formatTokens(failedRequests)} failed`}
                value={formatTokens(totalRequests)}
            />
            <UsageMetricCard
                detail="Provider-reported or pricing-table estimate"
                label="Estimated cost"
                value={formatDisplayLlmCost(overview.totals.display_cost_total_usd, overview.totals.display_cost_request_count)}
            />
            <UsageMetricCard
                detail="Workflows with usage in this slice"
                label="Workflows"
                value={formatTokens(overview.top_workflows.length)}
            />
        </section>
    );
}

function MiniTrend({ buckets }: { buckets: LlmUsageTimeBucket[] }) {
    const maxTokens = Math.max(...buckets.map((bucket) => bucket.total_tokens), 0);
    const visibleBuckets = buckets.slice(-18);

    return (
        <section className={cn(surfaceClassName, "p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-[15px] font-semibold">Usage trend</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Token volume for the selected period.</p>
                </div>
                <IconCalendarStats aria-hidden className="size-5 text-muted-foreground" />
            </div>
            <div className="mt-5 flex h-36 items-end gap-2 overflow-x-auto border-t pt-4">
                {visibleBuckets.length ? (
                    visibleBuckets.map((bucket) => {
                        const height = maxTokens ? Math.max((bucket.total_tokens / maxTokens) * 100, 4) : 0;
                        return (
                            <div className="flex min-w-12 flex-1 flex-col items-center gap-2" key={bucket.bucket_key}>
                                <div className="flex h-24 w-full items-end">
                                    <div
                                        className="mx-auto w-7 rounded-t bg-foreground/80"
                                        style={{ height: `${height}%` }}
                                        title={`${bucket.bucket_label}: ${formatTokens(bucket.total_tokens)} tokens`}
                                    />
                                </div>
                                <span className="max-w-14 truncate text-[11px] text-muted-foreground">{bucket.bucket_label}</span>
                                <span className="text-[11px] font-medium">{compactNumber(bucket.total_tokens)}</span>
                            </div>
                        );
                    })
                ) : (
                    <div className="flex h-full flex-1 items-center justify-center text-[13px] text-muted-foreground">
                        No trend data for this filter.
                    </div>
                )}
            </div>
        </section>
    );
}

function providerAvatar(provider?: string | null) {
    const clean = labelOrEmpty(provider);
    return clean.slice(0, 2).toUpperCase();
}

function ModelCostTable({ rows }: { rows: LlmUsageGroup[] }) {
    return (
        <section className={surfaceClassName}>
            <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-[15px] font-semibold">External LLM usage</h2>
            </div>
            <Table variant="card">
                <TableHeader>
                    <TableRow>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost incurred</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.slice(0, 8).map((row, index) => (
                        <TableRow key={`${row.provider}-${row.model_id}-${index}`}>
                            <TableCell>
                                <div className="flex min-w-64 items-center gap-3">
                                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                                        {providerAvatar(row.provider)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{labelOrEmpty(row.model_id)}</div>
                                        <div className="mt-1 truncate text-xs text-muted-foreground">{labelOrEmpty(row.provider)}</div>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-right">{formatTokens(row.request_count)}</TableCell>
                            <TableCell className="text-right">{formatTokens(row.total_tokens)}</TableCell>
                            <TableCell className="text-right">
                                {formatDisplayLlmCost(row.display_cost_total_usd, row.display_cost_request_count)}
                            </TableCell>
                        </TableRow>
                    ))}
                    {!rows.length ? (
                        <TableRow>
                            <TableCell className="py-10 text-center text-[13px] text-muted-foreground" colSpan={4}>
                                No model usage in this range.
                            </TableCell>
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
        </section>
    );
}

function RecentRequests({ events, hasActiveFilters }: { events: LlmUsageEventsPage; hasActiveFilters: boolean }) {
    const emptyMessage = hasActiveFilters ? "No requests match these filters." : "Requests appear here after an LLM step runs.";

    return (
        <section className={surfaceClassName}>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <h2 className="text-[15px] font-semibold">Recent requests</h2>
                <Badge size="sm" variant="secondary">
                    {events.items.length} rows
                </Badge>
            </div>
            <Table variant="card">
                <TableHeader>
                    <TableRow>
                        <TableHead>Completed</TableHead>
                        <TableHead>Workflow</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {events.items.slice(0, 12).map((event) => (
                        <TableRow key={event.id}>
                            <TableCell className="text-muted-foreground">{formatIstDateTime(event.completed_at)}</TableCell>
                            <TableCell>
                                <div className="max-w-72 truncate font-medium">{eventWorkflowDisplayName(event)}</div>
                                <div className="mt-1 max-w-72 truncate text-xs text-muted-foreground">
                                    {requestKindDisplay(event.request_kind, event.request_kind_label)} /{" "}
                                    {apiSurfaceDisplay(event.api_surface, event.api_surface_label)}
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="font-medium">{event.provider}</div>
                                <div className="mt-1 max-w-56 truncate text-xs text-muted-foreground">{event.model_id}</div>
                            </TableCell>
                            <TableCell className="text-right">{formatTokens(event.total_tokens)}</TableCell>
                            <TableCell className="text-right">
                                {formatDisplayLlmCost(event.display_cost_usd, event.display_cost_usd == null ? 0 : 1)}
                            </TableCell>
                        </TableRow>
                    ))}
                    {!events.items.length ? (
                        <TableRow>
                            <TableCell className="py-10 text-center text-[13px] text-muted-foreground" colSpan={5}>
                                {emptyMessage}
                            </TableCell>
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
        </section>
    );
}

function UsageEmptyNotice() {
    return (
        <Empty className={cn(surfaceClassName, "py-12 md:py-16")}>
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <IconActivity />
                </EmptyMedia>
                <EmptyTitle>No usage yet</EmptyTitle>
                <EmptyDescription>Run a workflow with an LLM step and usage will show up here.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button render={<Link href="/alerts-workspace/workflows/new" />}>
                    <IconActivity className="size-4" />
                    Create workflow
                </Button>
            </EmptyContent>
        </Empty>
    );
}

function FilterBarFallback() {
    return <div className={cn(surfaceClassName, "h-28 animate-pulse")} />;
}

function UsagePageTop({ overview }: { overview: LlmUsageOverview }) {
    return (
        <div className={surfaceClassName}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                        <IconDatabase aria-hidden className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="truncate text-[15px] font-semibold">LLM usage</h1>
                        <p className="mt-1 text-xs text-muted-foreground">Updated {formatIstDateTime(overview.generated_at)}</p>
                    </div>
                </div>
                <Badge variant="secondary">{formatTokens(overview.current_month.request_count)} requests this month</Badge>
            </div>
        </div>
    );
}

export function LlmUsageDashboard({
    overview,
    timeseries,
    events,
    filterOptions,
    filters,
    granularity
}: LlmUsageDashboardProps) {
    const showEmptyNotice = isLlmUsageEmpty(overview) && !hasActiveLlmUsageFilters(filters, granularity);
    const activeFilters = hasActiveLlmUsageFilters(filters, granularity);

    return (
        <div className="mx-auto grid w-full max-w-6xl gap-5">
            <UsagePageTop overview={overview} />

            <Suspense fallback={<FilterBarFallback />}>
                <LlmUsageFilterBar
                    filterOptions={filterOptions}
                    filters={filters}
                    generatedAt={overview.generated_at}
                    granularity={granularity}
                />
            </Suspense>

            {showEmptyNotice ? <UsageEmptyNotice /> : null}

            <div className={cn("grid gap-5", showEmptyNotice ? "opacity-70" : undefined)}>
                <div className="grid gap-3">
                    <h2 className="text-lg font-semibold">LLM usage</h2>
                    <UsageSummary overview={overview} />
                </div>
                <MiniTrend buckets={timeseries.buckets} />
                <ModelCostTable rows={overview.by_model} />
                <RecentRequests events={events} hasActiveFilters={activeFilters} />
            </div>
        </div>
    );
}
