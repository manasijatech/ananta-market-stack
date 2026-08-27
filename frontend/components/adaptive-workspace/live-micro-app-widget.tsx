"use client";

import { useEffect, useMemo, useRef } from "react";
import { LiveStatusBadge } from "@/components/adaptive-workspace/widget-kit";
import {
    bindMicroAppPayload,
    MICRO_APP_REGISTRY,
    microAppIdFromComponent,
    microAppSrcDoc,
    readMicroAppMessage
} from "@/lib/adaptive-workspace/micro-apps";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export function LiveMicroAppWidget({ component, onPatch, refreshNonce }: Props) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const appId = microAppIdFromComponent(component.props, component.data?.params);
    const bound = useMemo(() => {
        if (!appId) return null;
        return bindMicroAppPayload(appId, { ...(component.data?.params ?? {}), ...(component.props ?? {}) });
    }, [appId, component.data?.params, component.props]);
    const srcDoc = useMemo(() => (appId && bound ? microAppSrcDoc(appId, bound) : ""), [appId, bound]);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame || !bound) return;
        frame.contentWindow?.postMessage({ source: "ananta-host", type: "bind", payload: bound }, "*");
    }, [bound, refreshNonce]);

    useEffect(() => {
        function onMessage(event: MessageEvent) {
            const message = readMicroAppMessage(event, frameRef.current?.contentWindow ?? null);
            if (!message) return;
            if (message.action === "select") {
                const next: Record<string, unknown> = {};
                for (const key of ["spot", "strike", "premium", "kind"] as const) {
                    if (Object.prototype.hasOwnProperty.call(message.payload, key)) next[key] = message.payload[key];
                }
                if (Object.keys(next).length) onPatch({ ...next, appId: message.appId });
            }
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [onPatch]);

    if (!appId || !bound) {
        return <p className="p-3 text-sm text-destructive">This micro-app is not in the curated registry.</p>;
    }

    const app = MICRO_APP_REGISTRY[appId];
    const kind = isRecord(bound) && typeof bound.kind === "string" ? bound.kind : null;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">
                    {app.label}
                    {kind ? ` · ${kind}` : ""}
                </p>
                <LiveStatusBadge label="Sandboxed" tone="cached" />
            </div>
            <iframe
                className="min-h-0 flex-1 border-0 bg-transparent"
                ref={frameRef}
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
                srcDoc={srcDoc}
                title={app.label}
            />
        </div>
    );
}
