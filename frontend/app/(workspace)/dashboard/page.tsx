import Link from "next/link";
import {
    IconBellRinging,
    IconBolt,
    IconBrain,
    IconBuildingBank,
    IconChartBar,
    IconCircleX,
    IconPlugConnected,
    IconSettings2
} from "@tabler/icons-react";
import {
    ActivityRow,
    DashboardModuleCard,
    EmptyStateLine,
    MetricPanel,
    ProgressTrack,
    SetupChecklist,
    type DashboardTone,
    type SetupChecklistItem
} from "@/components/dashboard/dashboard-ui";
import { PageHeader, isBrokerAccountReady } from "@/components/brokers/ui";
import { DRISHTI_API_SIGNUP_URL } from "@/lib/drishti";
import { formatIstDateTime } from "@/lib/datetime";
import { formatDisplayLlmCost, requestKindDisplay } from "@/lib/llm-usage";
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
import { withServerFetchRetry } from "@/lib/server-fetch-retry";
import { getWorkspaceSetupReadiness } from "@/lib/setup-readiness";

export const dynamic = "force-dynamic";

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

function percent(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return Math.round((numerator / denominator) * 100);
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

function firstRuntimeError(workflows: AlertWorkflow[]): string | null {
    return workflows.find((workflow) => workflow.last_runtime_error)?.last_runtime_error ?? null;
}

function getSetupItems(data: DashboardData): SetupChecklistItem[] {
    const { alphaReady, hasBroker, llmReady, mcpReady } = getWorkspaceSetupReadiness(
        data.accounts.data,
        data.systemConfig.data
    );

    return [
        {
            id: "broker",
            label: "Connect a broker",
            description: "Link a broker account for live data, orders, and portfolio context.",
            href: "/broker-connections",
            complete: hasBroker,
            icon: IconBuildingBank
        },
        {
            id: "drishti",
            label: "Add Drishti API key",
            description: "Enable market intelligence, symbol metadata, and watchlist enrichment.",
            href: "/settings#alpha",
            complete: alphaReady,
            icon: IconChartBar
        },
        {
            id: "llm",
            label: "Configure LLM providers",
            description: "Store provider keys for broker chat and alert analysis.",
            href: "/settings#llm",
            complete: llmReady,
            icon: IconBrain
        },
        {
            id: "mcp",
            label: "Connect MCP servers",
            description: "Optional hosted tools for broker chat when MCP is enabled.",
            href: "/settings#mcp",
            complete: mcpReady,
            icon: IconPlugConnected
        }
    ];
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
        withServerFetchRetry("broker accounts", getBrokerAccounts),
        withServerFetchRetry("active workflows", () => getAlertWorkflows("active")),
        withServerFetchRetry("inactive workflows", () => getAlertWorkflows("inactive")),
        withServerFetchRetry("alert unread count", () =>
            getAlertUnreadCount().then((value) => value.unread_count)
        ),
        withServerFetchRetry("alert history", () => getAlertHistory(24)),
        withServerFetchRetry("live streams", getLiveStreamsStatus),
        withServerFetchRetry("llm usage", getLlmUsageOverview),
        withServerFetchRetry("system config", getSystemConfig)
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
    const tone: DashboardTone = data.error
        ? "danger"
        : attentionAccounts.length
          ? "warn"
          : readyAccounts.length
            ? "good"
            : "muted";
    const hasSignal =
        data.data.length > 0 || attentionAccounts.length > 0 || automationAccounts.length > 0 || Boolean(data.error);
    const readyPct = percent(readyAccounts.length, data.data.length);

    return (
        <DashboardModuleCard
            description="Session readiness and automation coverage across connected broker accounts."
            error={data.error}
            href="/broker-connections"
            icon={IconBuildingBank}
            title="Broker Connections"
            tone={tone}
        >
            {hasSignal ? (
                <>
                    {data.data.length > 0 ? (
                        <ProgressTrack
                            detail={`${formatNumber(readyAccounts.length)} of ${formatNumber(data.data.length)} ready`}
                            label="Account readiness"
                            value={readyPct}
                        />
                    ) : null}
                    {(readyAccounts.length > 0 || automationAccounts.length > 0) && (
                        <div className="grid gap-3 min-[480px]:grid-cols-2">
                            {readyAccounts.length > 0 || data.data.length > 0 ? (
                                <MetricPanel
                                    hint="Verified sessions available for broker-backed data"
                                    label="Ready accounts"
                                    value={`${formatNumber(readyAccounts.length)} / ${formatNumber(data.data.length)}`}
                                />
                            ) : null}
                            {automationAccounts.length > 0 ? (
                                <MetricPanel
                                    hint="Accounts with scheduled session maintenance enabled"
                                    label="Automation"
                                    value={formatNumber(automationAccounts.length)}
                                />
                            ) : null}
                        </div>
                    )}
                    {attentionAccounts.length > 0 ? (
                        <MetricPanel label="Needs action" value={formatNumber(attentionAccounts.length)} />
                    ) : null}
                </>
            ) : (
                <EmptyStateLine
                    action={
                        <Link className="font-medium text-primary underline underline-offset-2" href="/broker-connections">
                            Connect a broker
                        </Link>
                    }
                >
                    No broker accounts connected yet.
                </EmptyStateLine>
            )}
        </DashboardModuleCard>
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
    const serviceUnavailable = [activeWorkflows, inactiveWorkflows, unreadAlerts, alertRuns, liveStreams].some(
        isFreshSetupError
    );
    const cardError = serviceUnavailable
        ? "Alerts and live streams will appear after the workspace finishes starting."
        : error;
    const tone: DashboardTone = serviceUnavailable
        ? "muted"
        : error
          ? "danger"
          : runtimeIssues.length || unreadAlerts.data
            ? "warn"
            : activeWorkflows.data.length
              ? "good"
              : "muted";
    const recentRuns = alertRuns.data.slice(0, 4);
    const hasSignal =
        activeWorkflows.data.length > 0 ||
        unreadAlerts.data > 0 ||
        alertRuns.data.length > 0 ||
        runtimeIssues.length > 0 ||
        desiredSubscriptions > 0 ||
        Boolean(cardError);

    return (
        <DashboardModuleCard
            description={
                firstRuntimeError(allWorkflows) ||
                "Workflow evaluations, alert inbox pressure, and live subscription coverage."
            }
            error={cardError}
            href="/alerts-workspace"
            icon={IconBellRinging}
            title="Alerts Workspace"
            tone={tone}
        >
            {hasSignal ? (
                <>
                    {(activeWorkflows.data.length > 0 ||
                        unreadAlerts.data > 0 ||
                        desiredSubscriptions > 0 ||
                        runtimeIssues.length > 0) && (
                        <div className="grid gap-3 min-[480px]:grid-cols-2">
                            {activeWorkflows.data.length > 0 ? (
                                <MetricPanel label="Active workflows" value={formatNumber(activeWorkflows.data.length)} />
                            ) : null}
                            {unreadAlerts.data > 0 ? (
                                <MetricPanel label="Unread alerts" value={formatNumber(unreadAlerts.data)} />
                            ) : null}
                            {desiredSubscriptions > 0 ? (
                                <MetricPanel label="Live streams" value={formatNumber(desiredSubscriptions)} />
                            ) : null}
                            {runtimeIssues.length > 0 ? (
                                <MetricPanel label="Runtime issues" value={formatNumber(runtimeIssues.length)} />
                            ) : null}
                        </div>
                    )}
                    {alertRuns.data.length > 0 ? (
                        <ProgressTrack
                            detail={`${formatNumber(matchedRuns)} matched of ${formatNumber(alertRuns.data.length)}`}
                            label="Recent evaluation matches"
                            value={percent(matchedRuns, alertRuns.data.length)}
                        />
                    ) : null}
                    {recentRuns.length > 0 ? (
                        <div className="flex flex-col gap-1">
                            {recentRuns.map((run) => (
                                <ActivityRow
                                    icon={run.matched ? IconBolt : IconCircleX}
                                    key={run.id}
                                    meta={formatIstDateTime(run.created_at, "—")}
                                    subtitle={run.reason}
                                    title={run.rendered_title}
                                    value={run.matched ? "Matched" : "No match"}
                                    valueClassName={run.matched ? "text-[var(--success)]" : "text-muted-foreground"}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyStateLine>No recent workflow evaluations yet.</EmptyStateLine>
                    )}
                </>
            ) : (
                <EmptyStateLine
                    action={
                        <Link
                            className="font-medium text-primary underline underline-offset-2"
                            href="/alerts-workspace/workflows/new"
                        >
                            Create a workflow
                        </Link>
                    }
                >
                    No alert activity yet. Create a workflow to start monitoring.
                </EmptyStateLine>
            )}
        </DashboardModuleCard>
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
    const successCount = overview?.totals.success_count ?? 0;
    const todayRequests = overview?.today.request_count ?? 0;
    const tone: DashboardTone = data.error ? "danger" : errors ? "warn" : "good";

    return (
        <DashboardModuleCard
            description={`Top provider: ${topProvider}. Top request kind: ${topKind}.`}
            error={data.error}
            href="/llm-usage"
            icon={IconBrain}
            iconClassName="text-foreground"
            iconStroke={2.2}
            title="LLM Usage"
            tone={tone}
        >
            <div className="grid gap-3 min-[480px]:grid-cols-2">
                <MetricPanel label="Total requests" value={formatNumber(requests)} />
                <MetricPanel label="Tokens used" value={compactNumber(overview?.totals.total_tokens ?? 0)} />
            </div>
            <ProgressTrack
                detail={`${formatNumber(successCount)} successful`}
                label="Success rate"
                value={percent(successCount, requests)}
            />
            {todayRequests > 0 ? (
                <ProgressTrack
                    detail={`${formatNumber(todayRequests)} today`}
                    label="Today's share"
                    value={percent(todayRequests, requests)}
                />
            ) : null}
            {(errors > 0 || (overview?.totals.display_cost_total_usd ?? 0) > 0) && (
                <div className="grid gap-3 min-[480px]:grid-cols-2">
                    {errors > 0 ? <MetricPanel label="Errors" value={formatNumber(errors)} /> : null}
                    {(overview?.totals.display_cost_total_usd ?? 0) > 0 ? (
                        <MetricPanel
                            label="LLM cost"
                            value={formatDisplayLlmCost(
                                overview?.totals.display_cost_total_usd ?? 0,
                                overview?.totals.display_cost_request_count ?? 0
                            )}
                        />
                    ) : null}
                </div>
            )}
        </DashboardModuleCard>
    );
}

function SettingsAttentionCard({ data }: { data: DashboardData["systemConfig"] }) {
    const config = data.data;
    const { alphaReady, llmReady, mcpReady } = getWorkspaceSetupReadiness([], config);
    const pendingItems = [
        !alphaReady && "Drishti API key",
        !llmReady && "LLM providers",
        !mcpReady && "MCP servers",
        !config?.broker_data_default.effective_default_account_id && "Default broker data"
    ].filter(Boolean) as string[];
    const tone: DashboardTone = data.error ? "danger" : pendingItems.length ? "warn" : "good";

    return (
        <DashboardModuleCard
            description={
                pendingItems.length
                    ? `${pendingItems.join(", ")} still need attention in workspace settings.`
                    : "Review shared workspace credentials and defaults."
            }
            error={data.error}
            href="/settings"
            icon={IconSettings2}
            title="Settings"
            tone={tone}
        >
            <div className="flex flex-col gap-2 text-sm">
                {!alphaReady ? (
                    <EmptyStateLine>
                        Drishti API key is missing.{" "}
                        <a className="font-medium text-primary underline underline-offset-2" href={DRISHTI_API_SIGNUP_URL}>
                            Create one at drishti.manasija.in
                        </a>{" "}
                        or add it in Settings.
                    </EmptyStateLine>
                ) : null}
                {pendingItems.length > 0 ? (
                    <ul className="list-inside list-disc text-muted-foreground">
                        {pendingItems.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                ) : (
                    <EmptyStateLine>All core integrations are configured.</EmptyStateLine>
                )}
            </div>
        </DashboardModuleCard>
    );
}

function shouldShowAlertsCard(data: DashboardData): boolean {
    const allWorkflows = [...data.activeWorkflows.data, ...data.inactiveWorkflows.data];
    const runtimeIssues = allWorkflows.filter(
        (workflow) => workflow.last_runtime_error || workflow.deployment_status === "error"
    );

    return (
        data.activeWorkflows.data.length > 0 ||
        data.unreadAlerts.data > 0 ||
        data.alertRuns.data.length > 0 ||
        runtimeIssues.length > 0 ||
        (data.liveStreams.data?.desired_subscriptions.length ?? 0) > 0 ||
        Boolean(
            data.activeWorkflows.error ||
                data.inactiveWorkflows.error ||
                data.unreadAlerts.error ||
                data.alertRuns.error ||
                data.liveStreams.error
        )
    );
}

function shouldShowLlmCard(data: DashboardData): boolean {
    const requests = data.llmOverview.data?.totals.request_count ?? 0;
    const errors = data.llmOverview.data?.totals.error_count ?? 0;
    return requests > 0 || errors > 0 || Boolean(data.llmOverview.error);
}

function shouldShowSettingsCard(data: DashboardData): boolean {
    if (data.systemConfig.error) return true;
    const { alphaReady, llmReady, mcpReady } = getWorkspaceSetupReadiness([], data.systemConfig.data);
    const defaultBrokerReady = Boolean(data.systemConfig.data?.broker_data_default.effective_default_account_id);
    return !alphaReady || !llmReady || !mcpReady || !defaultBrokerReady;
}

function shouldShowBrokerCard(data: DashboardData): boolean {
    return data.accounts.data.length > 0 || Boolean(data.accounts.error);
}

export default async function DashboardPage() {
    const data = await loadDashboardData();
    const setupItems = getSetupItems(data);
    const completedSetupCount = setupItems.filter((item) => item.complete).length;
    const setupComplete = completedSetupCount === setupItems.length;

    return (
        <>
            <PageHeader
                eyebrow="Workspace"
                title="Dashboard"
                description="Monitor broker readiness, alerting, live streams, and LLM usage from one workspace."
            />

            <div className="flex flex-col gap-8">
                {!setupComplete ? (
                    <SetupChecklist
                        completedCount={completedSetupCount}
                        items={setupItems}
                        totalCount={setupItems.length}
                    />
                ) : (
                    <section className="grid gap-5 min-[1180px]:grid-cols-2">
                        {shouldShowBrokerCard(data) ? <BrokerOverviewCard data={data.accounts} /> : null}
                        {shouldShowAlertsCard(data) ? (
                            <AlertsOverviewCard
                                activeWorkflows={data.activeWorkflows}
                                alertRuns={data.alertRuns}
                                inactiveWorkflows={data.inactiveWorkflows}
                                liveStreams={data.liveStreams}
                                unreadAlerts={data.unreadAlerts}
                            />
                        ) : null}
                        {shouldShowLlmCard(data) ? <LlmOverviewCard data={data.llmOverview} /> : null}
                        {shouldShowSettingsCard(data) ? <SettingsAttentionCard data={data.systemConfig} /> : null}
                    </section>
                )}
            </div>
        </>
    );
}
