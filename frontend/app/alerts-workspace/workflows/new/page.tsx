import { WorkflowEditor } from "@/components/alerts/workflow-editor";
import { getAlertPresets, getAlertTemplates } from "@/service/actions/alerts";
import { getAlphaAnnouncementCategories } from "@/service/actions/alpha/announcements";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";

type NewWorkflowPageProps = {
 searchParams?: Promise<{ template?: string }>;
};

export default async function NewWorkflowPage({ searchParams }: NewWorkflowPageProps) {
 const params = await searchParams;
 const [accounts, templates, watchlists, presets, systemConfig, announcementCategories] = await Promise.all([
 getBrokerAccounts(),
 getAlertTemplates(),
 getWatchlists(),
 getAlertPresets(),
 getSystemConfig(),
 getAlphaAnnouncementCategories().catch(() => [])
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
 <WorkflowEditor accounts={accounts} announcementCategories={announcementCategories} initialWorkflow={initialWorkflow} llmProviders={systemConfig.llm_providers} presets={presets} watchlists={watchlists} />
 );
}
