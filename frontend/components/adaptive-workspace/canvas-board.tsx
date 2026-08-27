"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconArrowBackUp, IconLock, IconLockOpen } from "@tabler/icons-react";
import { AdaptiveCanvasWidget } from "@/components/adaptive-workspace/canvas-widget";
import { DeskStarterCatalog } from "@/components/adaptive-workspace/desk-catalog";
import { AdaptiveDeskPersonalization } from "@/components/adaptive-workspace/desk-personalization";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useDeskAccounts } from "@/hooks/use-desk-data";
import { CANVAS_GAP, CANVAS_ROW_HEIGHT } from "@/lib/adaptive-workspace/layout";
import { cn } from "@/lib/utils";

type Props = {
    onPrompt: (prompt: string) => void;
    starterPrompts: string[];
};

function DeskAccountPicker() {
    const prefs = useOptionalAdaptiveDeskPrefs();
    const { account, accounts } = useDeskAccounts();
    if (!prefs) return null;
    if (!accounts.length) {
        return (
            <Button render={<Link href="/broker-connections" />} size="xs" variant="outline">
                Connect broker
            </Button>
        );
    }
    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground min-[720px]:inline">
                Account
            </span>
            <SimpleSelect
                aria-label="Desk account"
                className="h-7 w-[min(11.5rem,42vw)] bg-background px-2 text-xs"
                onValueChange={(id) => void prefs.setDefaultAccountId(id)}
                options={accounts.map((item) => ({
                    label: item.session_status ? `${item.label} · ${item.session_status}` : item.label,
                    value: item.id
                }))}
                placeholder="Desk account"
                size="sm"
                value={account?.id ?? prefs.defaultAccountId}
            />
        </div>
    );
}

export function AdaptiveCanvasBoard({ onPrompt, starterPrompts }: Props) {
    const { canUndo, loading, spec, undo } = useAdaptiveWorkspace();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const boardRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(960);
    const locked = prefs?.canvasLocked !== false;

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
            <div className={cn("flex items-center justify-between gap-3 border-b border-border", locked ? "px-3 py-2" : "px-4 py-3")}>
                <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0">
                        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Canvas</p>
                        <h2 className="truncate text-lg font-heading font-semibold tracking-tight">{spec.title}</h2>
                    </div>
                    {prefs ? (
                        <Button
                            aria-label={locked ? "Unlock canvas layout" : "Lock canvas layout"}
                            className="shrink-0"
                            onClick={() => void prefs.setCanvasLocked(!locked)}
                            size="sm"
                            type="button"
                            variant={locked ? "outline" : "secondary"}
                        >
                            {locked ? <IconLock className="size-4" stroke={1.8} /> : <IconLockOpen className="size-4" stroke={1.8} />}
                            {locked ? "Unlock" : "Lock"}
                        </Button>
                    ) : null}
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    <DeskAccountPicker />
                    {locked ? null : (
                        <>
                            <AdaptiveDeskPersonalization />
                            <Button disabled={!canUndo} onClick={undo} size="sm" type="button" variant="outline">
                                <IconArrowBackUp className="size-4" stroke={1.8} />
                                Undo
                            </Button>
                        </>
                    )}
                </div>
            </div>
            <div
                className={cn(
                    "min-h-0 flex-1 overflow-auto bg-background/40",
                    locked ? "p-1.5" : "p-3",
                    prefs?.density === "compact" && "[&_td]:py-1 [&_th]:py-1"
                )}
                ref={boardRef}
            >
                {loading ? (
                    <p className="text-sm text-muted-foreground">Restoring saved desk…</p>
                ) : !spec.components.length ? (
                    <div className="flex h-full min-h-[280px] items-center justify-center text-center">
                        <div className="w-full max-w-2xl">
                            <h3 className="text-2xl font-heading font-semibold tracking-tight">This desk is empty</h3>
                            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                                Ask in chat to compose a workspace. New desk always starts blank. Use Duplicate this desk in
                                the switcher if you meant to keep the previous canvas.
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
                            <DeskStarterCatalog />
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
