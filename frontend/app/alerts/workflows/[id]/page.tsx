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
    getAlertWorkflowRuns(id)
  ]);

  return (
    <Shell>
      <PageHeader
        eyebrow="Alerts workspace"
        title={workflow.name}
        description="Edit workflow targeting, conditions, notification channels, and inspect recent execution history."
      />
      <AlertsNav />
      <div className="grid gap-8">
        <WorkflowEditor accounts={accounts} initialWorkflow={workflow} />
        <section className="grid gap-3">
          <div className="text-sm font-bold">Recent runs</div>
          {runs.map((run) => (
            <div className="rounded-lg border border-border p-4" key={run.id}>
              <div className="text-sm font-bold">{run.rendered_title || run.reason}</div>
              <div className="mt-1 text-xs text-muted-foreground">{run.rendered_message || run.reason}</div>
            </div>
          ))}
          {!runs.length ? <div className="text-sm text-muted-foreground">No runs yet.</div> : null}
        </section>
      </div>
    </Shell>
  );
}
