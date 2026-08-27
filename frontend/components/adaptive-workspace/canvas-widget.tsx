"use client";

import { useRef, useState, type PointerEvent } from "react";
import {
    IconArrowsMaximize,
    IconArrowsMinimize,
    IconCopy,
    IconGripVertical,
    IconRefresh,
    IconTrash
} from "@tabler/icons-react";
import { LiveCanvasBody } from "@/components/adaptive-workspace/live-canvas-body";
import { WidgetErrorBoundary } from "@/components/adaptive-workspace/widget-error-boundary";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { CANVAS_KIND_LABELS, defaultSizeForType, titleForComponent } from "@/lib/adaptive-workspace/catalog";
import { CANVAS_MIN_H, CANVAS_MIN_W, expandedSizeForType, pointerDeltaToGrid } from "@/lib/adaptive-workspace/layout";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import { cn } from "@/lib/utils";
import type { WorkspaceComponent, WorkspacePosition } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    containerWidth: number;
};

export function AdaptiveCanvasWidget({ component, containerWidth }: Props) {
    const { duplicate, patchComponent, remove, select, selectedId, updatePosition } = useAdaptiveWorkspace();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const locked = prefs?.canvasLocked !== false;
    const selected = !locked && selectedId === component.id;
    const [draft, setDraft] = useState<WorkspacePosition | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const dragRef = useRef<{ kind: "move" | "resize"; startX: number; startY: number; origin: WorkspacePosition } | null>(null);
    const position = draft ?? component.position;
    const expanded = component.props?.expanded === true;
    const kindRaw = typeof component.props?.kind === "string" ? component.props.kind.trim().toLowerCase() : "";
    const kindLabel = component.type === "html-artifact" ? CANVAS_KIND_LABELS[kindRaw] : undefined;

    function beginDrag(kind: "move" | "resize", event: PointerEvent<HTMLElement>) {
        if (locked) return;
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

    function readPosition(value: unknown): WorkspacePosition | null {
        if (!isRecord(value)) return null;
        const { h, w, x, y } = value;
        if ([h, w, x, y].some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
        return { h: h as number, w: w as number, x: x as number, y: y as number };
    }

    function toggleExpanded() {
        if (expanded) {
            const compact = readPosition(component.props?.compactPosition) ?? {
                ...defaultSizeForType(component.type),
                x: component.position.x,
                y: component.position.y
            };
            patchComponent(component.id, {
                position: { ...compact, x: component.position.x, y: component.position.y },
                props: { expanded: false }
            });
            return;
        }
        const size = expandedSizeForType(component.type);
        patchComponent(component.id, {
            position: { ...component.position, h: size.h, w: size.w, x: 0 },
            props: { compactPosition: component.position, expanded: true }
        });
    }

    return (
        <article
            className={cn(
                "group relative isolate z-0 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border/40 bg-card",
                selected ? "z-10 border-primary/70" : ""
            )}
            onClick={() => {
                if (!locked) select(component.id);
            }}
            style={{
                gridColumn: `${position.x + 1} / span ${position.w}`,
                gridRow: `${position.y + 1} / span ${position.h}`
            }}
        >
            <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-2 py-1">
                {locked ? null : (
                    <button
                        aria-label="Drag widget"
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                        onPointerDown={(event) => beginDrag("move", event)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        type="button"
                    >
                        <IconGripVertical className="size-4" stroke={1.8} />
                    </button>
                )}
                <p className="min-w-[4.5rem] flex-1 truncate text-xs font-semibold">
                    {titleForComponent(component.type, component.props, component.type)}
                </p>
                {kindLabel ? (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {kindLabel}
                    </span>
                ) : null}
                {locked ? null : (
                    <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                            aria-label="Refresh widget data"
                            onClick={(event) => {
                                event.stopPropagation();
                                setRefreshNonce((value) => value + 1);
                            }}
                            size="xs"
                            type="button"
                            variant="ghost"
                        >
                            <IconRefresh className="size-3.5" stroke={1.8} />
                        </Button>
                        <Button
                            aria-label={expanded ? "Collapse widget" : "Expand widget"}
                            onClick={(event) => {
                                event.stopPropagation();
                                toggleExpanded();
                            }}
                            size="xs"
                            type="button"
                            variant="ghost"
                        >
                            {expanded ? <IconArrowsMinimize className="size-3.5" stroke={1.8} /> : <IconArrowsMaximize className="size-3.5" stroke={1.8} />}
                        </Button>
                        <Button onClick={() => duplicate(component.id)} size="xs" type="button" variant="ghost">
                            <IconCopy className="size-3.5" stroke={1.8} />
                        </Button>
                        <Button onClick={() => remove(component.id)} size="xs" type="button" variant="ghost">
                            <IconTrash className="size-3.5" stroke={1.8} />
                        </Button>
                    </div>
                )}
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <WidgetErrorBoundary label={titleForComponent(component.type, component.props, component.type)}>
                    <LiveCanvasBody
                        component={component}
                        onPatch={(props) =>
                            patchComponent(
                                component.id,
                                { props },
                                component.type === "notes-block" ? { history: false } : undefined
                            )
                        }
                        refreshNonce={refreshNonce}
                    />
                </WidgetErrorBoundary>
            </div>
            {locked ? null : (
                <button
                    aria-label="Resize widget"
                    className="absolute bottom-1 right-1 size-4 cursor-se-resize rounded-sm border border-border bg-background"
                    onPointerDown={(event) => beginDrag("resize", event)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    type="button"
                />
            )}
        </article>
    );
}
