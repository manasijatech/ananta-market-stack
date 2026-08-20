"use client";

import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import { useAlertStudio } from "@/hooks/use-alert-studio";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    refreshNonce: number;
};

function tickEntries(samples: Record<string, unknown>): Array<[string, string]> {
    const tick = isRecord(samples.example_tick) ? samples.example_tick : {};
    return Object.entries(tick)
        .slice(0, 12)
        .map(([key, value]) => [key, value == null ? "—" : String(value)]);
}

export function LiveWorkflowSimulationWidget({ component, refreshNonce }: Props) {
    const { error, loading, studio } = useAlertStudio(component, refreshNonce);
    const samples = studio?.samples ?? {};
    const rows = Array.isArray(samples.samples) ? samples.samples.filter(isRecord) : [];
    const tick = tickEntries(samples);

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading simulation">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">{rows.length} sample alerts</p>
                <LiveStatusBadge label={studio?.source === "snapshot" ? "Snapshot" : "Preview"} tone="cached" />
            </div>
            {tick.length || rows.length ? (
                <div className="grid gap-3 p-3">
                    {tick.length ? (
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            {tick.map(([key, value]) => (
                                <div className="contents" key={key}>
                                    <dt className="text-muted-foreground">{key}</dt>
                                    <dd className="font-mono">{value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : null}
                    {rows.map((row, index) => (
                        <div className="rounded-md border border-border/70 px-2.5 py-2" key={`${row.title}:${index}`}>
                            <p className="text-sm font-medium">{typeof row.title === "string" ? row.title : "Sample alert"}</p>
                            {typeof row.message === "string" ? (
                                <p className="mt-0.5 text-xs text-muted-foreground">{row.message}</p>
                            ) : null}
                            {typeof row.why === "string" ? <p className="mt-1 text-[11px] text-muted-foreground">{row.why}</p> : null}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="p-3 text-sm text-muted-foreground">No samples yet. Use Refresh snapshot on the approval card.</p>
            )}
        </WidgetState>
    );
}
