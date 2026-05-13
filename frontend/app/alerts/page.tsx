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

export default async function AlertsOverviewPage() {
 const [activeWorkflows, inactiveWorkflows, unread, notifications, runs, streamStatus] = await Promise.all([
 getAlertWorkflows("active"),
 getAlertWorkflows("inactive"),
 getAlertUnreadCount(),
 getAlertNotifications({ limit: 100 }),
 getAlertHistory(100),
 getLiveStreamsStatus()
 ]);

 return (
 <Shell>
 <PageHeader
 eyebrow="Alerts workspace"
 title="Trading workflows"
 description="Create, run, and review live market workflows, user alerts, and outbound channels from one workspace."
 action={<PrimaryLink href="/alerts/workflows/new">+ New workflow</PrimaryLink>}
 />
 <AlertsNav />

 <section className="mb-8 grid gap-4 min-[960px]:grid-cols-4">
 <div className=" border border-border p-4">
 <div className="text-xs font-bold uppercase text-muted-foreground">Active</div>
 <div className="mt-2 text-3xl font-bold">{activeWorkflows.length}</div>
 </div>
 <div className=" border border-border p-4">
 <div className="text-xs font-bold uppercase text-muted-foreground">Inactive</div>
 <div className="mt-2 text-3xl font-bold">{inactiveWorkflows.length}</div>
 </div>
 <div className=" border border-border p-4">
 <div className="text-xs font-bold uppercase text-muted-foreground">Unread alerts</div>
 <div className="mt-2 text-3xl font-bold">{unread.unread_count}</div>
 </div>
 <div className=" border border-border p-4">
 <div className="text-xs font-bold uppercase text-muted-foreground">Redis / stream</div>
 <div className="mt-2 text-sm font-bold">
 {streamStatus.redis_ok ? "Healthy" : "Degraded"} · {streamStatus.desired_subscriptions.length} symbols
 </div>
 </div>
 </section>

 <div className="mb-8 flex flex-wrap gap-3 text-sm font-semibold">
 <Link className=" border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/workflows">
 Manage workflows
 </Link>
 <Link className=" border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/templates">
 Browse templates
 </Link>
 <Link className=" border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/subscriptions">
 Manage subscriptions
 </Link>
 <Link className=" border border-border px-3 py-1.5 hover:text-foreground" href="/alerts/stream-manager">
 Open stream manager
 </Link>
 </div>

 <AlertHistoryList notifications={notifications} runs={runs} />
 </Shell>
 );
}
