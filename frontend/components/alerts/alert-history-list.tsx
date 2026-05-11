import type { AlertNotification, AlertWorkflowRun } from "@/service/types/alerts";

export function AlertHistoryList({
  notifications,
  runs
}: {
  notifications: AlertNotification[];
  runs: AlertWorkflowRun[];
}) {
  return (
    <div className="grid gap-6 min-[1100px]:grid-cols-2">
      <section className="grid gap-3">
        <div className="text-sm font-bold">Recent alerts</div>
        {notifications.map((item) => (
          <div className="rounded-lg border border-border p-4" key={item.id}>
            <div className="text-sm font-bold">{item.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.message}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {item.symbol ?? "-"} · {item.level} · {item.channels.join(", ") || "in_app"}
            </div>
          </div>
        ))}
        {!notifications.length ? <div className="text-sm text-muted-foreground">No alert notifications yet.</div> : null}
      </section>
      <section className="grid gap-3">
        <div className="text-sm font-bold">Recent workflow runs</div>
        {runs.map((item) => (
          <div className="rounded-lg border border-border p-4" key={item.id}>
            <div className="text-sm font-bold">{item.rendered_title || item.reason}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.rendered_message || item.reason}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {item.matched ? "Matched" : "No match"} · {item.channels.join(", ") || "in_app"}
            </div>
          </div>
        ))}
        {!runs.length ? <div className="text-sm text-muted-foreground">No workflow runs yet.</div> : null}
      </section>
    </div>
  );
}
