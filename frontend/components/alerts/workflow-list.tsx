"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAlertWorkflow, setAlertWorkflowStatus } from "@/service/actions/alerts";
import type { AlertWorkflow } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";

function workflowScope(workflow: AlertWorkflow) {
 const targeting = workflow.workflow_dsl.targeting;
 const entries = targeting.entries ?? [];
 if (targeting.mode === "preset_universe") {
 return targeting.preset_label || targeting.preset_id || "Preset universe";
 }
 if (entries.length === 1) {
 return [entries[0].symbol, entries[0].exchange ?? workflow.exchange].filter(Boolean).join(" · ");
 }
 if (entries.length > 1) {
 return `${entries.length} symbols · ${entries[0].symbol}${entries.length > 1 ? ` +${entries.length - 1} more` : ""}`;
 }
 return [workflow.symbol ?? "No target", workflow.exchange ?? "-"].join(" · ");
}

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
 {error ? <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div> : null}
 {workflows.map((workflow) => (
 <div
 className=" border border-border p-5 transition hover:border-primary/40"
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
 {workflowScope(workflow)} · {workflow.broker_code ?? "No broker"} · {workflow.workflow_dsl.targeting.mode.replaceAll("_", " ")}
 </div>
 </div>
 <div className=" border border-border px-3 py-1 text-xs font-bold uppercase text-muted-foreground">
 {workflow.deployment_status || workflow.status}
 </div>
 </div>
 <div className="mt-3 text-sm text-muted-foreground">{workflow.description || "No description"}</div>
 {workflow.last_runtime_error ? <div className="mt-2 text-xs text-[var(--danger)]">{workflow.last_runtime_error}</div> : null}
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
