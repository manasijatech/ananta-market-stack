import { AlertsNav } from "@/components/alerts/alerts-nav";
import { WorkflowEditor } from "@/components/alerts/workflow-editor";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getAlertWorkflow, getAlertWorkflowRuns } from "@/service/actions/alerts";
import { getBrokerAccounts } from "@/service/actions/broker";

type WorkflowDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
  const { id } = await params;
  const [accounts, workflow, runs] = await Promise.all([
    getBrokerAccounts(),
    getAlertWorkflow(id),
    getAlertWorkflowRuns(id, 10)
  ]);

  return (
    <Shell>
      <PageHeader
        eyebrow="Alerts workspace"
        title={workflow.name}
        description="Edit workflow targeting, conditions, notification channels, and inspect the latest live evaluation history."
      />
      <AlertsNav />
      <div className="grid gap-8">
        <WorkflowEditor accounts={accounts} initialWorkflow={workflow} />
        <section className="grid gap-3">
          <div className="text-sm font-bold">Recent execution history</div>
          <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
            {runs.map((run) => (
              <div className="rounded-lg border border-border p-4" key={run.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-bold">{run.rendered_title || run.reason}</div>
                  <div className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString()}</div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{run.rendered_message || run.reason}</div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>Matched: {run.matched ? "Yes" : "No"}</span>
                  <span>Reason: {run.reason || "-"}</span>
                  <span>Channels: {run.channels.join(", ") || "-"}</span>
                  <span>Notification: {run.notification_id ?? "-"}</span>
                </div>
                <pre className="mt-3 max-h-[140px] overflow-auto rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground">
                  {JSON.stringify(run.tick, null, 2)}
                </pre>
              </div>
            ))}
            {!runs.length ? <div className="text-sm text-muted-foreground">No runs yet.</div> : null}
          </div>
        </section>
      </div>
    </Shell>
  );
}
