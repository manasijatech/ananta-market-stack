import { AlertsNav } from "@/components/alerts/alerts-nav";
import { WorkflowEditor } from "@/components/alerts/workflow-editor";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getAlertTemplates } from "@/service/actions/alerts";
import { getBrokerAccounts } from "@/service/actions/broker";

type NewWorkflowPageProps = {
 searchParams?: Promise<{ template?: string }>;
};

export default async function NewWorkflowPage({ searchParams }: NewWorkflowPageProps) {
 const params = await searchParams;
 const [accounts, templates] = await Promise.all([getBrokerAccounts(), getAlertTemplates()]);
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
 <Shell>
 <PageHeader
 eyebrow="Alerts workspace"
 title="Create workflow"
 description="Build a live alert workflow with either the rule form or the graph editor over the same workflow model."
 />
 <AlertsNav />
 <WorkflowEditor accounts={accounts} initialWorkflow={initialWorkflow} />
 </Shell>
 );
}
