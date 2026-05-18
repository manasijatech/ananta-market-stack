"use client";

import { useState, useTransition } from "react";
import { getLiveStreamsStatus, reconcileLiveSubscriptions } from "@/service/actions/alerts";
import type { LiveStreamsStatus } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";

export function StreamManager({ initialStatus }: { initialStatus: LiveStreamsStatus }) {
 const [status, setStatus] = useState(initialStatus);
 const [reconcileNotice, setReconcileNotice] = useState("");
 const [isPending, startTransition] = useTransition();

 function refresh() {
 startTransition(async () => {
 setStatus(await getLiveStreamsStatus());
 });
 }

 function reconcile() {
 startTransition(async () => {
 const report = await reconcileLiveSubscriptions();
 setReconcileNotice(
 `Reconciled ${report.desired} desired subscriptions · created ${report.created} · restored ${report.restored} · deactivated ${report.deactivated}`
 );
 setStatus(await getLiveStreamsStatus());
 });
 }

 return (
 <div className="grid gap-6">
 <div className="flex flex-wrap items-center justify-between gap-3 border border-border p-4">
 <div>
 <div className="type-section-title">{status.worker_mode}</div>
 <div className="type-help text-muted-foreground">
 Redis {status.redis_ok ? "connected" : "degraded"} {status.redis_error ? `· ${status.redis_error}` : ""}
 </div>
 </div>
 <Button disabled={isPending} onClick={refresh} type="button" variant="outline">
 Refresh
 </Button>
 <Button disabled={isPending} onClick={reconcile} type="button" variant="outline">
 Reconcile
 </Button>
 </div>
{reconcileNotice ? <div className="type-body border border-border px-4 py-3 text-muted-foreground">{reconcileNotice}</div> : null}

 <section className="grid gap-3">
 <div className="type-section-title">Broker readiness</div>
 {status.broker_statuses.map((broker) => (
 <div className=" border border-border p-4" key={`${broker.account_id}-${broker.broker_code}`}>
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="type-section-title">
 {broker.label} · {broker.broker_code}
 </div>
 <div className="type-help mt-1 text-muted-foreground">
 {broker.session_active ? "Ready to stream" : "Action required"} · {broker.desired_symbol_count} desired symbols · {broker.active_worker_sessions} worker sessions
 </div>
 </div>
 <div className="type-meta text-muted-foreground">
 {broker.session_status ?? "pending"}
 {broker.automation_mode ? ` · ${broker.automation_mode}` : ""}
 </div>
 </div>
 <div className="type-help mt-3 text-muted-foreground">
 {broker.session_active
 ? "Stored broker session looks usable. Live workers can attach without re-verification from this status call."
 : broker.guidance || broker.last_error || "Broker verification or token refresh is still required before live data can attach."}
 </div>
 {broker.last_error && !broker.session_active ? (
 <div className="type-meta mt-2 text-[var(--danger)]">{broker.last_error}</div>
 ) : null}
 </div>
 ))}
 {!status.broker_statuses.length ? (
 <div className="type-body text-muted-foreground">
 No broker-linked subscriptions yet. Subscriptions can still exist before broker verification is completed.
 </div>
 ) : null}
 </section>

 <section className="grid gap-3">
 <div className="type-section-title">Worker sessions</div>
 {status.active_sessions.map((session) => (
 <div className=" border border-border p-4" key={`${session.user_id}-${session.account_id}-${session.broker_code}-${session.connection_index}`}>
 <div className="type-section-title">
 {session.broker_code} · {session.account_id} · Connection {session.connection_index}
 </div>
 <div className="type-help mt-1 text-muted-foreground">
 {session.connected ? "Connected" : "Disconnected"} · {session.adapter} · {session.symbol_count}/{session.capacity} symbols
 </div>
 <div className="type-meta mt-2 text-muted-foreground">
 Symbols: {session.symbols.join(", ") || "None"}
 </div>
 </div>
 ))}
{!status.active_sessions.length ? <div className="type-body text-muted-foreground">No active worker sessions yet.</div> : null}
 </section>

 <section className="grid gap-3">
 <div className="type-section-title">Desired subscriptions</div>
 {status.desired_subscriptions.map((subscription) => (
 <div className=" border border-border p-4" key={subscription.id}>
 <div className="type-section-title">{subscription.symbol}</div>
 <div className="type-meta text-muted-foreground">
 {subscription.exchange ?? "-"} · {subscription.broker_code ?? "-"} · {subscription.status} · {subscription.source_kind}
 </div>
 <div className="type-help mt-1 text-muted-foreground">
 {[subscription.source_type, subscription.source_label || subscription.source_id, subscription.owner_kind, subscription.health_status]
 .filter(Boolean)
 .join(" · ")}
 </div>
 {subscription.health_reason ? <div className="type-meta mt-1 text-[var(--danger)]">{subscription.health_reason}</div> : null}
 </div>
 ))}
 </section>
 </div>
 );
}
