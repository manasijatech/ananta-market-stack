import Link from "next/link";
import { AlertsNav } from "@/components/alerts/alerts-nav";
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
      <section className="grid gap-4">
        {workflows.map((workflow) => (
          <Link className="rounded-lg border border-border p-5 transition hover:border-primary/40" href={`/alerts/workflows/${workflow.id}`} key={workflow.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold">{workflow.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {workflow.symbol ?? "No symbol"} · {workflow.exchange ?? "-"} · {workflow.broker_code ?? "No broker"}
                </div>
              </div>
              <div className="rounded-full border border-border px-3 py-1 text-xs font-bold uppercase text-muted-foreground">
                {workflow.status}
              </div>
            </div>
            <div className="mt-3 text-sm text-muted-foreground">{workflow.description || "No description"}</div>
          </Link>
        ))}
        {!workflows.length ? <div className="text-sm text-muted-foreground">No workflows in this state yet.</div> : null}
      </section>
    </Shell>
  );
}
