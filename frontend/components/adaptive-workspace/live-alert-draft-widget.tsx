"use client";

import Link from "next/link";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { Badge } from "@/components/ui/badge";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useAlertStudio } from "@/hooks/use-alert-studio";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

function conditionSummary(payload: Record<string, unknown>): string {
    const dsl = isRecord(payload.workflow_dsl) ? payload.workflow_dsl : null;
    const conditions = Array.isArray(dsl?.conditions) ? dsl.conditions.filter(isRecord) : [];
    if (!conditions.length) return "No conditions";
    return conditions
        .slice(0, 4)
        .map((item) => {
            const field = typeof item.field === "string" ? item.field : "field";
            const operator = typeof item.operator === "string" ? item.operator : "";
            const value = item.value == null ? "" : String(item.value);
            return [field, operator, value].filter(Boolean).join(" ");
        })
        .join(" · ");
}

export function LiveAlertDraftWidget({ component, onPatch, refreshNonce }: Props) {
    const { error, loading, selectWorkflow, studio } = useAlertStudio(component, refreshNonce);
    const workflows = studio?.workflows ?? [];
    const selectedId = studio?.workflow_id || "";

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading alert draft">
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                <SimpleSelect
                    aria-label="Alert workflow"
                    className="h-7 min-w-0 flex-1"
                    onValueChange={(workflowId) => void selectWorkflow(workflowId, onPatch)}
                    options={workflows.flatMap((item) =>
                        item.id
                            ? [{ label: `${item.name || item.id}${item.status ? ` (${item.status})` : ""}`, value: item.id }]
                            : []
                    )}
                    placeholder="Latest workflow"
                    size="sm"
                    value={selectedId}
                />
                <LiveStatusBadge
                    label={studio?.source === "snapshot" ? "Snapshot" : studio?.source === "workflow" ? "Live draft" : "Empty"}
                    tone={studio?.valid ? "live" : studio?.source === "empty" ? "idle" : "cached"}
                />
            </div>
            {studio?.source === "empty" ? (
                <p className="p-3 text-sm text-muted-foreground">
                    No alert workflows yet. Create one in{" "}
                    <Link className="underline" href="/alerts-workspace">
                        Alerts Workspace
                    </Link>
                    .
                </p>
            ) : (
                <div className="grid gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {typeof studio?.workflow_payload.symbol === "string" && studio.workflow_payload.symbol ? (
                            <Badge size="sm" variant="outline">
                                {studio.workflow_payload.symbol}
                            </Badge>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">{studio?.status || "draft"}</span>
                        <span className="text-[11px] text-muted-foreground">{studio?.valid ? "valid" : "needs review"}</span>
                    </div>
                    <p className="text-sm font-medium">{studio?.name || "Untitled workflow"}</p>
                    <p className="text-xs text-muted-foreground">{conditionSummary(studio?.workflow_payload ?? {})}</p>
                    {studio?.workflow_id ? (
                        <Link className="text-xs underline" href={`/alerts-workspace/workflows/${studio.workflow_id}`}>
                            Open full editor
                        </Link>
                    ) : null}
                </div>
            )}
        </WidgetState>
    );
}
