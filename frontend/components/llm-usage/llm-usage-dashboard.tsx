import Link from "next/link";
import { IconActivity, IconAlertTriangle, IconBrain, IconClock, IconCoins, IconRefresh } from "@tabler/icons-react";
import { PageHeader, Shell, StatusBadge } from "@/components/brokers/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LlmUsageFilterSelect } from "@/components/llm-usage/llm-usage-filter-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIstDateTime } from "@/lib/datetime";
import type { LlmUsageFilterOption } from "@/lib/llm-usage-filters";
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

type LlmUsageDashboardProps = {
    overview: LlmUsageOverview;
    timeseries: LlmUsageTimeseries;
    events: LlmUsageEventsPage;
    filterOptions: LlmUsageFilterOptions;
    filters: LlmUsageFilters;
    granularity: LlmUsageGranularity;
};

type LlmUsageFilterOptions = {
    providers: LlmUsageFilterOption[];
    models: LlmUsageFilterOption[];
    workflows: LlmUsageFilterOption[];
    requestKinds: LlmUsageFilterOption[];
    apiSurfaces: LlmUsageFilterOption[];
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

function compactNumber(value: number): string {
    return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTokens(value: number): string {
    return tokenFormatter.format(value || 0);
}

function successRate(totals: LlmUsageTotals): string {
    if (!totals.request_count) return "0%";
    return `${Math.round((totals.success_count / totals.request_count) * 100)}%`;
}

function errorRate(totals: LlmUsageTotals): string {
    if (!totals.request_count) return "0%";
    return `${Math.round((totals.error_count / totals.request_count) * 100)}%`;
}

function cleanFilter(value?: string | null): string {
    return value ?? "";
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

export function buildLlmUsageFilterOptions(overview: LlmUsageOverview, events: LlmUsageEventsPage): LlmUsageFilterOptions {
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

function MetricTile({
    label,
    value,
    detail,
    icon: Icon
}: {
    label: string;
    value: string;
    detail: string;
    icon: typeof IconActivity;
}) {
    return (
        <div className="min-w-0 border border-border p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    {label}
                </p>
                <Icon className="size-4 shrink-0 text-primary" stroke={1.8} />
            </div>
            <div className="break-words text-3xl font-semibold leading-none tracking-normal">{value}</div>
            <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        </div>
    );
}

function FilterForm({
    filters,
    filterOptions,
    granularity
}: {
    filters: LlmUsageFilters;
    filterOptions: LlmUsageFilterOptions;
    granularity: LlmUsageGranularity;
}) {
    return (
        <form className="grid gap-3 border border-border p-4 min-[900px]:grid-cols-8" action="/llm-usage">
            <label className="grid gap-1">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    From
                </span>
                <Input defaultValue={cleanFilter(filters.date_from)} name="date_from" type="date" />
            </label>
            <label className="grid gap-1">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    To
                </span>
                <Input defaultValue={cleanFilter(filters.date_to)} name="date_to" type="date" />
            </label>
            <LlmUsageFilterSelect label="Provider" name="provider" options={filterOptions.providers} value={filters.provider} />
            <div className="min-[900px]:col-span-2">
                <LlmUsageFilterSelect label="Model" name="model_id" options={filterOptions.models} value={filters.model_id} />
            </div>
            <div className="min-[900px]:col-span-2">
                <LlmUsageFilterSelect label="Workflow" name="workflow_id" options={filterOptions.workflows} value={filters.workflow_id} />
            </div>
            <LlmUsageFilterSelect
                includeAll={false}
                label="Bucket"
                name="granularity"
                options={[
                    { label: "Daily", value: "daily" },
                    { label: "Weekly", value: "weekly" },
                    { label: "Monthly", value: "monthly" }
                ]}
                value={granularity}
            />
            <div className="min-[900px]:col-span-2">
                <LlmUsageFilterSelect label="Request kind" name="request_kind" options={filterOptions.requestKinds} value={filters.request_kind} />
            </div>
            <div className="min-[900px]:col-span-2">
                <LlmUsageFilterSelect label="API surface" name="api_surface" options={filterOptions.apiSurfaces} value={filters.api_surface} />
            </div>
            <div className="flex items-end gap-2 min-[900px]:col-span-4">
                <Button className="min-h-10" type="submit">
                    Apply filters
                </Button>
                <Button asChild className="min-h-10" type="button" variant="secondary">
                    <Link href="/llm-usage">Clear</Link>
                </Button>
            </div>
        </form>
    );
}

function TotalsGrid({ overview }: { overview: LlmUsageOverview }) {
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
    return (
        <section className="grid gap-3 min-[760px]:grid-cols-2 min-[1180px]:grid-cols-4">
            <MetricTile
                detail={`${formatTokens(overview.totals.prompt_tokens)} input / ${formatTokens(overview.totals.completion_tokens)} output`}
                icon={IconActivity}
                label="Requests"
                value={formatTokens(overview.totals.request_count)}
            />
            <MetricTile
                detail={`${successRate(overview.totals)} success, ${errorRate(overview.totals)} error`}
                icon={IconAlertTriangle}
                label="Reliability"
                value={`${formatTokens(overview.totals.success_count)} / ${formatTokens(overview.totals.error_count)}`}
            />
            <MetricTile
                detail={`${cachedDetail}, ${reasoningDetail}`}
                icon={IconBrain}
                label="Tokens"
                value={formatTokens(overview.totals.total_tokens)}
            />
            <MetricTile
                detail={`${formatTokens(overview.totals.priced_request_count)} priced requests`}
                icon={IconCoins}
                label="Provider cost"
                value={formatLlmCost(overview.totals.provider_cost_total, overview.totals.priced_request_count)}
            />
        </section>
    );
}

function PeriodGrid({ overview }: { overview: LlmUsageOverview }) {
    const periods = [
        { label: "Today", totals: overview.today },
        { label: "Current week", totals: overview.current_week },
        { label: "Current month", totals: overview.current_month }
    ];
    return (
        <section className="grid gap-3 min-[760px]:grid-cols-3">
            {periods.map((period) => (
                <div className="border border-border p-4" key={period.label}>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                        {period.label}
                    </p>
                    <div className="mt-3 flex items-end justify-between gap-3">
                        <div className="text-2xl font-semibold leading-none">{formatTokens(period.totals.request_count)}</div>
                        <div className="text-right text-xs text-muted-foreground">
                            {formatTokens(period.totals.total_tokens)} tokens
                        </div>
                    </div>
                    <div className="mt-4 h-2 bg-secondary">
                        <div
                            className="h-full bg-primary"
                            style={{
                                width: `${period.totals.request_count ? Math.max((period.totals.success_count / period.totals.request_count) * 100, 4) : 0}%`
                            }}
                        />
                    </div>
                </div>
            ))}
        </section>
    );
}

function UsageChart({ buckets }: { buckets: LlmUsageTimeBucket[] }) {
    const maxTokens = Math.max(...buckets.map((bucket) => bucket.total_tokens), 0);
    const isSparse = buckets.length <= 3;
    return (
        <section className="border border-border p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <div className="type-section-title">Usage trend</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {isSparse ? "Only a few usage buckets exist in this slice." : "Token volume by selected bucket."}
                    </p>
                </div>
                <IconClock className="size-5 text-primary" stroke={1.8} />
            </div>
            {buckets.length ? (
                <div
                    className={`flex h-56 items-end gap-3 overflow-x-auto border-t border-border pt-4 ${
                        isSparse ? "justify-start" : ""
                    }`}
                >
                    {buckets.map((bucket) => {
                        const height = maxTokens ? Math.max((bucket.total_tokens / maxTokens) * 100, 3) : 0;
                        return (
                            <div
                                className={`flex flex-col items-center gap-2 ${isSparse ? "w-20 shrink-0" : "min-w-16 flex-1"}`}
                                key={bucket.bucket_key}
                            >
                                <div className="flex h-40 w-full items-end">
                                    <div
                                        className="mx-auto w-10 bg-primary/80 transition-colors hover:bg-primary"
                                        title={`${bucket.bucket_label}: ${formatTokens(bucket.total_tokens)} tokens`}
                                        style={{ height: `${height}%` }}
                                    />
                                </div>
                                <div className="w-full truncate text-center font-mono text-[10px] text-muted-foreground">
                                    {bucket.bucket_label}
                                </div>
                                <div className="text-center text-xs font-semibold">{compactNumber(bucket.total_tokens)}</div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="border-t border-border pt-4 text-sm text-muted-foreground">No usage buckets in this slice.</div>
            )}
        </section>
    );
}

function GroupTable({
    title,
    description,
    rows,
    kind
}: {
    title: string;
    description: string;
    rows: LlmUsageGroup[];
    kind: "provider" | "model" | "workflow" | "request";
}) {
    return (
        <section className="border border-border p-4">
            <div className="mb-4">
                <div className="type-section-title">{title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
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
                                <TableCell>
                                    <div className="max-w-[260px] truncate font-semibold">{name}</div>
                                    {sub ? <div className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">{sub}</div> : null}
                                </TableCell>
                                <TableCell className="text-right">{formatTokens(row.request_count)}</TableCell>
                                <TableCell className="text-right">{formatTokens(row.total_tokens)}</TableCell>
                                <TableCell className="text-right">{formatLlmCost(row.provider_cost_total, row.priced_request_count)}</TableCell>
                            </TableRow>
                        );
                    })}
                    {!rows.length ? (
                        <TableRow>
                            <TableCell className="text-muted-foreground" colSpan={4}>
                                No rows in this slice.
                            </TableCell>
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
        </section>
    );
}

function RecentEvents({ events }: { events: LlmUsageEventsPage }) {
    return (
        <section className="border border-border p-4">
            <div className="mb-4 flex flex-col justify-between gap-3 min-[760px]:flex-row min-[760px]:items-end">
                <div>
                    <div className="type-section-title">Recent request ledger</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Raw tracked calls with provider usage metadata and captured workflow context.
                    </p>
                </div>
                <StatusBadge>{events.items.length} rows</StatusBadge>
            </div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Completed</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Workflow</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {events.items.map((event) => (
                        <TableRow key={event.id}>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                                {formatIstDateTime(event.completed_at)}
                            </TableCell>
                            <TableCell>
                                <div className="font-semibold">{event.provider}</div>
                                <div className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">{event.model_id}</div>
                            </TableCell>
                            <TableCell>
                                <div className="max-w-[240px] truncate font-semibold">{eventWorkflowDisplayName(event)}</div>
                                <div className="mt-1 max-w-[240px] truncate text-xs text-muted-foreground">
                                    {requestKindDisplay(event.request_kind, event.request_kind_label)} / {apiSurfaceDisplay(event.api_surface, event.api_surface_label)}
                                </div>
                                <div className="mt-1 max-w-[240px] truncate text-[11px] text-muted-foreground">
                                    {event.request_kind} / {event.api_surface}
                                </div>
                                {event.error ? <div className="mt-1 max-w-[240px] truncate text-xs text-[var(--danger)]">{event.error}</div> : null}
                            </TableCell>
                            <TableCell className="text-right">{formatTokens(event.total_tokens)}</TableCell>
                            <TableCell className="text-right">{event.latency_ms == null ? "n/a" : `${event.latency_ms} ms`}</TableCell>
                            <TableCell>
                                <Badge
                                    variant={event.status === "success" ? "default" : "destructive"}
                                >
                                    {event.status}
                                </Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                    {!events.items.length ? (
                        <TableRow>
                            <TableCell className="text-muted-foreground" colSpan={6}>
                                No tracked LLM calls match the current filters.
                            </TableCell>
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
        </section>
    );
}

export function LlmUsageDashboard({ overview, timeseries, events, filterOptions, filters, granularity }: LlmUsageDashboardProps) {
    return (
        <Shell>
            <PageHeader
                action={
                    <Button asChild className="min-h-11">
                        <Link href="/llm-usage">
                            <IconRefresh className="size-4" stroke={1.8} />
                            Refresh
                        </Link>
                    </Button>
                }
                description="Monitor provider calls, token volume, provider-reported cost, and workflow-level LLM activity."
                eyebrow="Operations"
                title="LLM Usage"
            />
            <div className="grid gap-5">
                <FilterForm filterOptions={filterOptions} filters={filters} granularity={granularity} />
                <TotalsGrid overview={overview} />
                <PeriodGrid overview={overview} />
                <UsageChart buckets={timeseries.buckets} />
                <div className="grid gap-5 min-[1180px]:grid-cols-2">
                    <GroupTable
                        description="Requests grouped by upstream provider."
                        kind="provider"
                        rows={overview.by_provider}
                        title="Providers"
                    />
                    <GroupTable
                        description="Provider and model combinations with the highest usage."
                        kind="model"
                        rows={overview.by_model}
                        title="Models"
                    />
                    <GroupTable
                        description="Workflow identities are retained in the usage ledger."
                        kind="workflow"
                        rows={overview.top_workflows}
                        title="Top workflows"
                    />
                    <GroupTable
                        description="Backend request categories for alert analysis and feed triggers."
                        kind="request"
                        rows={overview.request_kinds}
                        title="Request kinds"
                    />
                </div>
                <RecentEvents events={events} />
                {overview.notes.length ? (
                    <section className="border border-border p-4">
                        <div className="type-section-title">Ledger notes</div>
                        <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
                            {overview.notes.map((note) => (
                                <li className="border-l-2 border-primary pl-3" key={note}>
                                    {note}
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}
            </div>
        </Shell>
    );
}
