import { WorkflowList } from "@/components/alerts/workflow-list";
import { getAlertWorkflows } from "@/service/actions/alerts";

type WorkflowsPageProps = {
 searchParams?: Promise<{ status?: string }>;
};

export default async function WorkflowsPage({ searchParams }: WorkflowsPageProps) {
 const params = await searchParams;
 const status = params?.status === "inactive" ? "inactive" : "active";
 const workflows = await getAlertWorkflows(status);

 return <WorkflowList emptyMessage="No workflows in this state yet." workflows={workflows} />;
}
