import Link from "next/link";
import type { ReactNode } from "react";
import {
    IconAlertTriangle,
    IconArrowRight,
    IconBellRinging,
    IconBrain,
    IconBuildingBank,
    IconChartBar,
    IconCircleCheck,
    IconPlugConnected,
    IconSettings2
} from "@tabler/icons-react";
import { PageHeader, Shell, StatusBadge, isBrokerAccountReady } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import { formatLlmCost, requestKindDisplay } from "@/lib/llm-usage";
import {
    getAlertHistory,
    getAlertUnreadCount,
    getAlertWorkflows,
    getLiveStreamsStatus
} from "@/service/actions/alerts";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getLlmUsageOverview } from "@/service/actions/llm-usage";
import type { AlertWorkflow, AlertWorkflowRun, LiveStreamsStatus } from "@/service/types/alerts";
import type { BrokerAccount, SystemConfig } from "@/service/types/broker";
import type { LlmUsageOverview } from "@/service/types/llm-usage";
import { formatUserFacingError } from "@/lib/api-errors";
import { parseActionError } from "@/components/brokers/action-error";

export const dynamic = "force-dynamic";

type Tone = "good" | "warn" | "danger" | "muted";

type LoadResult<T> = {
    data: T;
    error?: string;
    status?: number;
};

type DashboardData = {
    accounts: LoadResult<BrokerAccount[]>;
    activeWorkflows: LoadResult<AlertWorkflow[]>;
    inactiveWorkflows: LoadResult<AlertWorkflow[]>;
    unreadAlerts: LoadResult<number>;
    alertRuns: LoadResult<AlertWorkflowRun[]>;
    liveStreams: LoadResult<LiveStreamsStatus | null>;
    llmOverview: LoadResult<LlmUsageOverview | null>;
    systemConfig: LoadResult<SystemConfig | null>;
};

const numberFormatter = new Intl.NumberFormat("en-IN");
const compactFormatter = new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
});

function formatNumber(value: number): string {
    return numberFormatter.format(value || 0);
}

function compactNumber(value: number): string {
    return compactFormatter.format(value || 0);
}

function settled<T>(result: PromiseSettledResult<T>, fallback: T): LoadResult<T> {
    if (result.status === "fulfilled") return { data: result.value };
    const parsed = parseActionError(result.reason);
    return {
        data: fallback,
        error: formatUserFacingError(result.reason),
        status: parsed.status
    };
}

function isFreshSetupError(result: LoadResult<unknown>): boolean {
    return Boolean(result.error && result.status && result.status >= 500);
}

function toneClasses(tone: Tone) {
    if (tone === "good") return "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]";
    if (tone === "danger") return "border-[var(--danger)] bg-[var(--danger-subtle)] text-[var(--danger)]";
    if (tone === "warn")
        return "border-primary bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]";
    return "border-border bg-secondary text-muted-foreground";
}

function successRate(successCount: number, requestCount: number): string {
    if (!requestCount) return "0%";
    return `${Math.round((successCount / requestCount) * 100)}%`;
}

function firstRuntimeError(workflows: AlertWorkflow[]): string | null {
    return workflows.find((workflow) => workflow.last_runtime_error)?.last_runtime_error ?? null;
}

function ApiStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 border border-border bg-background px-3 py-3">
            <div className="type-step-eyebrow">{label}</div>
            <div className="mt-2 truncate text-2xl font-semibold leading-none">{value}</div>
        </div>
    );
}

function DashboardCard({
    href,
    label,
    title,
    description,
    tone,
    icon: Icon,
    error,
    children
}: {
    href: string;
    label: string;
    title: string;
    description: string;
    tone: Tone;
    icon: typeof IconBuildingBank;
    error?: string;
    children: ReactNode;
}) {
    return (
        <section className="flex h-full min-w-0 flex-col gap-4 border border-border bg-card p-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="type-step-eyebrow">{label}</p>
                    <h2 className="mt-2 text-2xl font-semibold leading-tight">{title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
                <span className={`flex size-10 shrink-0 items-center justify-center border ${toneClasses(tone)}`}>
                    <Icon className="size-5" stroke={1.8} />
                </span>
            </div>
            <div className="grid gap-3 min-[560px]:grid-cols-3">{children}</div>
            {error ? (
                <p className="line-clamp-2 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] p-3 text-sm text-[var(--danger)]">
                    {error}
                </p>
            ) : null}
            <Button asChild className="mt-auto min-h-10 w-full justify-between" variant="secondary">
                <Link href={href}>
                    Open {title}
                    <IconArrowRight className="size-4" stroke={1.8} />
                </Link>
            </Button>
        </section>
    );
}

async function loadDashboardData(): Promise<DashboardData> {
    const [
        accounts,
        activeWorkflows,
        inactiveWorkflows,
        unreadAlerts,
        alertRuns,
        liveStreams,
        llmOverview,
        systemConfig
    ] = await Promise.allSettled([
        getBrokerAccounts(),
        getAlertWorkflows("active"),
        getAlertWorkflows("inactive"),
        getAlertUnreadCount().then((value) => value.unread_count),
        getAlertHistory(24),
        getLiveStreamsStatus(),
        getLlmUsageOverview(),
        getSystemConfig()
    ]);

    return {
        accounts: settled(accounts, []),
        activeWorkflows: settled(activeWorkflows, []),
        inactiveWorkflows: settled(inactiveWorkflows, []),
        unreadAlerts: settled(unreadAlerts, 0),
        alertRuns: settled(alertRuns, []),
        liveStreams: settled(liveStreams, null),
        llmOverview: settled(llmOverview, null),
        systemConfig: settled(systemConfig, null)
    };
}

function BrokerOverviewCard({ data }: { data: DashboardData["accounts"] }) {
    const readyAccounts = data.data.filter(isBrokerAccountReady);
    const attentionAccounts = data.data.filter((account) => account.last_error || !isBrokerAccountReady(account));
    const automationAccounts = data.data.filter((account) => account.automation_enabled);
    const startup = isFreshSetupError(data) && data.data.length === 0;
    const tone: Tone = startup ? "muted" : data.error ? "danger" : attentionAccounts.length ? "warn" : readyAccounts.length ? "good" : "muted";
    const cardError = startup
        ? "No broker accounts yet. Add a broker connection to begin setup."
        : data.error;

    return (
        <DashboardCard
            description="Session readiness, verification, and automation coverage across connected broker accounts."
            error={cardError}
            href="/broker-connections"
            icon={IconBuildingBank}
            label="Broker API"
            title="Broker Connections"
            tone={tone}
        >
            <ApiStat label="Ready" value={`${formatNumber(readyAccounts.length)} / ${formatNumber(data.data.length)}`} />
            <ApiStat label="Needs action" value={formatNumber(attentionAccounts.length)} />
            <ApiStat label="Automation" value={formatNumber(automationAccounts.length)} />
        </DashboardCard>
    );
}

function AlertsOverviewCard({
    activeWorkflows,
    inactiveWorkflows,
    unreadAlerts,
    alertRuns,
    liveStreams
}: {
    activeWorkflows: DashboardData["activeWorkflows"];
    inactiveWorkflows: DashboardData["inactiveWorkflows"];
    unreadAlerts: DashboardData["unreadAlerts"];
    alertRuns: DashboardData["alertRuns"];
    liveStreams: DashboardData["liveStreams"];
}) {
    const allWorkflows = [...activeWorkflows.data, ...inactiveWorkflows.data];
    const runtimeIssues = allWorkflows.filter(
        (workflow) => workflow.last_runtime_error || workflow.deployment_status === "error"
    );
    const matchedRuns = alertRuns.data.filter((run) => run.matched).length;
    const desiredSubscriptions = liveStreams.data?.desired_subscriptions.length ?? 0;
    const error =
        activeWorkflows.error ||
        inactiveWorkflows.error ||
        unreadAlerts.error ||
        alertRuns.error ||
        liveStreams.error;
    const serviceUnavailable =
        [activeWorkflows, inactiveWorkflows, unreadAlerts, alertRuns, liveStreams].some(isFreshSetupError);
    const cardError = serviceUnavailable
        ? "Alerts and live streams will appear after the workspace finishes starting."
        : error;
    const tone: Tone = serviceUnavailable
        ? "muted"
        : error
          ? "danger"
          : runtimeIssues.length || unreadAlerts.data
            ? "warn"
            : activeWorkflows.data.length
              ? "good"
              : "muted";

    return (
        <DashboardCard
            description={
                firstRuntimeError(allWorkflows) ||
                "Workflow state, recent evaluation matches, alert inbox pressure, and live subscription coverage."
            }
            error={cardError}
            href="/alerts-workspace"
            icon={IconBellRinging}
            label="Alert APIs"
            title="Alerts Workspace"
            tone={tone}
        >
            <ApiStat label="Active" value={formatNumber(activeWorkflows.data.length)} />
            <ApiStat label="Unread" value={formatNumber(unreadAlerts.data)} />
            <ApiStat label="Streams" value={formatNumber(desiredSubscriptions)} />
            <ApiStat label="Recent matches" value={`${formatNumber(matchedRuns)} / ${formatNumber(alertRuns.data.length)}`} />
            <ApiStat label="Inactive" value={formatNumber(inactiveWorkflows.data.length)} />
            <ApiStat label="Runtime issues" value={formatNumber(runtimeIssues.length)} />
        </DashboardCard>
    );
}

function LlmOverviewCard({ data }: { data: DashboardData["llmOverview"] }) {
    const overview = data.data;
    const topProvider = overview?.by_provider[0]?.provider ?? "None";
    const topKind = overview?.request_kinds[0]
        ? requestKindDisplay(overview.request_kinds[0].request_kind, overview.request_kinds[0].request_kind_label)
        : "None";
    const requests = overview?.totals.request_count ?? 0;
    const errors = overview?.totals.error_count ?? 0;
    const tone: Tone = data.error ? "danger" : errors ? "warn" : requests ? "good" : "muted";

    return (
        <DashboardCard
            description={`Top provider: ${topProvider}. Top request kind: ${topKind}.`}
            error={data.error}
            href="/llm-usage"
            icon={IconBrain}
            label="LLM Usage API"
            title="LLM Usage"
            tone={tone}
        >
            <ApiStat label="Requests" value={formatNumber(requests)} />
            <ApiStat label="Tokens" value={compactNumber(overview?.totals.total_tokens ?? 0)} />
            <ApiStat label="Success" value={successRate(overview?.totals.success_count ?? 0, requests)} />
            <ApiStat label="Today" value={formatNumber(overview?.today.request_count ?? 0)} />
            <ApiStat
                label="Cost"
                value={formatLlmCost(overview?.totals.provider_cost_total ?? 0, overview?.totals.priced_request_count ?? 0)}
            />
            <ApiStat label="Errors" value={formatNumber(errors)} />
        </DashboardCard>
    );
}

function SettingsOverviewCard({ data }: { data: DashboardData["systemConfig"] }) {
    const config = data.data;
    const llmProviders = config?.llm_providers.filter((provider) => provider.is_enabled && provider.has_api_key) ?? [];
    const enabledModels =
        config?.llm_providers.reduce((total, provider) => {
            return total + provider.models.filter((model) => model.is_enabled).length;
        }, 0) ?? 0;
    const alphaReady = Boolean(config?.alpha_api.is_enabled && config.alpha_api.has_api_key);
    const mcpServers = config
        ? [config.mcp_server, ...config.mcp_servers].filter(
              (server) => server.is_enabled && (server.oauth_authenticated || server.has_api_key)
          )
        : [];
    const defaultAccount =
        config?.broker_data_default.accounts.find((account) => account.is_effective)?.label ??
        config?.broker_data_default.effective_default_account_id ??
        "None";
    const tone: Tone = data.error ? "danger" : llmProviders.length || alphaReady || mcpServers.length ? "good" : "muted";

    return (
        <DashboardCard
            description={`Default broker: ${defaultAccount}. Provider credentials and data connectors are summarized from system config.`}
            error={data.error}
            href="/settings"
            icon={IconSettings2}
            label="Config APIs"
            title="Settings"
            tone={tone}
        >
            <ApiStat label="LLM keys" value={formatNumber(llmProviders.length)} />
            <ApiStat label="Models" value={formatNumber(enabledModels)} />
            <ApiStat label="Alpha API" value={alphaReady ? "Ready" : "Off"} />
            <ApiStat label="MCP servers" value={formatNumber(mcpServers.length)} />
            <ApiStat label="Default data" value={config?.broker_data_default.effective_default_account_id ? "Set" : "None"} />
            <ApiStat label="Search fallback" value={config?.broker_data_search.fallback_used ? "Yes" : "No"} />
        </DashboardCard>
    );
}

function SnapshotBar({ data }: { data: DashboardData }) {
    const readyAccounts = data.accounts.data.filter(isBrokerAccountReady).length;
    const streamsOk = Boolean(data.liveStreams.data?.redis_ok);
    const llmRequestsToday = data.llmOverview.data?.today.request_count ?? 0;
    const unreadAlerts = data.unreadAlerts.data;
    const degradedApis = [
        data.accounts,
        data.activeWorkflows,
        data.inactiveWorkflows,
        data.unreadAlerts,
        data.alertRuns,
        data.liveStreams,
        data.llmOverview,
        data.systemConfig
    ].filter((result) => result.error && !isFreshSetupError(result)).length;

    return (
        <section className="grid gap-3 border border-border bg-card p-4 min-[820px]:grid-cols-4">
            <div className="flex items-center gap-3">
                <StatusBadge className={toneClasses(readyAccounts ? "good" : "muted")}>
                    <IconCircleCheck className="mr-1 size-3" stroke={1.8} />
                    {formatNumber(readyAccounts)}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">broker accounts ready</span>
            </div>
            <div className="flex items-center gap-3">
                <StatusBadge className={toneClasses(streamsOk ? "good" : "warn")}>
                    <IconPlugConnected className="mr-1 size-3" stroke={1.8} />
                    {streamsOk ? "online" : "check"}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">live stream cache</span>
            </div>
            <div className="flex items-center gap-3">
                <StatusBadge className={toneClasses(unreadAlerts ? "warn" : "muted")}>
                    <IconAlertTriangle className="mr-1 size-3" stroke={1.8} />
                    {formatNumber(unreadAlerts)}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">unread alerts</span>
            </div>
            <div className="flex items-center gap-3">
                <StatusBadge className={toneClasses(degradedApis ? "danger" : "good")}>
                    <IconChartBar className="mr-1 size-3" stroke={1.8} />
                    {formatNumber(llmRequestsToday)}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">
                    LLM calls today{degradedApis ? ` · ${degradedApis} API gaps` : ""}
                </span>
            </div>
        </section>
    );
}

export default async function DashboardPage() {
    const data = await loadDashboardData();

    return (
        <Shell>
            <PageHeader
                eyebrow="Workspace"
                title="Dashboard"
                description="Monitor broker readiness, user alerting, live market workflow infrastructure, and LLM usage from one workspace."
            />

            <div className="grid gap-5">
                <SnapshotBar data={data} />
                <section className="grid gap-4 min-[1180px]:grid-cols-2">
                    <BrokerOverviewCard data={data.accounts} />
                    <AlertsOverviewCard
                        activeWorkflows={data.activeWorkflows}
                        alertRuns={data.alertRuns}
                        inactiveWorkflows={data.inactiveWorkflows}
                        liveStreams={data.liveStreams}
                        unreadAlerts={data.unreadAlerts}
                    />
                    <LlmOverviewCard data={data.llmOverview} />
                    <SettingsOverviewCard data={data.systemConfig} />
                </section>
            </div>
        </Shell>
    );
}
