import { AlertsHeaderOverride } from "@/components/alerts/alerts-workspace-chrome";
import { ExecutionHistory } from "@/components/alerts/execution-history";
import { WorkflowEditor } from "@/components/alerts/workflow-editor";
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
 <div className="grid gap-8">
 <AlertsHeaderOverride title={workflow.name} />
 <WorkflowEditor accounts={accounts} initialWorkflow={workflow} llmProviders={systemConfig.llm_providers} presets={presets} watchlists={watchlists} />
 <ExecutionHistory runs={runs} />
 </div>
 );
}
