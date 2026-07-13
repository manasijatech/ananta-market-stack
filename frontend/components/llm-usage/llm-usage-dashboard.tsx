import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
    IconActivity,
    IconArrowRight,
    IconBrain,
    IconChartBar,
    IconCoins,
    IconInfoCircle,
    IconSearch,
    IconShieldCheck
} from "@tabler/icons-react";
import { PageHeader } from "@/components/brokers/ui";
import { LlmUsageFilterBar, type LlmUsageFilterOptions } from "@/components/llm-usage/llm-usage-filter-bar";
import { MetricInfoTooltip } from "@/components/llm-usage/llm-usage-metric-info-tooltip";
import { StatCard, StatValueMuted, tableHeadClassName } from "@/components/llm-usage/llm-usage-stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIstDateTime } from "@/lib/datetime";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";
import {
    allBreakdownTablesEmpty,
    hasActiveLlmUsageFilters,
    isLlmUsageEmpty,
    type LlmUsageFilterOption
} from "@/lib/llm-usage-filters";
import {
    apiSurfaceDisplay,
    eventWorkflowDisplayName,
    formatLlmCost,
    groupWorkflowDisplayName,
    metricReportingLabel,
    requestKindDisplay
} from "@/lib/llm-usage";
import type {
    LlmUsageEventsPage,
    LlmUsageFilters,
    LlmUsageGranularity,
    LlmUsageGroup,
    LlmUsageOverview,
    LlmUsageTimeBucket,
    LlmUsageTimeseries,
    LlmUsageTotals
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
const DEFAULT_REQUEST_KIND_OPTIONS: LlmUsageFilterOption[] = [
    { value: "generic", label: "Generic request", detail: "generic" },
    { value: "workflow_llm_analysis", label: "Workflow LLM analysis", detail: "workflow_llm_analysis" },
    { value: "workflow_llm_test", label: "Workflow LLM test", detail: "workflow_llm_test" },
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

const SPARSE_BUCKET_THRESHOLD = 4;
const PROVIDER_COST_TOOLTIP =
    "Cost is only reported when the upstream provider includes it in the API response. provider_cost_total only includes cost returned by the provider.";
const TOKENS_TOOLTIP = "Some providers do not expose cache, reasoning, or cost fields in every response.";
const WORKFLOW_TABLE_TOOLTIP = "Historical workflow usage is retained in the ledger after a workflow is deleted.";
const PERIOD_TOOLTIP = "Daily snapshots are updated at write time when requests complete.";

function compactNumber(value: number): string {
    return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

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
            detail: [row.provider, `${formatTokens(row.request_count)} requests`].filter(Boolean).join(" · ")
        });
    });

    overview.top_workflows.forEach((row) => {
        const value = optionValue(row.workflow_id);
        addOption(workflows, {
            value,
            label: groupWorkflowDisplayName(row),
            detail: [row.workflow_status, row.provider, row.model_id].filter(Boolean).join(" · ")
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
        addOption(providers, {
            value: event.provider,
            label: event.provider
        });
        addOption(models, {
            value: event.model_id,
            label: event.model_id,
            detail: event.provider
        });
        addOption(workflows, {
            value: optionValue(event.workflow_id),
            label: eventWorkflowDisplayName(event),
            detail: [event.workflow_status, event.provider, event.model_id].filter(Boolean).join(" · ")
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

function UsageEmptyNotice() {
    return (
        <div className="flex items-center gap-2.5 rounded-md border-l-[3px] border-l-blue-400 bg-card px-3.5 py-2.5">
            <IconInfoCircle aria-hidden className="size-4 shrink-0 text-blue-400" />
            <p className="text-[13px] text-foreground">
                No usage data yet — LLM activity appears here once workflows start running.
            </p>
        </div>
    );
}

function TotalsGrid({ overview }: { overview: LlmUsageOverview }) {
    const zeroState = isLlmUsageEmpty(overview);
    const cachedDetail = metricReportingLabel(
        overview.totals.cached_tokens,
        overview.totals.cached_tokens_reported_count,
        overview.totals.request_count,
        "Cached"
    );
    const reasoningDetail = metricReportingLabel(
        overview.totals.reasoning_tokens,
        overview.totals.reasoning_tokens_reported_count,
        overview.totals.request_count,
        "Reasoning"
    );
    const hasRequests = overview.totals.request_count > 0;
    const costReported = overview.totals.priced_request_count > 0;

    return (
        <section className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
            <StatCard
                detail={`${formatTokens(overview.totals.prompt_tokens)} input / ${formatTokens(overview.totals.completion_tokens)} output`}
                icon={IconActivity}
                label="Requests"
                mutedIcon={zeroState}
                value={formatTokens(overview.totals.request_count)}
            />
            <StatCard
                detail={hasRequests ? `${Math.round((overview.totals.success_count / overview.totals.request_count) * 100)}% success, ${Math.round((overview.totals.error_count / overview.totals.request_count) * 100)}% error` : "No requests in range"}
                icon={IconShieldCheck}
                label="Reliability"
                mutedIcon={zeroState}
                value={hasRequests ? `${formatTokens(overview.totals.success_count)} / ${formatTokens(overview.totals.error_count)}` : "—"}
            />
            <StatCard
                detail={`${cachedDetail}, ${reasoningDetail}`}
                icon={IconBrain}
                infoTooltip={<MetricInfoTooltip content={TOKENS_TOOLTIP} />}
                label="Tokens"
                mutedIcon={zeroState}
                value={formatTokens(overview.totals.total_tokens)}
            />
            <StatCard
                detail={`${formatTokens(overview.totals.priced_request_count)} priced requests`}
                icon={IconCoins}
                infoTooltip={<MetricInfoTooltip content={PROVIDER_COST_TOOLTIP} />}
                label="Provider cost"
                mutedIcon={zeroState}
                value={costReported ? formatLlmCost(overview.totals.provider_cost_total, overview.totals.priced_request_count) : undefined}
                valueNode={costReported ? undefined : <StatValueMuted>Not reported</StatValueMuted>}
            />
        </section>
    );
}

function PeriodCard({ label, totals }: { label: string; totals: LlmUsageTotals }) {
    return (
        <div className="min-w-0 rounded-md border border-border bg-card p-4">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            <div className="mt-3 text-[22px] font-medium leading-none">{formatTokens(totals.total_tokens)}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">tokens</p>
            <p className="mt-2 text-xs text-muted-foreground">
                {formatTokens(totals.request_count)} request{totals.request_count === 1 ? "" : "s"}
            </p>
        </div>
    );
}

function PeriodGrid({ overview }: { overview: LlmUsageOverview }) {
    return (
        <section className="grid gap-3">
            <div className="flex items-center gap-2">
                <p className={typography.sectionEyebrow}>Time windows</p>
                <MetricInfoTooltip content={PERIOD_TOOLTIP} />
            </div>
            <div className="grid gap-3 min-[900px]:grid-cols-3">
                <PeriodCard label="Today" totals={overview.today} />
                <PeriodCard label="This week" totals={overview.current_week} />
                <PeriodCard label="This month" totals={overview.current_month} />
            </div>
        </section>
    );
}

function UsageChart({ buckets }: { buckets: LlmUsageTimeBucket[] }) {
    const maxTokens = Math.max(...buckets.map((bucket) => bucket.total_tokens), 0);
    const bucketCount = buckets.length;
    const isSparse = bucketCount > 0 && bucketCount < SPARSE_BUCKET_THRESHOLD;

    let emptyMessage: string | null = null;
    if (bucketCount === 0) {
        emptyMessage = "No data for this filter range.";
    } else if (isSparse) {
        emptyMessage = "Limited data — expand date range for a fuller trend.";
    }

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-4">
                <h2 className={typography.sectionTitle}>Usage trend</h2>
                {!emptyMessage ? (
                    <p className={cn(typography.sectionLead, "mt-1")}>Token volume by selected bucket.</p>
                ) : null}
            </div>

            {emptyMessage ? (
                <div className="flex min-h-40 items-center justify-center border-t border-border/50 pt-4">
                    <p className="text-[13px] text-muted-foreground">{emptyMessage}</p>
                </div>
            ) : (
                <div className="flex min-h-40 items-end gap-3 overflow-x-auto border-t border-border/50 pt-4">
                    {buckets.map((bucket) => {
                        const height = maxTokens ? Math.max((bucket.total_tokens / maxTokens) * 100, 3) : 0;
                        return (
                            <div className="flex min-w-16 flex-1 flex-col items-center gap-2" key={bucket.bucket_key}>
                                <div className="flex h-32 w-full items-end">
                                    <div
                                        className="mx-auto w-10 bg-primary/80 transition-colors hover:bg-primary"
                                        title={`${bucket.bucket_label}: ${formatTokens(bucket.total_tokens)} tokens`}
                                        style={{ height: `${height}%` }}
                                    />
                                </div>
                                <div className="w-full truncate text-center text-[11px] text-muted-foreground">
                                    {bucket.bucket_label}
                                </div>
                                <div className="text-center text-[13px] font-medium">{compactNumber(bucket.total_tokens)}</div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function GroupTable({
    title,
    description,
    rows,
    kind,
    headerTooltip
}: {
    title: string;
    description: string;
    rows: LlmUsageGroup[];
    kind: "provider" | "model" | "workflow" | "request";
    headerTooltip?: ReactNode;
}) {
    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-4">
                <div className="flex items-center gap-2">
                    <h2 className={typography.sectionTitle}>{title}</h2>
                    {headerTooltip}
                </div>
                <p className={cn(typography.sectionLead, "mt-1")}>{description}</p>
            </div>
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className={tableHeadClassName()}>Name</TableHead>
                        <TableHead className={tableHeadClassName("text-right")}>Requests</TableHead>
                        <TableHead className={tableHeadClassName("text-right")}>Tokens</TableHead>
                        <TableHead className={tableHeadClassName("text-right")}>Cost</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.slice(0, 8).map((row, index) => {
                        const name =
                            kind === "provider"
                                ? labelOrEmpty(row.provider)
                                : kind === "model"
                                  ? labelOrEmpty(row.model_id)
                                  : kind === "workflow"
                                    ? groupWorkflowDisplayName(row)
                                    : requestKindDisplay(row.request_kind, row.request_kind_label);
                        const sub =
                            kind === "workflow"
                                ? [row.provider, row.model_id, row.request_kind].filter(Boolean).join(" / ")
                                : kind === "model"
                                  ? labelOrEmpty(row.provider)
                                  : kind === "request"
                                    ? row.request_kind || ""
                                    : row.last_request_at
                                      ? formatIstDateTime(row.last_request_at)
                                      : "";
                        return (
                            <TableRow key={`${name}-${index}`}>
                                <TableCell className="text-[13px]">
                                    <div className="max-w-[260px] truncate font-medium">{name}</div>
                                    {sub ? (
                                        <div className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">{sub}</div>
                                    ) : null}
                                </TableCell>
                                <TableCell className="text-right text-[13px]">{formatTokens(row.request_count)}</TableCell>
                                <TableCell className="text-right text-[13px]">{formatTokens(row.total_tokens)}</TableCell>
                                <TableCell className="text-right text-[13px]">
                                    {formatLlmCost(row.provider_cost_total, row.priced_request_count)}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                    {!rows.length ? (
                        <TableRow>
                            <TableCell className="py-8 text-center text-[13px] italic text-muted-foreground" colSpan={4}>
                                No rows in this slice.
                            </TableCell>
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
        </section>
    );
}

function BreakdownEmptyState() {
    return (
        <section className="rounded-md border border-border bg-card px-6 py-10">
            <div className="mx-auto flex max-w-md flex-col items-center text-center">
                <IconChartBar aria-hidden className="mb-3 size-6 text-muted-foreground" />
                <h2 className="text-sm font-medium text-foreground">No breakdown data</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                    Run workflows with LLM steps to see usage by provider, model, and workflow.
                </p>
                <Button className="mt-4" render={<Link href="/alerts-workspace" />} variant="ghost">
                    Go to Alerts Workspace
                    <IconArrowRight aria-hidden className="size-4" />
                </Button>
            </div>
        </section>
    );
}

function BreakdownGrid({ overview }: { overview: LlmUsageOverview }) {
    if (allBreakdownTablesEmpty(overview)) {
        return <BreakdownEmptyState />;
    }

    return (
        <div className="grid gap-5 min-[900px]:grid-cols-2">
            <GroupTable
                description="Requests grouped by upstream provider."
                kind="provider"
                rows={overview.by_provider}
                title="Providers"
            />
            <GroupTable
                description="Top provider + model combinations."
                kind="model"
                rows={overview.by_model}
                title="Models"
            />
            <GroupTable
                description="LLM usage per workflow."
                headerTooltip={<MetricInfoTooltip content={WORKFLOW_TABLE_TOOLTIP} />}
                kind="workflow"
                rows={overview.top_workflows}
                title="Top workflows"
            />
            <GroupTable
                description="Usage by request type."
                kind="request"
                rows={overview.request_kinds}
                title="Request kinds"
            />
        </div>
    );
}

function RecentEvents({
    events,
    hasActiveFilters
}: {
    events: LlmUsageEventsPage;
    hasActiveFilters: boolean;
}) {
    const emptyMessage = hasActiveFilters
        ? "No results for current filters — try clearing some filters."
        : "No LLM calls recorded yet. Calls appear here once a workflow with an LLM step runs.";

    return (
        <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className={typography.sectionTitle}>Recent request ledger</h2>
                <Badge size="sm" variant="secondary">
                    {events.items.length} row{events.items.length === 1 ? "" : "s"}
                </Badge>
            </div>
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className={tableHeadClassName()}>Completed</TableHead>
                        <TableHead className={tableHeadClassName()}>Provider</TableHead>
                        <TableHead className={tableHeadClassName()}>Workflow</TableHead>
                        <TableHead className={tableHeadClassName("text-right")}>Tokens</TableHead>
                        <TableHead className={tableHeadClassName("text-right")}>Latency</TableHead>
                        <TableHead className={tableHeadClassName()}>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {events.items.map((event) => (
                        <TableRow key={event.id}>
                            <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground">
                                {formatIstDateTime(event.completed_at)}
                            </TableCell>
                            <TableCell className="text-[13px]">
                                <div className="font-medium">{event.provider}</div>
                                <div className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">{event.model_id}</div>
                            </TableCell>
                            <TableCell className="text-[13px]">
                                <div className="max-w-[240px] truncate font-medium">{eventWorkflowDisplayName(event)}</div>
                                <div className="mt-1 max-w-[240px] truncate text-xs text-muted-foreground">
                                    {requestKindDisplay(event.request_kind, event.request_kind_label)} /{" "}
                                    {apiSurfaceDisplay(event.api_surface, event.api_surface_label)}
                                </div>
                                {event.error ? (
                                    <div className="mt-1 max-w-[240px] truncate text-xs text-destructive">{event.error}</div>
                                ) : null}
                            </TableCell>
                            <TableCell className="text-right text-[13px]">{formatTokens(event.total_tokens)}</TableCell>
                            <TableCell className="text-right text-[13px]">
                                {event.latency_ms == null ? "n/a" : `${event.latency_ms} ms`}
                            </TableCell>
                            <TableCell>
                                <Badge variant={event.status === "success" ? "default" : "destructive"}>{event.status}</Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                    {!events.items.length ? (
                        <TableRow>
                            <TableCell className="py-10 text-center" colSpan={6}>
                                <div className="flex flex-col items-center gap-2">
                                    <IconSearch aria-hidden className="size-5 text-muted-foreground" />
                                    <p className="text-[13px] text-muted-foreground">{emptyMessage}</p>
                                </div>
                            </TableCell>
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
        </section>
    );
}

function FilterBarFallback() {
    return <div className="h-28 animate-pulse rounded-md border border-border bg-card" />;
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
        <>
            <PageHeader
                description="Monitor provider calls, token volume, provider-reported cost, and workflow-level LLM activity."
                eyebrow="Operations"
                title="LLM Usage"
            />

            <div className="grid gap-5">
                <Suspense fallback={<FilterBarFallback />}>
                    <LlmUsageFilterBar
                        filterOptions={filterOptions}
                        filters={filters}
                        generatedAt={overview.generated_at}
                        granularity={granularity}
                    />
                </Suspense>

                {showEmptyNotice ? <UsageEmptyNotice /> : null}

                <TotalsGrid overview={overview} />
                <PeriodGrid overview={overview} />
                <UsageChart buckets={timeseries.buckets} />
                <BreakdownGrid overview={overview} />
                <RecentEvents events={events} hasActiveFilters={activeFilters} />
            </div>
        </>
    );
}
