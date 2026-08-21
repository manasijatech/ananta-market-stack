"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowBackUp } from "@tabler/icons-react";
import { AdaptiveCanvasWidget } from "@/components/adaptive-workspace/canvas-widget";
import { AdaptiveDeskPersonalization } from "@/components/adaptive-workspace/desk-personalization";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { CANVAS_GAP, CANVAS_ROW_HEIGHT } from "@/lib/adaptive-workspace/layout";
import { cn } from "@/lib/utils";

type Props = {
    onPrompt: (prompt: string) => void;
    starterPrompts: string[];
};

export function AdaptiveCanvasBoard({ onPrompt, starterPrompts }: Props) {
    const { canUndo, loading, spec, undo } = useAdaptiveWorkspace();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const boardRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(960);

    useEffect(() => {
        const node = boardRef.current;
        if (!node) return;
        const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width;
            if (width) setContainerWidth(width);
        });
        observer.observe(node);
        setContainerWidth(node.clientWidth || 960);
        return () => observer.disconnect();
    }, []);

    const rows = Math.max(
        8,
        spec.components.reduce((maxY, item) => Math.max(maxY, item.position.y + item.position.h), 0) + 2
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                    <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Canvas</p>
                    <h2 className="truncate text-lg font-heading font-semibold tracking-tight">{spec.title}</h2>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    <AdaptiveDeskPersonalization />
                    <Button disabled={!canUndo} onClick={undo} size="sm" type="button" variant="outline">
                        <IconArrowBackUp className="size-4" stroke={1.8} />
                        Undo
                    </Button>
                </div>
            </div>
            <div className={cn("min-h-0 flex-1 overflow-auto bg-background/40 p-3", prefs?.density === "compact" && "[&_td]:py-1 [&_th]:py-1")} ref={boardRef}>
                {loading ? (
                    <p className="text-sm text-muted-foreground">Restoring saved desk…</p>
                ) : !spec.components.length ? (
                    <div className="flex h-full min-h-[280px] items-center justify-center text-center">
                        <div className="w-full max-w-2xl">
                            <h3 className="text-2xl font-heading font-semibold tracking-tight">This desk is empty</h3>
                            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                                Ask in chat to compose a workspace from holdings, watchlists, quotes, market intelligence, and alerts.
                            </p>
                            <div className="mx-auto mt-6 grid max-w-xl gap-2 min-[640px]:grid-cols-2">
                                {starterPrompts.map((prompt) => (
                                    <button
                                        className="rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm font-semibold transition hover:border-primary hover:bg-[var(--accent-glow)] hover:text-primary"
                                        key={prompt}
                                        onClick={() => onPrompt(prompt)}
                                        type="button"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div
                        className="grid w-full"
                        style={{
                            gap: CANVAS_GAP,
                            gridAutoRows: CANVAS_ROW_HEIGHT,
                            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                            minHeight: rows * (CANVAS_ROW_HEIGHT + CANVAS_GAP)
                        }}
                    >
                        {spec.components.map((component) => (
                            <AdaptiveCanvasWidget
                                component={component}
                                containerWidth={containerWidth}
                                key={component.id}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
