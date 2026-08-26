"use client";

import { useState } from "react";
import Link from "next/link";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    const { busy, createDraft, error, loading, selectWorkflow, studio } = useAlertStudio(component, refreshNonce);
    const workflows = studio?.workflows ?? [];
    const selectedId = studio?.workflow_id || "";
    const [symbol, setSymbol] = useState("");
    const [operator, setOperator] = useState("gte");
    const [threshold, setThreshold] = useState("");
    const [createdHint, setCreatedHint] = useState(false);

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading alert draft">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border/70 px-2 py-2">
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
                <p className="px-3 pt-3 text-sm text-muted-foreground">
                    No alert workflows yet. Create a draft here — Alerts Workspace stays available for the full editor.
                </p>
            ) : (
                <div className="grid gap-2 px-3 pt-3">
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
            <form
                className="mt-auto grid gap-2 border-t border-border/50 p-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    const value = Number(threshold);
                    if (!symbol.trim() || !Number.isFinite(value)) return;
                    void createDraft({ operator, symbol: symbol.trim().toUpperCase(), value }).then((next) => {
                        if (next.workflow_id) onPatch({ workflowId: next.workflow_id });
                        setSymbol("");
                        setThreshold("");
                        setCreatedHint(true);
                    });
                }}
            >
                <p className="text-[11px] font-medium text-muted-foreground">New LTP draft</p>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Input
                        aria-label="Symbol"
                        className="h-7 w-[7rem]"
                        onChange={(event) => setSymbol(event.target.value)}
                        placeholder="RELIANCE"
                        size="sm"
                        value={symbol}
                    />
                    <SimpleSelect
                        aria-label="Operator"
                        className="h-7 w-[4.5rem]"
                        onValueChange={setOperator}
                        options={[
                            { label: "≥", value: "gte" },
                            { label: "≤", value: "lte" },
                            { label: ">", value: "gt" },
                            { label: "<", value: "lt" }
                        ]}
                        size="sm"
                        value={operator}
                    />
                    <Input
                        aria-label="Threshold"
                        className="h-7 w-[5.5rem]"
                        onChange={(event) => setThreshold(event.target.value)}
                        placeholder="2500"
                        size="sm"
                        value={threshold}
                    />
                    <Button disabled={busy || !symbol.trim() || !threshold.trim()} size="xs" type="submit">
                        Create draft
                    </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Saves as draft only. Deploy stays on the approval card after you confirm.</p>
                {createdHint ? (
                    <p className="text-[11px] text-primary">
                        Use the approval card: prepare snapshot, then confirm deploy.
                    </p>
                ) : null}
            </form>
        </WidgetState>
    );
}
