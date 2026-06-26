import { Suspense } from "react";
import Link from "next/link";
import { IconArrowRight, IconBolt, IconChecklist } from "@tabler/icons-react";
import { AlertHistoryList } from "@/components/alerts/alert-history-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedSkeleton, StatGridSkeleton } from "@/components/ui/loading-skeletons";
import { formatIstDateTime } from "@/lib/datetime";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";
import {
    getAlertChannels,
    getAlertHistory,
    getAlertNotifications,
    getAlertUnreadCount,
    getAlertWorkflows,
    getLiveStreamsStatus
} from "@/service/actions/alerts";
import type {
    AlertChannel,
    AlertWorkflow,
    AlertWorkflowRun,
    LiveBrokerAccountStatus,
    LiveStreamsStatus
} from "@/service/types/alerts";

export const dynamic = "force-dynamic";

type Tone = "good" | "warn" | "danger" | "muted";

function statusDotClass(tone: Tone) {
    if (tone === "good") return "bg-success";
    if (tone === "danger") return "bg-destructive";
    if (tone === "warn") return "bg-warning";
    return "bg-muted-foreground/50";
}

function formatDateTime(value?: string | null) {
    return formatIstDateTime(value, "Not yet");
}

function percent(numerator: number, denominator: number) {
    if (!denominator) return "0%";
    return `${Math.round((numerator / denominator) * 100)}%`;
}

function targetSummary(workflow: AlertWorkflow) {
    const targeting = workflow.workflow_dsl.targeting;
    const ast = workflow.workflow_dsl.workflow_ast as Record<string, unknown> | null | undefined;
    const targetUniverse =
        ast && typeof ast.target_universe === "object" && ast.target_universe !== null
            ? (ast.target_universe as Record<string, unknown>)
            : null;
    if (targeting.mode === "symbol_list") {
        return `${targeting.entries.length} symbols`;
    }
    if (targeting.mode === "preset_universe") {
        if (targetUniverse?.kind === "watchlist") {
            return String(targetUniverse.label ?? targetUniverse.watchlist_id ?? "Watchlist universe");
        }
        return targeting.preset_label || targeting.preset_id || "Watchlist universe";
    }
    const entry = targeting.entries[0];
    return [entry?.symbol || workflow.symbol || "No target", entry?.exchange || workflow.exchange]
        .filter(Boolean)
        .join(" · ");
}

function triggerSummary(workflow: AlertWorkflow) {
    if (workflow.workflow_dsl.workflow_type === "alpha_feed") {
        const products = workflow.workflow_dsl.feed_trigger.products;
        return products.length ? products.join(", ") : "Feed trigger";
    }
    const conditions = workflow.workflow_dsl.conditions.length;
    return `${conditions} ${conditions === 1 ? "condition" : "conditions"} · ${workflow.workflow_dsl.combine}`;
}

function channelSummary(workflow: AlertWorkflow) {
    const channels = workflow.channel_override?.enabled ?? workflow.workflow_dsl.channels.enabled;
    return channels.length ? channels.join(", ").replaceAll("_", " ") : "No channels";
}

function latestRunForWorkflow(runs: AlertWorkflowRun[], workflowId: string) {
    return runs.find((run) => run.workflow_id === workflowId);
}

function enabledChannelCount(channels: AlertChannel[]) {
    return channels.filter((channel) => channel.is_enabled).length;
}

function brokerTone(status: LiveBrokerAccountStatus): Tone {
    if (status.action_required || status.last_error) return "danger";
    if (!status.can_stream || !status.session_active) return "warn";
    return "good";
}

function brokerBadgeClasses(tone: Tone) {
    if (tone === "good") return "border-success/20 bg-success/8 text-success-foreground";
    if (tone === "danger") return "border-destructive/20 bg-destructive/8 text-destructive-foreground";
    if (tone === "warn") return "border-warning/20 bg-warning/8 text-warning-foreground";
    return "border-border bg-muted text-muted-foreground";
}

function StatCard({
    label,
    value,
    subtext,
    statusDot
}: {
    label: string;
    value: string;
    subtext: string;
    statusDot?: Tone;
}) {
    return (
        <div className="min-w-0 rounded-lg bg-muted/50 px-4 py-3">
            <div className={cn(typography.muted, "flex items-center gap-1.5")}>
                {statusDot ? (
                    <span
                        aria-hidden="true"
                        className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(statusDot))}
                    />
                ) : null}
                {label}
            </div>
            <p className={cn(typography.h3, "mt-2")}>{value}</p>
            <p className={cn(typography.muted, "mt-1 leading-5")}>{subtext}</p>
        </div>
    );
}

function PanelSection({
    label,
    children,
    className
}: {
    label: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("border-b border-border/50 pb-5 last:border-b-0 last:pb-0", className)}>
            <p className="type-step-eyebrow">{label}</p>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function BrokerBanner() {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/20 bg-warning/8 px-4 py-3">
            <p className="type-body text-sm">
                <span aria-hidden="true" className="mr-1.5">
                    ⚠
                </span>
                Broker account required — Connect a broker stream before workflows can evaluate live data.
            </p>
            <Link
                className={cn(typography.small, "inline-flex shrink-0 items-center gap-1 hover:underline")}
                href="/broker-connections"
            >
                Connect broker
                <IconArrowRight className="size-3.5" stroke={1.8} />
            </Link>
        </div>
    );
}

type SetupStep = {
    title: string;
    description: string;
    href: string;
    cta: string;
    status: "incomplete-amber" | "incomplete" | "complete";
};

function SetupChecklist({ steps }: { steps: SetupStep[] }) {
    return (
        <section className="min-h-[120px] rounded-lg border border-border bg-card p-5">
            <h2 className="type-section-title">Get started</h2>
            <p className="type-help mt-1">Complete these steps to start monitoring live market data.</p>
            <ol className="mt-5 grid gap-4">
                {steps.map((step, index) => (
                    <li className="flex gap-3" key={step.title}>
                        <span
                            aria-hidden="true"
                            className={cn(
                                "mt-1.5 size-2 shrink-0 rounded-full",
                                step.status === "complete"
                                    ? "bg-success"
                                    : step.status === "incomplete-amber"
                                      ? "bg-warning"
                                      : "bg-muted-foreground/40"
                            )}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span className="type-meta">{index + 1}.</span>
                                <span className="type-label">{step.title}</span>
                                <Link
                                    className={cn(typography.small, "inline-flex items-center gap-0.5 hover:underline")}
                                    href={step.href}
                                >
                                    {step.cta}
                                    <IconArrowRight className="size-3" stroke={1.8} />
                                </Link>
                            </div>
                            <p className="type-help mt-0.5">{step.description}</p>
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
}

function AttentionPanel({
    unreadCount,
    hasActiveWorkflows
}: {
    unreadCount: number;
    hasActiveWorkflows: boolean;
}) {
    return (
        <PanelSection label="Attention">
            <div className="grid gap-3">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="type-label">Alert inbox</span>
                    {unreadCount > 0 ? (
                        <Badge size="sm" variant="warning">
                            {unreadCount} unread
                        </Badge>
                    ) : (
                        <span className="type-meta">All read</span>
                    )}
                </div>
                <p className="type-help">
                    {unreadCount > 0
                        ? `${unreadCount} notification${unreadCount === 1 ? "" : "s"} waiting for review.`
                        : "No unread notifications in the current snapshot."}
                </p>
                <div className="flex flex-col gap-2 pt-1">
                    <Button className="w-full" render={<Link href="/alerts-workspace/workflows/new" />}>
                        <IconBolt className="size-4" stroke={1.8} />
                        Create workflow
                    </Button>
                    {unreadCount > 0 ? (
                        <Link
                            className={cn(typography.small, "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline")}
                            href="/alerts-workspace"
                        >
                            Read alerts
                            <IconArrowRight className="size-3.5" stroke={1.8} />
                        </Link>
                    ) : null}
                    {!hasActiveWorkflows ? (
                        <Link
                            className={cn(typography.small, "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline")}
                            href="/alerts-workspace/templates"
                        >
                            Use template
                            <IconArrowRight className="size-3.5" stroke={1.8} />
                        </Link>
                    ) : null}
                </div>
            </div>
        </PanelSection>
    );
}

function StreamReadinessPanel({ streamStatus }: { streamStatus: LiveStreamsStatus }) {
    const sortedBrokers = [...streamStatus.broker_statuses].sort((first, second) => {
        return Number(second.action_required) - Number(first.action_required);
    });

    return (
        <PanelSection label="Stream readiness">
            <div className="grid gap-3">
                <div className="grid grid-cols-3 gap-2">
                    <div className="min-w-0">
                        <div className="type-meta">Redis</div>
                        <Badge
                            className="mt-1.5"
                            size="sm"
                            variant={streamStatus.redis_ok ? "success" : "error"}
                        >
                            {streamStatus.redis_ok ? "Healthy" : "Degraded"}
                        </Badge>
                    </div>
                    <div className="min-w-0">
                        <div className="type-meta">Desired symbols</div>
                        <p className={cn(typography.h4, "mt-1.5")}>{streamStatus.desired_subscriptions.length}</p>
                    </div>
                    <div className="min-w-0">
                        <div className="type-meta">Worker sessions</div>
                        <p className={cn(typography.h4, "mt-1.5")}>{streamStatus.active_sessions.length}</p>
                    </div>
                </div>
                {sortedBrokers.slice(0, 3).map((broker) => (
                    <div
                        className="min-w-0 rounded-lg border border-border bg-background p-3"
                        key={`${broker.broker_code}-${broker.account_id}`}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="type-label truncate">{broker.label}</div>
                                <div className="type-meta mt-0.5">
                                    {broker.broker_code} · {broker.desired_symbol_count} symbols
                                </div>
                            </div>
                            <span
                                className={cn(
                                    "shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium",
                                    brokerBadgeClasses(brokerTone(broker))
                                )}
                            >
                                {broker.action_required ? "Action" : broker.session_active ? "Session" : "Paused"}
                            </span>
                        </div>
                    </div>
                ))}
                <Link
                    className={cn(typography.muted, "inline-flex items-center gap-1 text-xs hover:text-foreground hover:underline")}
                    href="/settings#stream-manager"
                >
                    View stream diagnostics
                    <IconArrowRight className="size-3" stroke={1.8} />
                </Link>
            </div>
        </PanelSection>
    );
}

function QuickActionsPanel({ enabledChannels }: { enabledChannels: number }) {
    return (
        <PanelSection label="Quick actions">
            <div className="grid gap-2">
                <Link
                    className={cn(typography.small, "flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:bg-muted/50")}
                    href="/alerts-workspace/workflows/new"
                >
                    <IconBolt className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
                    <span className="truncate">Create workflow</span>
                </Link>
                <Link
                    className={cn(typography.small, "flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:bg-muted/50")}
                    href="/alerts-workspace/templates"
                >
                    <IconChecklist className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
                    <span className="truncate">Browse templates</span>
                </Link>
                {enabledChannels === 0 ? (
                    <Link
                        className={cn(typography.small, "flex min-w-0 items-center gap-1 px-3 py-1 text-muted-foreground hover:text-foreground hover:underline")}
                        href="/settings#alert-channels"
                    >
                        Set up delivery channels
                        <IconArrowRight className="size-3" stroke={1.8} />
                    </Link>
                ) : null}
            </div>
        </PanelSection>
    );
}

function WorkflowCoverage({ workflows, runs }: { workflows: AlertWorkflow[]; runs: AlertWorkflowRun[] }) {
    return (
        <section className="min-w-0">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <p className="type-step-eyebrow">Active workflows</p>
                <Link
                    className={cn(typography.small, "text-muted-foreground hover:text-foreground hover:underline")}
                    href="/alerts-workspace/workflows"
                >
                    Manage all
                </Link>
            </div>
            <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-2 min-[1500px]:grid-cols-3">
                {workflows.slice(0, 4).map((workflow) => {
                    const latestRun = latestRunForWorkflow(runs, workflow.id);
                    return (
                        <Link
                            className="group min-w-0 rounded-lg border border-border bg-card p-3 transition-colors duration-100 hover:border-foreground/20"
                            href={`/alerts-workspace/workflows/${workflow.id}`}
                            key={workflow.id}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="type-section-title truncate text-base">{workflow.name}</div>
                                    <div className="type-meta mt-1">
                                        {workflow.workflow_dsl.workflow_type.replace("_", " ")}
                                    </div>
                                </div>
                                <Badge
                                    size="sm"
                                    variant={workflow.last_runtime_error ? "error" : "success"}
                                >
                                    {workflow.last_runtime_error ? "Issue" : workflow.status}
                                </Badge>
                            </div>
                            <div className="mt-4 grid gap-2">
                                <div className="flex min-w-0 justify-between gap-3">
                                    <span className="type-meta">Target</span>
                                    <span className="type-label min-w-0 truncate text-right">
                                        {targetSummary(workflow)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 justify-between gap-3">
                                    <span className="type-meta">Trigger</span>
                                    <span className="type-label min-w-0 truncate text-right">
                                        {triggerSummary(workflow)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 justify-between gap-3">
                                    <span className="type-meta">Channels</span>
                                    <span className="type-label min-w-0 truncate text-right">
                                        {channelSummary(workflow)}
                                    </span>
                                </div>
                            </div>
                            <div className="type-meta mt-4 border-t border-border pt-3">
                                Last run:{" "}
                                {latestRun
                                    ? formatDateTime(latestRun.created_at)
                                    : formatDateTime(workflow.last_triggered_at)}
                            </div>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}

function buildSetupSteps({
    hasBroker,
    hasActiveWorkflows,
    enabledChannels
}: {
    hasBroker: boolean;
    hasActiveWorkflows: boolean;
    enabledChannels: number;
}): SetupStep[] {
    return [
        {
            title: "Connect broker account",
            description: "Link a broker stream so workflows can evaluate live market data.",
            href: "/broker-connections",
            cta: "Connect broker",
            status: hasBroker ? "complete" : "incomplete-amber"
        },
        {
            title: "Create your first workflow",
            description: "Define rules that watch symbols and trigger when conditions match.",
            href: "/alerts-workspace/workflows/new",
            cta: "Create workflow",
            status: hasActiveWorkflows ? "complete" : "incomplete"
        },
        {
            title: "Set up delivery channels",
            description: "Configure where alerts are sent — in-app, email, or webhook.",
            href: "/settings#alert-channels",
            cta: "Configure channels",
            status: enabledChannels > 0 ? "complete" : "incomplete"
        }
    ];
}

async function AlertsOverviewContent() {
    const [activeWorkflows, inactiveWorkflows, unread, streamStatus, notifications, runs, channels] = await Promise.all(
        [
            getAlertWorkflows("active"),
            getAlertWorkflows("inactive"),
            getAlertUnreadCount(),
            getLiveStreamsStatus(),
            getAlertNotifications({ limit: 24 }),
            getAlertHistory(36),
            getAlertChannels()
        ]
    );

    const matchedRuns = runs.filter((run) => run.matched).length;
    const enabledChannels = enabledChannelCount(channels);
    const hasBroker = streamStatus.broker_statuses.length > 0;
    const hasActiveWorkflows = activeWorkflows.length > 0;
    const streamTone: Tone = streamStatus.redis_ok ? "good" : "danger";
    const runtimeIssues = activeWorkflows.filter((workflow) => workflow.last_runtime_error).length;
    const setupSteps = buildSetupSteps({ hasBroker, hasActiveWorkflows, enabledChannels });

    return (
        <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
            <div className="min-w-0 space-y-5 lg:pr-6">
                <div className="grid min-w-0 gap-3 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-4">
                    <StatCard
                        label="Stream health"
                        statusDot={streamTone}
                        subtext={`${streamStatus.desired_subscriptions.length} symbols · ${streamStatus.active_sessions.length} sessions`}
                        value={streamStatus.redis_ok ? "Ready" : "Check"}
                    />
                    <StatCard
                        label="Active workflows"
                        statusDot={hasActiveWorkflows ? "good" : "warn"}
                        subtext={`${inactiveWorkflows.length} inactive · ${runtimeIssues} runtime issues`}
                        value={String(activeWorkflows.length)}
                    />
                    <StatCard
                        label="Match rate"
                        statusDot={matchedRuns ? "good" : "muted"}
                        subtext={`${matchedRuns} matched · ${runs.length - matchedRuns} no match`}
                        value={percent(matchedRuns, runs.length)}
                    />
                    <StatCard
                        label="Alert inbox"
                        statusDot={unread.unread_count ? "warn" : "good"}
                        subtext={`${notifications.length} recent · ${enabledChannels} channel${enabledChannels === 1 ? "" : "s"}`}
                        value={String(unread.unread_count)}
                    />
                </div>

                {!hasBroker ? <BrokerBanner /> : null}

                {!hasActiveWorkflows ? (
                    <SetupChecklist steps={setupSteps} />
                ) : (
                    <WorkflowCoverage runs={runs} workflows={activeWorkflows} />
                )}

                <AlertHistoryList notifications={notifications} runs={runs} />
            </div>

            <aside className="mt-6 min-w-0 space-y-5 border-border pt-6 lg:mt-0 lg:max-w-[300px] lg:border-l lg:pl-6 lg:pt-0">
                <AttentionPanel hasActiveWorkflows={hasActiveWorkflows} unreadCount={unread.unread_count} />
                <StreamReadinessPanel streamStatus={streamStatus} />
                <QuickActionsPanel enabledChannels={enabledChannels} />
            </aside>
        </div>
    );
}

function OverviewFallback() {
    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
                <StatGridSkeleton count={4} />
                <FeedSkeleton rows={4} />
                <FeedSkeleton rows={6} />
            </div>
            <FeedSkeleton rows={8} />
        </div>
    );
}

export default function AlertsOverviewPage() {
    return (
        <Suspense fallback={<OverviewFallback />}>
            <AlertsOverviewContent />
        </Suspense>
    );
}
