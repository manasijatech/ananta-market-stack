import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { AlertsHeaderOverride } from "@/components/alerts/alerts-workspace-chrome";
import { ExecutionHistory } from "@/components/alerts/execution-history";
import { WorkflowEditor } from "@/components/alerts/workflow-editor";
import { WorkflowLlmUsagePanel } from "@/components/llm-usage/workflow-llm-usage-panel";
import { getAlertPresets, getAlertWorkflow, getAlertWorkflowRuns } from "@/service/actions/alerts";
import { getAlphaAnnouncementCategories } from "@/service/actions/alpha/announcements";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getOpenRouterModels } from "@/service/actions/llm-models";
import { getWorkflowLlmUsageSummary } from "@/service/actions/llm-usage";
import { getWatchlists } from "@/service/actions/watchlist";
import { getAlphaCreditWarningMessage } from "@/lib/alpha-credit-warning";

type WorkflowDetailPageProps = {
    params: Promise<{ id: string }>;
};

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
    const { id } = await params;
    let creditWarningMessage: string | null = null;
    const [accounts, workflow, runs, llmUsage, watchlists, presets, systemConfig, announcementCategories, openRouterModels] =
        await Promise.all([
            getBrokerAccounts(),
            getAlertWorkflow(id),
            getAlertWorkflowRuns(id, 100),
            getWorkflowLlmUsageSummary(id),
            getWatchlists(),
            getAlertPresets(),
            getSystemConfig(),
            getAlphaAnnouncementCategories().catch((caught) => {
                creditWarningMessage = getAlphaCreditWarningMessage(caught);
                return [];
            }),
            getOpenRouterModels()
        ]);

    return (
        <div className="grid gap-8">
            <AlphaCreditWarningTrigger message={creditWarningMessage} />
            <AlertsHeaderOverride title={workflow.name} />
            <WorkflowEditor
                accounts={accounts}
                announcementCategories={announcementCategories}
                initialWorkflow={workflow}
                llmProviders={systemConfig.llm_providers}
                openRouterModels={openRouterModels}
                presets={presets}
                watchlists={watchlists}
            />
            <WorkflowLlmUsagePanel summary={llmUsage} />
            <ExecutionHistory runs={runs} />
        </div>
    );
}
