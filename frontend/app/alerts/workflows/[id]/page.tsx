import { AlertsNav } from "@/components/alerts/alerts-nav";
import { ExecutionHistory } from "@/components/alerts/execution-history";
import { WorkflowEditor } from "@/components/alerts/workflow-editor";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getAlertPresets, getAlertWorkflow, getAlertWorkflowRuns } from "@/service/actions/alerts";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";

type WorkflowDetailPageProps = {
 params: Promise<{ id: string }>;
};

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
 const { id } = await params;
 const [accounts, workflow, runs, watchlists, presets, systemConfig] = await Promise.all([
 getBrokerAccounts(),
 getAlertWorkflow(id),
 getAlertWorkflowRuns(id, 100),
 getWatchlists(),
 getAlertPresets(),
 getSystemConfig()
 ]);

 return (
 <Shell>
 <PageHeader
 eyebrow="Alerts workspace"
 title={workflow.name}
 description="Edit workflow target sets, conditions, notification channels, and inspect the latest live evaluation history."
 />
 <AlertsNav />
 <div className="grid gap-8">
 <WorkflowEditor accounts={accounts} initialWorkflow={workflow} llmProviders={systemConfig.llm_providers} presets={presets} watchlists={watchlists} />
 <ExecutionHistory runs={runs} />
 </div>
 </Shell>
 );
}
