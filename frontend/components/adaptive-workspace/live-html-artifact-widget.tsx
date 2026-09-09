"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import { useOptionalLivePriceIsland } from "@/components/adaptive-workspace/live-price-island-context";
import { liveTickMove } from "@/hooks/use-live-prices";
import { canvasDocumentLtpSymbols, ensureCanvasKitDocument } from "@/lib/adaptive-workspace/canvas-kit";
import { islandKey } from "@/lib/live-ltp-island";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
};

export function LiveHtmlArtifactWidget({ component }: Props) {
    const { resolvedTheme } = useTheme();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const islandCtx = useOptionalLivePriceIsland();
    const theme = resolvedTheme === "light" ? "light" : "dark";
    const documentHtml =
        typeof component.data?.params?.document === "string" ? component.data.params.document.trim() : "";
    const title =
        typeof component.props?.title === "string" && component.props.title.trim()
            ? component.props.title.trim()
            : "Canvas";
    const srcDoc = documentHtml ? ensureCanvasKitDocument(documentHtml, theme) : "";
    const symbols = useMemo(() => canvasDocumentLtpSymbols(documentHtml), [documentHtml]);

    const postTheme = useCallback(() => {
        iframeRef.current?.contentWindow?.postMessage({ theme, type: "aw-theme" }, "*");
    }, [theme]);

    const postLtp = useCallback(() => {
        if (!symbols.length) return;
        const ticks = symbols.map((row) => {
            const tick = islandCtx?.tickFor(row.symbol);
            const move = liveTickMove(tick);
            const key = islandKey(row.exchange, row.symbol);
            const displayed = islandCtx?.displayed[key];
            const ltp = move.ltp ?? displayed?.ltp ?? null;
            const chgPct = move.changePercent ?? displayed?.chgPct ?? null;
            if (islandCtx && (ltp != null || chgPct != null)) {
                islandCtx.registerDisplayed(key, { chgPct, ltp });
            }
            return {
                chgPct,
                exchange: row.exchange,
                live: move.ltp != null,
                ltp,
                symbol: row.symbol
            };
        });
        iframeRef.current?.contentWindow?.postMessage({ ticks, type: "aw-ltp" }, "*");
    }, [islandCtx, symbols]);

    useEffect(() => {
        if (!islandCtx || !symbols.length) return;
        const demandId = `canvas-html:${component.id}`;
        islandCtx.registerDemand(
            demandId,
            symbols.map((row) => ({ exchange: row.exchange, symbol: row.symbol }))
        );
        return () => islandCtx.unregisterDemand(demandId);
    }, [component.id, islandCtx, symbols]);

    useEffect(() => {
        postTheme();
        postLtp();
    }, [postLtp, postTheme, srcDoc]);

    useEffect(() => {
        postLtp();
    }, [islandCtx?.liveState, postLtp, symbols]);

    useEffect(() => {
        if (!symbols.length) return;
        const handle = window.setInterval(() => postLtp(), 1500);
        return () => window.clearInterval(handle);
    }, [postLtp, symbols.length]);

    if (!documentHtml) {
        return <p className="p-3 text-sm text-destructive">This canvas is missing its document.</p>;
    }

    return (
        <iframe
            className="min-h-0 h-full w-full flex-1 border-0 bg-background"
            onLoad={() => {
                postTheme();
                postLtp();
            }}
            ref={iframeRef}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            title={title}
        />
    );
}
