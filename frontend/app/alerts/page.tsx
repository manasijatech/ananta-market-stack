import { Suspense } from "react";
import Link from "next/link";
import { AlertsNav } from "@/components/alerts/alerts-nav";
import { AlertHistoryList } from "@/components/alerts/alert-history-list";
import { PageHeader, PrimaryLink, Shell } from "@/components/brokers/ui";
import {
  getAlertHistory,
  getAlertNotifications,
  getAlertUnreadCount,
  getAlertWorkflows,
  getLiveStreamsStatus
} from "@/service/actions/alerts";
import { FeedSkeleton, StatGridSkeleton } from "@/components/ui/loading-skeletons";

export const dynamic = "force-dynamic";

function QuickLinks() {
  return (
    <div className="mb-8 flex flex-wrap gap-3 text-sm font-semibold">
      <Link className="border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/workflows">
        Manage workflows
      </Link>
      <Link className="border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/templates">
        Browse templates
      </Link>
      <Link className="border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/subscriptions">
        Manage subscriptions
      </Link>
      <Link className="border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/stream-manager">
        Open stream manager
      </Link>
    </div>
  );
}

async function AlertsOverviewStats() {
  const [activeWorkflows, inactiveWorkflows, unread, streamStatus] = await Promise.all([
    getAlertWorkflows("active"),
    getAlertWorkflows("inactive"),
    getAlertUnreadCount(),
    getLiveStreamsStatus()
  ]);

  return (
    <section className="mb-8 grid gap-4 min-[960px]:grid-cols-4">
      <div className="border border-border p-4">
        <div className="text-xs font-bold uppercase text-muted-foreground">Active</div>
        <div className="mt-2 text-3xl font-bold">{activeWorkflows.length}</div>
      </div>
      <div className="border border-border p-4">
        <div className="text-xs font-bold uppercase text-muted-foreground">Inactive</div>
        <div className="mt-2 text-3xl font-bold">{inactiveWorkflows.length}</div>
      </div>
      <div className="border border-border p-4">
        <div className="text-xs font-bold uppercase text-muted-foreground">Unread alerts</div>
        <div className="mt-2 text-3xl font-bold">{unread.unread_count}</div>
      </div>
      <div className="border border-border p-4">
        <div className="text-xs font-bold uppercase text-muted-foreground">Redis / stream</div>
        <div className="mt-2 text-sm font-bold">
          {streamStatus.redis_ok ? "Healthy" : "Degraded"} · {streamStatus.desired_subscriptions.length} symbols
        </div>
      </div>
    </section>
  );
}

async function AlertsOverviewHistory() {
  const [notifications, runs] = await Promise.all([
    getAlertNotifications({ limit: 24 }),
    getAlertHistory(24)
  ]);

  return <AlertHistoryList notifications={notifications} runs={runs} />;
}

function HistoryFallback() {
  return (
    <div className="grid gap-6 min-[1100px]:grid-cols-2">
      <section className="grid gap-3">
        <div className="text-sm font-bold">Recent alerts</div>
        <FeedSkeleton rows={5} />
      </section>
      <section className="grid gap-3">
        <div className="text-sm font-bold">Recent workflow runs</div>
        <FeedSkeleton rows={4} />
      </section>
    </div>
  );
}

export default function AlertsOverviewPage() {
  return (
    <Shell>
      <PageHeader
        eyebrow="Alerts workspace"
        title="Trading workflows"
        description="Create, run, and review live market workflows, user alerts, and outbound channels from one workspace."
        action={<PrimaryLink href="/alerts/workflows/new">+ New workflow</PrimaryLink>}
      />
      <AlertsNav />
      <Suspense fallback={<StatGridSkeleton />}>
        <AlertsOverviewStats />
      </Suspense>
      <QuickLinks />
      <Suspense fallback={<HistoryFallback />}>
        <AlertsOverviewHistory />
      </Suspense>
    </Shell>
  );
}
