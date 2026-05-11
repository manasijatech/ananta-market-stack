"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAlertWorkflow, setAlertWorkflowStatus } from "@/service/actions/alerts";
import type { AlertWorkflow } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";

export function WorkflowList({
  emptyMessage,
  workflows
}: {
  emptyMessage: string;
  workflows: AlertWorkflow[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggleStatus(workflow: AlertWorkflow) {
    setError("");
    setPendingId(workflow.id);
    startTransition(async () => {
      try {
        await setAlertWorkflowStatus(workflow.id, workflow.status === "active" ? "inactive" : "active");
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not update workflow status.");
      } finally {
        setPendingId("");
      }
    });
  }

  function removeWorkflow(workflow: AlertWorkflow) {
    if (typeof window !== "undefined" && !window.confirm(`Delete workflow "${workflow.name}"?`)) {
      return;
    }
    setError("");
    setPendingId(workflow.id);
    startTransition(async () => {
      try {
        await deleteAlertWorkflow(workflow.id);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not delete workflow.");
      } finally {
        setPendingId("");
      }
    });
  }

  return (
    <section className="grid gap-4">
      {error ? <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div> : null}
      {workflows.map((workflow) => (
        <div
          className="rounded-lg border border-border p-5 transition hover:border-primary/40"
          key={workflow.id}
          onClick={() => router.push(`/alerts/workflows/${workflow.id}`)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              router.push(`/alerts/workflows/${workflow.id}`);
            }
          }}
        >
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
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={isPending && pendingId === workflow.id}
              onClick={(event) => {
                event.stopPropagation();
                toggleStatus(workflow);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {workflow.status === "active" ? "Deactivate" : "Activate"}
            </Button>
            <Button
              disabled={isPending && pendingId === workflow.id}
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/alerts/workflows/${workflow.id}`);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Open
            </Button>
            <Button
              disabled={isPending && pendingId === workflow.id}
              onClick={(event) => {
                event.stopPropagation();
                removeWorkflow(workflow);
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        </div>
      ))}
      {!workflows.length ? <div className="text-sm text-muted-foreground">{emptyMessage}</div> : null}
    </section>
  );
}
