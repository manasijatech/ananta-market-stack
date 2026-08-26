"use client";

import { LiveStatusBadge } from "@/components/adaptive-workspace/widget-kit";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
};

export function LiveHtmlArtifactWidget({ component }: Props) {
    const document =
        typeof component.data?.params?.document === "string" ? component.data.params.document.trim() : "";
    const title =
        typeof component.props?.title === "string" && component.props.title.trim()
            ? component.props.title.trim()
            : "Custom view";

    if (!document) {
        return <p className="p-3 text-sm text-destructive">This HTML artifact is missing data.params.document.</p>;
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">{title}</p>
                <LiveStatusBadge label="Sandboxed HTML" tone="cached" />
            </div>
            <iframe
                className="min-h-0 flex-1 border-0 bg-transparent"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
                srcDoc={document}
                title={title}
            />
        </div>
    );
}
