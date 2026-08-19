"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { PinButton, ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { useAdaptiveWorkspacePins } from "@/components/adaptive-workspace/workspace-provider";
import { Badge } from "@/components/ui/badge";
import {
    asToolEnvelope,
    isRecord,
    stringFrom,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";

function rowsFromEnvelope(envelope: Record<string, unknown> | null) {
    if (!envelope) return [];
    const workflows = Array.isArray(envelope.workflows) ? envelope.workflows.filter(isRecord) : [];
    if (workflows.length) {
        return workflows.map((row, index) => ({
            id: stringFrom(row, ["id"], `workflow-${index}`),
            meta: stringFrom(row, ["status"], ""),
            symbol: stringFrom(row, ["symbol"], ""),
            title: stringFrom(row, ["name"], "Untitled workflow")
        }));
    }
    const notifications = Array.isArray(envelope.notifications) ? envelope.notifications.filter(isRecord) : [];
    return notifications.map((row, index) => ({
        id: stringFrom(row, ["id"], `note-${index}`),
        meta: stringFrom(row, ["level", "status"], ""),
        symbol: stringFrom(row, ["symbol"], ""),
        title: stringFrom(row, ["title", "message"], "Alert")
    }));
}

export function AlertInboxCard({ input, name, output, status }: CustomToolRendererProps) {
    const { pin } = useAdaptiveWorkspacePins();
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const rows = ok ? rowsFromEnvelope(envelope) : [];
    const workflows = name === "intel_list_alert_workflows";

    return (
        <ToolCardShell
            actions={<PinButton disabled={pending || !ok} onClick={() => pin({ input, output, toolName: name })} />}
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel={workflows ? "Loading alert workflows" : "Loading alert notifications"}
            title={workflows ? "Alert workflows" : "Alert notifications"}
        >
            {rows.length ? (
                <ul className="grid gap-2">
                    {rows.map((row) => (
                        <li className="rounded-md border border-border/70 px-2.5 py-2" key={row.id}>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {row.symbol ? (
                                    <Badge size="sm" variant="outline">
                                        {row.symbol}
                                    </Badge>
                                ) : null}
                                {row.meta ? <span className="text-[11px] text-muted-foreground">{row.meta}</span> : null}
                            </div>
                            <p className="mt-1 text-sm font-medium leading-5">{row.title}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground">
                    {workflows ? "No alert workflows for this user yet." : "No alert notifications yet."}
                </p>
            )}
        </ToolCardShell>
    );
}
