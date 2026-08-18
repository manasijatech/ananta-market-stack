"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { PinButton, ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { useAdaptiveWorkspacePins } from "@/components/adaptive-workspace/workspace-provider";
import { Badge } from "@/components/ui/badge";
import {
    asToolEnvelope,
    isRecord,
    provenanceFromEnvelope,
    stringFrom,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";

export function SessionStatusCard({ input, name, output, status }: CustomToolRendererProps) {
    const { pin } = useAdaptiveWorkspacePins();
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const session = envelope && ok && isRecord(envelope.session) ? envelope.session : {};
    const verified = envelope && ok && typeof envelope.verified === "boolean" ? envelope.verified : null;
    const active = session.session_active === true || verified === true;
    const guidance = stringFrom(session, ["guidance"]) || (typeof envelope?.message === "string" ? envelope.message : "");
    const loginUrl = stringFrom(session, ["login_url"]);

    return (
        <ToolCardShell
            actions={<PinButton disabled={pending || !ok} onClick={() => pin({ input, output, toolName: name })} />}
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel="Checking broker session"
            provenance={provenanceFromEnvelope(envelope, name)}
            title="Broker health"
        >
            <div className="flex flex-wrap items-center gap-2">
                <Badge size="sm" variant={active ? "success" : "warning"}>
                    {active ? "Session active" : "Action required"}
                </Badge>
                {stringFrom(session, ["automation_mode"]) ? (
                    <Badge size="sm" variant="outline">
                        {stringFrom(session, ["automation_mode"])}
                    </Badge>
                ) : null}
            </div>
            {guidance ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{guidance}</p> : null}
            {loginUrl ? (
                <a className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline" href={loginUrl}>
                    Open broker login
                </a>
            ) : null}
        </ToolCardShell>
    );
}
