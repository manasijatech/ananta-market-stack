"use client";

import { useAdaptiveInterop } from "@/components/adaptive-workspace/interop-context";
import { LiveStatusBadge } from "@/components/adaptive-workspace/widget-kit";
import { summarizeAguiEvent } from "@/lib/adaptive-workspace/ag-ui";

export function LiveAgentTimelineWidget() {
    const { aguiEvents, runId } = useAdaptiveInterop();
    const recent = aguiEvents.slice(-24);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">
                    {runId ? `AG-UI from SSE · ${runId.slice(0, 8)}` : "AG-UI from SSE"}
                </p>
                <LiveStatusBadge label={aguiEvents.length ? "Mapped" : "Idle"} tone={aguiEvents.length ? "live" : "idle"} />
            </div>
            <ol className="min-h-0 flex-1 space-y-1 overflow-auto p-3">
                {recent.length ? (
                    recent.map((event, index) => (
                        <li className="rounded-md border border-border/70 px-2 py-1.5" key={`${event.type}:${index}`}>
                            <p className="font-mono text-[11px] font-semibold">{event.type}</p>
                            {summarizeAguiEvent(event) ? (
                                <p className="truncate text-[11px] text-muted-foreground">{summarizeAguiEvent(event)}</p>
                            ) : null}
                        </li>
                    ))
                ) : (
                    <li className="text-sm text-muted-foreground">Ask in chat. This widget maps the existing stream; it does not replace it.</li>
                )}
            </ol>
        </div>
    );
}
