"use client";

import { ensureCanvasKitDocument } from "@/lib/adaptive-workspace/canvas-kit";
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
            : "Canvas";

    if (!document) {
        return <p className="p-3 text-sm text-destructive">This canvas is missing its document.</p>;
    }

    return (
        <iframe
            className="min-h-0 h-full w-full flex-1 border-0 bg-[#1c1c1c]"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts"
            srcDoc={ensureCanvasKitDocument(document)}
            title={title}
        />
    );
}
