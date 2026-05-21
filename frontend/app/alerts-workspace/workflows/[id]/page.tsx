import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { AlertsHeaderOverride } from "@/components/alerts/alerts-workspace-chrome";
import { ExecutionHistory } from "@/components/alerts/execution-history";
import { WorkflowEditor } from "@/components/alerts/workflow-editor";
import { getAlertPresets, getAlertWorkflow, getAlertWorkflowRuns } from "@/service/actions/alerts";
import { getAlphaAnnouncementCategories } from "@/service/actions/alpha/announcements";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";
import { getAlphaCreditWarningMessage } from "@/lib/alpha-credit-warning";

type WorkflowDetailPageProps = {
    params: Promise<{ id: string }>;
};

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
    const { id } = await params;
    let creditWarningMessage: string | null = null;
    const [accounts, workflow, runs, watchlists, presets, systemConfig, announcementCategories] = await Promise.all([
        getBrokerAccounts(),
        getAlertWorkflow(id),
        getAlertWorkflowRuns(id, 100),
        getWatchlists(),
        getAlertPresets(),
        getSystemConfig(),
        getAlphaAnnouncementCategories().catch((caught) => {
            creditWarningMessage = getAlphaCreditWarningMessage(caught);
            return [];
        })
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
                presets={presets}
                watchlists={watchlists}
            />
            <ExecutionHistory runs={runs} />
        </div>
    );
}
