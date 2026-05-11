import { AlertsNav } from "@/components/alerts/alerts-nav";
import { WorkflowList } from "@/components/alerts/workflow-list";
import { PageHeader, PrimaryLink, Shell } from "@/components/brokers/ui";
import { getAlertWorkflows } from "@/service/actions/alerts";

type WorkflowsPageProps = {
  searchParams?: Promise<{ status?: string }>;
};

export default async function WorkflowsPage({ searchParams }: WorkflowsPageProps) {
  const params = await searchParams;
  const status = params?.status === "inactive" ? "inactive" : "active";
  const workflows = await getAlertWorkflows(status);

  return (
    <Shell>
      <PageHeader
        eyebrow="Alerts workspace"
        title={status === "active" ? "Active workflows" : "Inactive workflows"}
        description="Review configured workflows, jump into editing, and switch between active and inactive tracking."
        action={<PrimaryLink href="/alerts/workflows/new">+ New workflow</PrimaryLink>}
      />
      <AlertsNav />
      <WorkflowList emptyMessage="No workflows in this state yet." workflows={workflows} />
    </Shell>
  );
}
