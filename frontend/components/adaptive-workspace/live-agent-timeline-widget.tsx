"use client";

import { LiveStatusBadge } from "@/components/adaptive-workspace/widget-kit";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { titleForComponent } from "@/lib/adaptive-workspace/catalog";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";

export function LiveAgentTimelineWidget() {
    const { outputs, spec } = useAdaptiveWorkspace();
    const rows = spec.components.map((item) => {
        const bound = outputs[item.id];
        const output = bound?.output;
        const envelope = isRecord(output) ? output : null;
        const hasOutput = Boolean(bound);
        const ok = !hasOutput || envelope?.ok !== false;
        return {
            id: item.id,
            label: hasOutput ? (ok ? "Bound" : "Error") : "Live",
            ok,
            title: titleForComponent(item.type, item.props, item.type),
            tool: bound?.toolName || item.data?.tool || item.type
        };
    });

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
                <p className="text-xs text-muted-foreground">Desk activity</p>
                <LiveStatusBadge label={`${rows.length} widgets`} tone={rows.length ? "cached" : "idle"} />
            </div>
            {!rows.length ? (
                <p className="p-3 text-sm text-muted-foreground">
                    Nothing on the canvas yet. Tool calls stay in the inspector; composed widgets will list here.
                </p>
            ) : (
                <ul className="min-h-0 flex-1 overflow-auto px-3 py-2">
                    {rows.map((row) => (
                        <li className="flex items-start justify-between gap-2 border-b border-border/40 py-1.5 last:border-b-0" key={row.id}>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{row.title}</p>
                                <p className="truncate font-mono text-[11px] text-muted-foreground">{row.tool}</p>
                            </div>
                            <LiveStatusBadge label={row.label} tone={row.ok ? "live" : "error"} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
