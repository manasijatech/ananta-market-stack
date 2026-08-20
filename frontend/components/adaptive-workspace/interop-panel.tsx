"use client";

import { useMemo, useState } from "react";
import { IconCopy, IconRefresh } from "@tabler/icons-react";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { a2uiToWorkspaceSpec, roundTripA2UI, workspaceSpecToA2UI } from "@/lib/adaptive-workspace/a2ui";
import { summarizeAguiEvent, type AguiEvent } from "@/lib/adaptive-workspace/ag-ui";
import { workspaceSpecsEqual } from "@/lib/adaptive-workspace/spec";

type Props = {
    events: AguiEvent[];
    runId: string | null;
    threadId: string | null;
};

async function copyText(value: string) {
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        return false;
    }
}

export function AdaptiveInteropPanel({ events, runId, threadId }: Props) {
    const canvas = useAdaptiveWorkspace();
    const [note, setNote] = useState<string | null>(null);
    const a2ui = useMemo(() => workspaceSpecToA2UI(canvas.spec, threadId || "desk"), [canvas.spec, threadId]);
    const a2uiText = useMemo(() => JSON.stringify(a2ui, null, 2), [a2ui]);
    const aguiText = useMemo(() => JSON.stringify(events, null, 2), [events]);

    function roundTrip() {
        const result = roundTripA2UI(canvas.spec, threadId || "desk");
        if (!result.spec) {
            setNote(result.issues[0]?.message || "A2UI round-trip failed.");
            return;
        }
        if (workspaceSpecsEqual(result.spec, canvas.spec)) {
            setNote("A2UI round-trip preserved this desk. WorkspaceSpec is still the compose path.");
            return;
        }
        canvas.applySpec(result.spec, "user");
        setNote("A2UI import produced a valid WorkspaceSpec and applied it.");
    }

    function checkImport() {
        const result = a2uiToWorkspaceSpec(a2ui);
        setNote(result.spec ? "Current A2UI export validates back into WorkspaceSpec." : result.issues[0]?.message || "Invalid A2UI.");
    }

    return (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
                <Button
                    onClick={() => void copyText(aguiText).then((ok) => setNote(ok ? "Copied AG-UI events." : "Copy failed."))}
                    size="xs"
                    type="button"
                    variant="outline"
                >
                    <IconCopy className="size-3.5" stroke={1.8} />
                    Copy AG-UI
                </Button>
                <Button
                    onClick={() => void copyText(a2uiText).then((ok) => setNote(ok ? "Copied A2UI messages." : "Copy failed."))}
                    size="xs"
                    type="button"
                    variant="outline"
                >
                    <IconCopy className="size-3.5" stroke={1.8} />
                    Copy A2UI
                </Button>
                <Button onClick={checkImport} size="xs" type="button" variant="outline">
                    Validate A2UI
                </Button>
                <Button onClick={roundTrip} size="xs" type="button" variant="outline">
                    <IconRefresh className="size-3.5" stroke={1.8} />
                    Round-trip
                </Button>
            </div>
            <div className="min-h-0 overflow-auto p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">AG-UI from SSE</p>
                <p className="mt-1 text-xs text-muted-foreground">
                    Derived from the existing broker-chat stream{runId ? ` for ${runId.slice(0, 8)}` : ""}. Not a second protocol.
                </p>
                {events.length ? (
                    <ol className="mt-2 space-y-1">
                        {events.map((event, index) => (
                            <li className="rounded-md border border-border/70 bg-background px-2 py-1.5" key={`${event.type}:${index}`}>
                                <p className="font-mono text-[11px] font-semibold text-primary">{event.type}</p>
                                {summarizeAguiEvent(event) ? (
                                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{summarizeAguiEvent(event)}</p>
                                ) : null}
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Send a message to see AG-UI events mapped from SSE.</p>
                )}
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">A2UI v0.9 export</p>
                <p className="mt-1 text-xs text-muted-foreground">Catalog ananta-workspace-v1. Import fails closed through WorkspaceSpec.</p>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] leading-5">
                    {a2uiText}
                </pre>
                {note ? <p className="mt-3 text-xs text-muted-foreground">{note}</p> : null}
            </div>
        </div>
    );
}
