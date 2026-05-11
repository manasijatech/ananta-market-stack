import { AlertsNav } from "@/components/alerts/alerts-nav";
import { ExecutionHistory } from "@/components/alerts/execution-history";
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
    getAlertWorkflowRuns(id, 100)
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
        <ExecutionHistory runs={runs} />
      </div>
    </Shell>
  );
}
