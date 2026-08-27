"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { ensureCanvasKitDocument } from "@/lib/adaptive-workspace/canvas-kit";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
};

export function LiveHtmlArtifactWidget({ component }: Props) {
    const { resolvedTheme } = useTheme();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const theme = resolvedTheme === "light" ? "light" : "dark";
    const document =
        typeof component.data?.params?.document === "string" ? component.data.params.document.trim() : "";
    const title =
        typeof component.props?.title === "string" && component.props.title.trim()
            ? component.props.title.trim()
            : "Canvas";
    const srcDoc = document ? ensureCanvasKitDocument(document, theme) : "";

    const postTheme = useCallback(() => {
        iframeRef.current?.contentWindow?.postMessage({ theme, type: "aw-theme" }, "*");
    }, [theme]);

    useEffect(() => {
        postTheme();
    }, [postTheme, srcDoc]);

    if (!document) {
        return <p className="p-3 text-sm text-destructive">This canvas is missing its document.</p>;
    }

    return (
        <iframe
            className="min-h-0 h-full w-full flex-1 border-0 bg-background"
            onLoad={postTheme}
            ref={iframeRef}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            title={title}
        />
    );
}
