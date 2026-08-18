"use client";

import { useRef, useState, type PointerEvent } from "react";
import {
    IconCopy,
    IconGripVertical,
    IconRefresh,
    IconTrash
} from "@tabler/icons-react";
import { adaptiveBrokerToolRenderers } from "@/components/adaptive-workspace/broker-tool-renderers";
import { SuppressPin } from "@/components/adaptive-workspace/tool-card-shell";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { titleForComponentType } from "@/lib/adaptive-workspace/catalog";
import { CANVAS_MIN_H, CANVAS_MIN_W, pointerDeltaToGrid } from "@/lib/adaptive-workspace/layout";
import { cn } from "@/lib/utils";
import type { WorkspaceComponent, WorkspacePosition } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    containerWidth: number;
    onRefresh: (prompt: string) => void;
};

export function AdaptiveCanvasWidget({ component, containerWidth, onRefresh }: Props) {
    const { duplicate, outputs, remove, select, selectedId, updatePosition } = useAdaptiveWorkspace();
    const selected = selectedId === component.id;
    const [draft, setDraft] = useState<WorkspacePosition | null>(null);
    const dragRef = useRef<{ kind: "move" | "resize"; startX: number; startY: number; origin: WorkspacePosition } | null>(null);
    const position = draft ?? component.position;
    const cached = outputs[component.id];
    const toolName = cached?.toolName ?? component.data?.tool ?? "";
    const Renderer = toolName ? adaptiveBrokerToolRenderers[toolName] : null;

    function beginDrag(kind: "move" | "resize", event: PointerEvent<HTMLElement>) {
        event.preventDefault();
        event.stopPropagation();
        select(component.id);
        dragRef.current = {
            kind,
            origin: component.position,
            startX: event.clientX,
            startY: event.clientY
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent<HTMLElement>) {
        const drag = dragRef.current;
        if (!drag) return;
        const { dx, dy } = pointerDeltaToGrid(event.clientX - drag.startX, event.clientY - drag.startY, containerWidth);
        if (drag.kind === "move") {
            setDraft({
                ...drag.origin,
                x: drag.origin.x + dx,
                y: Math.max(0, drag.origin.y + dy)
            });
            return;
        }
        setDraft({
            ...drag.origin,
            h: Math.max(CANVAS_MIN_H, drag.origin.h + dy),
            w: Math.max(CANVAS_MIN_W, drag.origin.w + dx)
        });
    }

    function onPointerUp() {
        const next = draft;
        dragRef.current = null;
        setDraft(null);
        if (next) updatePosition(component.id, next);
    }

    return (
        <article
            className={cn(
                "group relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
                selected ? "border-primary shadow-sm" : "border-border"
            )}
            onClick={() => select(component.id)}
            style={{
                gridColumn: `${position.x + 1} / span ${position.w}`,
                gridRow: `${position.y + 1} / span ${position.h}`
            }}
        >
            <header className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                <button
                    aria-label="Drag widget"
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                    onPointerDown={(event) => beginDrag("move", event)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    type="button"
                >
                    <IconGripVertical className="size-4" stroke={1.8} />
                </button>
                <p className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {titleForComponentType(component.type, component.type)}
                </p>
                <Button
                    onClick={() =>
                        onRefresh(
                            `Refresh the ${titleForComponentType(component.type, component.type)} widget ${component.id}${
                                toolName ? ` using ${toolName}` : ""
                            }.`
                        )
                    }
                    size="xs"
                    type="button"
                    variant="ghost"
                >
                    <IconRefresh className="size-3.5" stroke={1.8} />
                </Button>
                <Button onClick={() => duplicate(component.id)} size="xs" type="button" variant="ghost">
                    <IconCopy className="size-3.5" stroke={1.8} />
                </Button>
                <Button onClick={() => remove(component.id)} size="xs" type="button" variant="ghost">
                    <IconTrash className="size-3.5" stroke={1.8} />
                </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
                <SuppressPin>
                    {Renderer && cached ? (
                        <Renderer input={cached.input} name={toolName} output={cached.output} status="success" />
                    ) : Renderer && component.data ? (
                        <div className="p-3 text-sm text-muted-foreground">
                            Bound to <span className="font-mono">{component.data.tool}</span>. Ask chat to load this widget.
                        </div>
                    ) : (
                        <div className="p-3 text-sm text-muted-foreground">No live data on this widget yet. Pin a card or ask the agent to compose it.</div>
                    )}
                </SuppressPin>
            </div>
            <button
                aria-label="Resize widget"
                className="absolute bottom-1 right-1 size-4 cursor-se-resize rounded-sm border border-border bg-background"
                onPointerDown={(event) => beginDrag("resize", event)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                type="button"
            />
        </article>
    );
}
