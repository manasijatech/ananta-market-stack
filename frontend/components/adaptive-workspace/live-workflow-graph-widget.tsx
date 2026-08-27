"use client";

import Link from "next/link";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAlertStudio } from "@/hooks/use-alert-studio";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    refreshNonce: number;
};

export function LiveWorkflowGraphWidget({ component, refreshNonce }: Props) {
    const { error, loading, studio } = useAlertStudio(component, refreshNonce);
    const nodes = studio?.graph_dsl.nodes ?? [];
    const edges = studio?.graph_dsl.edges ?? [];

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading workflow graph">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">
                    {nodes.length} nodes · {edges.length} edges
                </p>
                <LiveStatusBadge label={studio?.name || "Workflow"} tone="cached" />
            </div>
            {nodes.length ? (
                <ol className="grid gap-1.5 p-3">
                    {nodes.map((node, index) => (
                        <li className="rounded-md border border-border/70 px-2.5 py-2" key={node.id || `node-${index}`}>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {node.kind ? (
                                    <Badge size="sm" variant="outline">
                                        {node.kind}
                                    </Badge>
                                ) : null}
                                <span className="text-sm font-medium">{node.label || node.id || `Node ${index + 1}`}</span>
                            </div>
                            {index < nodes.length - 1 ? (
                                <p className="px-1 pt-1 text-[11px] text-muted-foreground">↓</p>
                            ) : null}
                        </li>
                    ))}
                </ol>
            ) : (
                <div className="grid gap-2 p-3">
                    <p className="text-sm text-muted-foreground">
                        The graph fills after a draft exists on this desk. Create one in the draft widget, then prepare a snapshot.
                    </p>
                    <Button render={<Link href="/alerts-workspace" />} size="xs" variant="outline">
                        Open full authoring
                    </Button>
                </div>
            )}
        </WidgetState>
    );
}
