import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { WorkflowEditor } from "@/components/alerts/workflow-editor";
import { getAlertPresets, getAlertTemplates } from "@/service/actions/alerts";
import { getAlphaAnnouncementCategories } from "@/service/actions/alpha/announcements";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getOpenRouterModels } from "@/service/actions/llm-models";
import { getWatchlists } from "@/service/actions/watchlist";
import { getAlphaCreditWarningMessage } from "@/lib/alpha-credit-warning";

type NewWorkflowPageProps = {
    searchParams?: Promise<{ template?: string }>;
};

export default async function NewWorkflowPage({ searchParams }: NewWorkflowPageProps) {
    const params = await searchParams;
    let creditWarningMessage: string | null = null;
    const [accounts, templates, watchlists, presets, systemConfig, announcementCategories, openRouterModels] =
        await Promise.all([
            getBrokerAccounts(),
            getAlertTemplates(),
            getWatchlists(),
            getAlertPresets(),
            getSystemConfig(),
            getAlphaAnnouncementCategories().catch((caught) => {
                creditWarningMessage = getAlphaCreditWarningMessage(caught);
                return [];
            }),
            getOpenRouterModels()
        ]);
    const template = templates.find((item) => item.id === params?.template);
    const initialWorkflow = template
        ? {
              id: "",
              user_id: "",
              template_id: template.id,
              account_id: null,
              broker_code: null,
              name: template.name,
              description: template.description,
              symbol: null,
              exchange: "NSE",
              instrument_ref: {},
              workflow_dsl: template.workflow_dsl,
              graph_dsl: template.graph_dsl,
              editor_mode: "rule" as const,
              status: "active" as const,
              channel_override: null,
              last_triggered_at: null,
              created_at: "",
              updated_at: ""
          }
        : null;

    return (
        <>
            <AlphaCreditWarningTrigger message={creditWarningMessage} />
            <WorkflowEditor
                accounts={accounts}
                announcementCategories={announcementCategories}
                initialWorkflow={initialWorkflow}
                llmProviders={systemConfig.llm_providers}
                openRouterModels={openRouterModels}
                presets={presets}
                watchlists={watchlists}
            />
        </>
    );
}
