import { Suspense } from "react";
import Link from "next/link";
import { AlertHistoryList } from "@/components/alerts/alert-history-list";
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
    <div className="mb-8 flex flex-wrap gap-3">
      <Link className="type-label border border-border px-3 py-2 hover:text-foreground" href="/alerts/workflows">
        Manage workflows
      </Link>
      <Link className="type-label border border-border px-3 py-2 hover:text-foreground" href="/alerts/templates">
        Browse templates
      </Link>
      <Link className="type-label border border-border px-3 py-2 hover:text-foreground" href="/alerts/subscriptions">
        Manage subscriptions
      </Link>
      <Link className="type-label border border-border px-3 py-2 hover:text-foreground" href="/alerts/stream-manager">
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
        <div className="type-step-eyebrow">Active</div>
        <div className="mt-2 text-3xl font-bold">{activeWorkflows.length}</div>
      </div>
      <div className="border border-border p-4">
        <div className="type-step-eyebrow">Inactive</div>
        <div className="mt-2 text-3xl font-bold">{inactiveWorkflows.length}</div>
      </div>
      <div className="border border-border p-4">
        <div className="type-step-eyebrow">Unread alerts</div>
        <div className="mt-2 text-3xl font-bold">{unread.unread_count}</div>
      </div>
      <div className="border border-border p-4">
        <div className="type-step-eyebrow">Redis / stream</div>
        <div className="type-section-title mt-2">
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
        <div className="type-section-title">Recent alerts</div>
        <FeedSkeleton rows={5} />
      </section>
      <section className="grid gap-3">
        <div className="type-section-title">Recent workflow runs</div>
        <FeedSkeleton rows={4} />
      </section>
    </div>
  );
}

export default function AlertsOverviewPage() {
  return (
    <>
      <Suspense fallback={<StatGridSkeleton />}>
        <AlertsOverviewStats />
      </Suspense>
      <QuickLinks />
      <Suspense fallback={<HistoryFallback />}>
        <AlertsOverviewHistory />
      </Suspense>
    </>
  );
}
