import { Suspense } from "react";
import Link from "next/link";
import {
  IconAlertTriangle,
  IconBellRinging,
  IconBolt,
  IconChartBar,
  IconChecklist,
  IconCircleCheck,
  IconPlayerPlay,
  IconPlugConnected,
  IconRoute,
  IconSettings2
} from "@tabler/icons-react";
import { AlertHistoryList } from "@/components/alerts/alert-history-list";
import { Button } from "@/components/ui/button";
import { FeedSkeleton, StatGridSkeleton } from "@/components/ui/loading-skeletons";
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
  AlertNotification,
  AlertWorkflow,
  AlertWorkflowRun,
  LiveBrokerAccountStatus,
  LiveStreamsStatus
} from "@/service/types/alerts";

export const dynamic = "force-dynamic";

type Tone = "good" | "warn" | "danger" | "muted";

function toneClasses(tone: Tone) {
  if (tone === "good") return "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]";
  if (tone === "danger") return "border-[var(--danger)] bg-[var(--danger-subtle)] text-[var(--danger)]";
  if (tone === "warn") return "border-primary bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]";
  return "border-border bg-secondary text-muted-foreground";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function targetSummary(workflow: AlertWorkflow) {
  const targeting = workflow.workflow_dsl.targeting;
  const ast = workflow.workflow_dsl.workflow_ast as Record<string, unknown> | null | undefined;
  const targetUniverse = ast && typeof ast.target_universe === "object" && ast.target_universe !== null
    ? ast.target_universe as Record<string, unknown>
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
  return [entry?.symbol || workflow.symbol || "No target", entry?.exchange || workflow.exchange].filter(Boolean).join(" · ");
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

function buildAttentionItems({
  activeWorkflows,
  inactiveWorkflows,
  unreadCount,
  streamStatus
}: {
  activeWorkflows: AlertWorkflow[];
  inactiveWorkflows: AlertWorkflow[];
  unreadCount: number;
  streamStatus: LiveStreamsStatus;
}) {
  const allWorkflows = [...activeWorkflows, ...inactiveWorkflows];
  const brokenWorkflows = allWorkflows.filter((workflow) => workflow.last_runtime_error || workflow.deployment_status === "error");
  const actionBrokers = streamStatus.broker_statuses.filter((broker) => broker.action_required || broker.last_error);
  const items: Array<{ title: string; detail: string; href: string; label: string; tone: Tone }> = [];

  if (!streamStatus.redis_ok) {
    items.push({
      title: "Stream cache degraded",
      detail: streamStatus.redis_error || "Redis is not reporting healthy.",
      href: "/alerts-workspace/stream-manager",
      label: "Inspect stream",
      tone: "danger"
    });
  }

  if (actionBrokers.length) {
    items.push({
      title: `${actionBrokers.length} broker ${actionBrokers.length === 1 ? "session" : "sessions"} need attention`,
      detail: actionBrokers.slice(0, 2).map((broker) => broker.label).join(", "),
      href: "/broker-connections",
      label: "Fix sessions",
      tone: "danger"
    });
  }

  if (brokenWorkflows.length) {
    items.push({
      title: `${brokenWorkflows.length} workflow ${brokenWorkflows.length === 1 ? "has" : "have"} runtime issues`,
      detail: brokenWorkflows[0]?.last_runtime_error || "Open workflow details to review the latest failure.",
      href: "/alerts-workspace/workflows",
      label: "Review",
      tone: "warn"
    });
  }

  if (unreadCount > 0) {
    items.push({
      title: `${unreadCount} unread alert ${unreadCount === 1 ? "notification" : "notifications"}`,
      detail: "Recent notifications are waiting in the alert inbox.",
      href: "/alerts-workspace",
      label: "Read alerts",
      tone: "warn"
    });
  }

  if (!activeWorkflows.length) {
    items.push({
      title: "No active workflows",
      detail: inactiveWorkflows.length ? "Activate a saved workflow or create a new live rule." : "Start with a template or build your first market workflow.",
      href: inactiveWorkflows.length ? "/alerts-workspace/workflows?status=inactive" : "/alerts-workspace/templates",
      label: inactiveWorkflows.length ? "Activate" : "Use template",
      tone: "muted"
    });
  }

  return items.slice(0, 4);
}

function MetricTile({
  eyebrow,
  value,
  detail,
  tone = "muted",
  icon: Icon
}: {
  eyebrow: string;
  value: string;
  detail: string;
  tone?: Tone;
  icon: typeof IconBolt;
}) {
  return (
    <div className="min-w-0 border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="type-step-eyebrow">{eyebrow}</div>
          <div className="mt-2 truncate text-2xl font-semibold leading-none">{value}</div>
        </div>
        <span className={`flex size-8 shrink-0 items-center justify-center border ${toneClasses(tone)}`}>
          <Icon className="size-4" stroke={1.8} />
        </span>
      </div>
      <div className="type-meta mt-3 line-clamp-2">{detail}</div>
    </div>
  );
}

function AttentionPanel({ items }: { items: ReturnType<typeof buildAttentionItems> }) {
  return (
    <section className="min-w-0 border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="type-step-eyebrow">Attention</p>
          <h2 className="type-section-title mt-1">What needs a look</h2>
        </div>
        <IconAlertTriangle className="size-5 text-primary" stroke={1.8} />
      </div>
      <div className="mt-4 grid gap-3">
        {items.length ? items.map((item) => (
          <div className="border border-border bg-background p-3" key={`${item.title}-${item.href}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="type-label">{item.title}</div>
                <div className="type-meta mt-1 line-clamp-2">{item.detail}</div>
              </div>
              <span className={`mt-0.5 size-2 shrink-0 border ${toneClasses(item.tone)}`} aria-hidden="true" />
            </div>
            <Link className="type-meta mt-3 inline-block font-semibold uppercase tracking-[0.12em] text-primary hover:text-foreground" href={item.href}>
              {item.label}
            </Link>
          </div>
        )) : (
          <div className="border border-[var(--success)] bg-[var(--success-subtle)] p-4">
            <div className="flex items-center gap-3">
              <IconCircleCheck className="size-5 text-[var(--success)]" stroke={1.8} />
              <div>
                <div className="type-label text-[var(--success)]">Workspace is clear</div>
                <div className="type-meta mt-1 text-[var(--success)]">No stream, workflow, or inbox issues in the current snapshot.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function CommandCenter({
  activeWorkflows,
  inactiveWorkflows,
  runs,
  notifications,
  unreadCount,
  streamStatus,
  channels
}: {
  activeWorkflows: AlertWorkflow[];
  inactiveWorkflows: AlertWorkflow[];
  runs: AlertWorkflowRun[];
  notifications: AlertNotification[];
  unreadCount: number;
  streamStatus: LiveStreamsStatus;
  channels: AlertChannel[];
}) {
  const matchedRuns = runs.filter((run) => run.matched).length;
  const streamTone: Tone = streamStatus.redis_ok ? "good" : "danger";
  const attentionItems = buildAttentionItems({ activeWorkflows, inactiveWorkflows, unreadCount, streamStatus });
  const enabledChannels = enabledChannelCount(channels);

  return (
    <div className="mb-6 grid min-w-0 gap-4 min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <section className="min-w-0 border border-border bg-card p-4 min-[760px]:p-5">
        <div className="flex flex-col justify-between gap-4 min-[900px]:flex-row">
          <div className="min-w-0 max-w-3xl">
            <p className="type-step-eyebrow">Operational status</p>
            <h2 className="mt-2 text-[clamp(22px,2.4vw,30px)] font-semibold leading-tight">
              {activeWorkflows.length ? `${activeWorkflows.length} live workflow${activeWorkflows.length === 1 ? "" : "s"} watching the market.` : "No live workflows yet."}
            </h2>
            <p className="type-help mt-2 max-w-2xl text-muted-foreground">
              {runs.length
                ? `${matchedRuns} of the last ${runs.length} evaluations matched. ${notifications.length} recent notifications are available for review.`
                : "Create or activate a workflow to start seeing evaluation and alert history here."}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2 min-[900px]:justify-end">
            <Button asChild className="min-h-9 whitespace-nowrap">
              <Link href="/alerts-workspace/workflows/new">
                <IconBolt className="size-4" stroke={1.8} />
                New workflow
              </Link>
            </Button>
            <Button asChild className="min-h-9 whitespace-nowrap" variant="outline">
              <Link href="/alerts-workspace/stream-manager">
                <IconPlugConnected className="size-4" stroke={1.8} />
                Stream manager
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-5 grid min-w-0 gap-3 min-[760px]:grid-cols-2 min-[1360px]:grid-cols-4">
          <MetricTile
            detail={`${inactiveWorkflows.length} inactive · ${activeWorkflows.filter((workflow) => workflow.last_runtime_error).length} runtime issues`}
            eyebrow="Workflows"
            icon={IconPlayerPlay}
            tone={activeWorkflows.length ? "good" : "warn"}
            value={String(activeWorkflows.length)}
          />
          <MetricTile
            detail={`${matchedRuns} matched · ${runs.length - matchedRuns} did not match in the loaded run history`}
            eyebrow="Match rate"
            icon={IconChartBar}
            tone={matchedRuns ? "good" : "muted"}
            value={percent(matchedRuns, runs.length)}
          />
          <MetricTile
            detail={`${notifications.length} recent alerts · ${enabledChannels} outbound channel${enabledChannels === 1 ? "" : "s"} enabled`}
            eyebrow="Alert inbox"
            icon={IconBellRinging}
            tone={unreadCount ? "warn" : "good"}
            value={String(unreadCount)}
          />
          <MetricTile
            detail={`${streamStatus.desired_subscriptions.length} desired symbols · ${streamStatus.active_sessions.length} active stream sessions`}
            eyebrow="Stream health"
            icon={IconRoute}
            tone={streamTone}
            value={streamStatus.redis_ok ? "Ready" : "Check"}
          />
        </div>
      </section>
      <AttentionPanel items={attentionItems} />
    </div>
  );
}

function WorkflowCoverage({
  workflows,
  runs
}: {
  workflows: AlertWorkflow[];
  runs: AlertWorkflowRun[];
}) {
  return (
    <section className="min-w-0 border-y border-border py-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="type-step-eyebrow">Coverage</p>
          <h2 className="type-section-title mt-1">Active workflows</h2>
        </div>
        <Link className="type-meta font-semibold uppercase tracking-[0.12em] text-primary hover:text-foreground" href="/alerts-workspace/workflows">
          Manage all
        </Link>
      </div>
      {workflows.length ? (
        <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-2 min-[1500px]:grid-cols-3 min-[1800px]:grid-cols-4">
          {workflows.slice(0, 4).map((workflow) => {
            const latestRun = latestRunForWorkflow(runs, workflow.id);
            return (
              <Link className="group min-w-0 border border-border bg-card p-3 transition-colors duration-100 hover:border-primary/70" href={`/alerts-workspace/workflows/${workflow.id}`} key={workflow.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="type-section-title truncate">{workflow.name}</div>
                    <div className="type-meta mt-1 uppercase tracking-[0.12em] text-primary">{workflow.workflow_dsl.workflow_type.replace("_", " ")}</div>
                  </div>
                  <span className={`border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${toneClasses(workflow.last_runtime_error ? "danger" : "good")}`}>
                    {workflow.last_runtime_error ? "issue" : workflow.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="text-muted-foreground">Target</span>
                    <span className="min-w-0 truncate text-right font-semibold">{targetSummary(workflow)}</span>
                  </div>
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="text-muted-foreground">Trigger</span>
                    <span className="min-w-0 truncate text-right font-semibold">{triggerSummary(workflow)}</span>
                  </div>
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="text-muted-foreground">Channels</span>
                    <span className="min-w-0 truncate text-right font-semibold">{channelSummary(workflow)}</span>
                  </div>
                </div>
                <div className="type-meta mt-4 border-t border-border pt-3">
                  Last run: {latestRun ? formatDateTime(latestRun.created_at) : formatDateTime(workflow.last_triggered_at)}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="border border-border bg-card p-5">
          <div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
            <div>
              <h3 className="type-section-title">Start monitoring with a workflow</h3>
              <p className="type-help mt-1">Templates give you a faster first rule; custom workflows are better when the trigger logic is already clear.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/alerts-workspace/templates">Browse templates</Link>
              </Button>
              <Button asChild>
                <Link href="/alerts-workspace/workflows/new">Create workflow</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StreamReadiness({ streamStatus }: { streamStatus: LiveStreamsStatus }) {
  const sortedBrokers = [...streamStatus.broker_statuses].sort((first, second) => {
    return Number(second.action_required) - Number(first.action_required);
  });

  return (
    <section className="min-w-0 border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="type-step-eyebrow">Live data</p>
          <h2 className="type-section-title mt-1">Stream readiness</h2>
        </div>
        <Link className="type-meta font-semibold uppercase tracking-[0.12em] text-primary hover:text-foreground" href="/alerts-workspace/stream-manager">
          Details
        </Link>
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-2">
          <div className="min-w-0 border border-border bg-background p-3">
            <div className="type-step-eyebrow">Redis</div>
            <div className={`mt-2 inline-flex border px-2.5 py-1 text-sm font-semibold ${toneClasses(streamStatus.redis_ok ? "good" : "danger")}`}>
              {streamStatus.redis_ok ? "Healthy" : "Degraded"}
            </div>
          </div>
          <div className="min-w-0 border border-border bg-background p-3">
            <div className="type-step-eyebrow">Desired symbols</div>
            <div className="mt-2 text-2xl font-semibold">{streamStatus.desired_subscriptions.length}</div>
          </div>
          <div className="min-w-0 border border-border bg-background p-3">
            <div className="type-step-eyebrow">Worker sessions</div>
            <div className="mt-2 text-2xl font-semibold">{streamStatus.active_sessions.length}</div>
          </div>
        </div>
        <div className="grid gap-2">
          {sortedBrokers.slice(0, 4).map((broker) => (
            <div className="min-w-0 border border-border bg-background p-3" key={`${broker.broker_code}-${broker.account_id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="type-label truncate">{broker.label}</div>
                  <div className="type-meta mt-1">{broker.broker_code} · {broker.desired_symbol_count} desired symbols</div>
                </div>
                <span className={`shrink-0 border px-2 py-1 text-center font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${toneClasses(brokerTone(broker))}`}>
                  {broker.action_required ? "action" : broker.session_active ? "session" : "paused"}
                </span>
              </div>
              <div className="type-meta mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <span>{broker.can_stream ? "Can stream" : "No stream"}</span>
                <span>{broker.active_worker_sessions} workers</span>
              </div>
            </div>
          ))}
          {!sortedBrokers.length ? (
            <div className="border border-border bg-background p-4">
              <div className="type-label">No broker stream accounts yet</div>
              <div className="type-help mt-1">Connect a broker account before relying on live market-data workflows.</div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ActionRail() {
  const actions = [
    { href: "/alerts-workspace/workflows/new", label: "Create workflow", icon: IconBolt },
    { href: "/alerts-workspace/templates", label: "Browse templates", icon: IconChecklist },
    { href: "/alerts-workspace/subscriptions", label: "Subscriptions", icon: IconRoute },
    { href: "/alert-channels", label: "Channels", icon: IconSettings2 }
  ];

  return (
    <section className="min-w-0 border border-border bg-card p-4">
      <p className="type-step-eyebrow">Shortcuts</p>
      <div className="mt-3 grid gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link className="flex min-w-0 items-center gap-3 border border-border bg-background px-3 py-3 font-semibold transition-colors duration-100 hover:border-primary/70 hover:text-primary" href={action.href} key={action.href}>
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="size-4" stroke={1.8} />
                <span className="truncate">{action.label}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

async function AlertsOverviewContent() {
  const [activeWorkflows, inactiveWorkflows, unread, streamStatus, notifications, runs, channels] = await Promise.all([
    getAlertWorkflows("active"),
    getAlertWorkflows("inactive"),
    getAlertUnreadCount(),
    getLiveStreamsStatus(),
    getAlertNotifications({ limit: 24 }),
    getAlertHistory(36),
    getAlertChannels()
  ]);

  return (
    <>
      <CommandCenter
        activeWorkflows={activeWorkflows}
        channels={channels}
        inactiveWorkflows={inactiveWorkflows}
        notifications={notifications}
        runs={runs}
        streamStatus={streamStatus}
        unreadCount={unread.unread_count}
      />
      <div className="grid min-w-0 gap-5 min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
        <div className="grid min-w-0 gap-5">
          <WorkflowCoverage workflows={activeWorkflows} runs={runs} />
          <AlertHistoryList notifications={notifications} runs={runs} />
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <StreamReadiness streamStatus={streamStatus} />
          <ActionRail />
        </div>
      </div>
    </>
  );
}

function OverviewFallback() {
  return (
    <div className="grid gap-8">
      <StatGridSkeleton count={4} />
      <div className="grid min-w-0 gap-5 min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
        <div className="grid gap-6">
          <FeedSkeleton rows={4} />
          <FeedSkeleton rows={6} />
        </div>
        <FeedSkeleton rows={5} />
      </div>
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
