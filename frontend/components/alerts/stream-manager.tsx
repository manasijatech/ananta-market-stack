"use client";

import { useState, useTransition } from "react";
import { getLiveStreamsStatus } from "@/service/actions/alerts";
import type { LiveStreamsStatus } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";

export function StreamManager({ initialStatus }: { initialStatus: LiveStreamsStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      setStatus(await getLiveStreamsStatus());
    });
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div>
          <div className="text-sm font-bold">{status.worker_mode}</div>
          <div className="text-xs text-muted-foreground">
            Redis {status.redis_ok ? "connected" : "degraded"} {status.redis_error ? `· ${status.redis_error}` : ""}
          </div>
        </div>
        <Button disabled={isPending} onClick={refresh} type="button" variant="outline">
          Refresh
        </Button>
      </div>

      <section className="grid gap-3">
        <div className="text-sm font-bold">Worker sessions</div>
        {status.active_sessions.map((session) => (
          <div className="rounded-lg border border-border p-4" key={`${session.user_id}-${session.account_id}-${session.broker_code}-${session.connection_index}`}>
            <div className="text-sm font-bold">
              {session.broker_code} · {session.account_id} · Connection {session.connection_index}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {session.connected ? "Connected" : "Disconnected"} · {session.adapter} · {session.symbol_count}/{session.capacity} symbols
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Symbols: {session.symbols.join(", ") || "None"}
            </div>
          </div>
        ))}
        {!status.active_sessions.length ? <div className="text-sm text-muted-foreground">No active worker sessions yet.</div> : null}
      </section>

      <section className="grid gap-3">
        <div className="text-sm font-bold">Desired subscriptions</div>
        {status.desired_subscriptions.map((subscription) => (
          <div className="rounded-lg border border-border p-4" key={subscription.id}>
            <div className="text-sm font-bold">{subscription.symbol}</div>
            <div className="text-xs text-muted-foreground">
              {subscription.exchange ?? "-"} · {subscription.broker_code ?? "-"} · {subscription.status}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
