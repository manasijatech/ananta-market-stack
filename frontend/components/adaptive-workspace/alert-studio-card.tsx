"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { Badge } from "@/components/ui/badge";
import { asToolEnvelope, isRecord, toolEnvelopeMessage, toolEnvelopeOk } from "@/lib/adaptive-workspace/tool-envelope";

export function AlertStudioCard({ name, output, status }: CustomToolRendererProps) {
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const payload = ok && isRecord(envelope) ? envelope : null;
    const source = typeof payload?.source === "string" ? payload.source : "";
    const title =
        name === "alert_deploy_snapshot" ? "Alert deploy" : name === "alert_refresh_studio" ? "Alert snapshot" : "Alert studio";

    return (
        <ToolCardShell
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel="Loading alert studio"
            title={title}
        >
            {payload ? (
                <div className="grid gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {typeof payload.status === "string" && payload.status ? (
                            <Badge size="sm" variant="outline">
                                {payload.status}
                            </Badge>
                        ) : null}
                        {source ? <span className="text-[11px] text-muted-foreground">{source}</span> : null}
                        <span className="text-[11px] text-muted-foreground">{payload.valid === true ? "valid" : "needs review"}</span>
                    </div>
                    <p className="text-sm font-medium">
                        {typeof payload.name === "string" && payload.name ? payload.name : "No workflow selected"}
                    </p>
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">No alert studio payload.</p>
            )}
        </ToolCardShell>
    );
}
