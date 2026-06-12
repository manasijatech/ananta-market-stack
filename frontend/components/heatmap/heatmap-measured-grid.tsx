"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";

const HOVER_GUTTER = 4;

export function HeatmapMeasuredGrid({ children, dense = false }: { children: ReactNode; dense?: boolean }) {
    const stageRef = useRef<HTMLDivElement>(null);

    const measureLargestTile = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return;

        const tiles = Array.from(stage.querySelectorAll<HTMLElement>("[data-heatmap-tile]"));
        let largestRect: DOMRect | null = null;
        let largestArea = 0;

        for (const tile of tiles) {
            const rect = tile.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > largestArea) {
                largestArea = area;
                largestRect = rect;
            }
        }

        if (!largestRect) return;

        stage.style.setProperty("--heatmap-hover-width", `${Math.round(largestRect.width)}px`);
        stage.style.setProperty("--heatmap-hover-min-height", `${Math.round(largestRect.height)}px`);
    }, []);

    const positionHoverCard = useCallback(() => {
        const stage = stageRef.current;
        const activeElement = document.activeElement;
        const tile =
            activeElement instanceof HTMLElement && activeElement.matches("[data-heatmap-tile]")
                ? activeElement
                : stage?.querySelector<HTMLElement>("[data-heatmap-tile]:hover");

        if (!stage || !tile) return;

        measureLargestTile();

        const stageRect = stage.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const hoverCard = tile.querySelector<HTMLElement>("[data-heatmap-hover-card]");
        const hoverWidth = Number.parseFloat(stage.style.getPropertyValue("--heatmap-hover-width")) || tileRect.width;
        const hoverMinHeight = Number.parseFloat(stage.style.getPropertyValue("--heatmap-hover-min-height")) || tileRect.height;
        const hoverHeight = Math.max(hoverMinHeight, hoverCard?.scrollHeight ?? 0);
        const allowedLeft = stageRect.left + HOVER_GUTTER;
        const allowedTop = stageRect.top + HOVER_GUTTER;
        const allowedRight = stageRect.right - HOVER_GUTTER;
        const allowedBottom = stageRect.bottom - HOVER_GUTTER;
        const preferredLeft = tileRect.left + hoverWidth > allowedRight ? tileRect.right - hoverWidth : tileRect.left;
        const preferredTop = tileRect.top + hoverHeight > allowedBottom ? tileRect.bottom - hoverHeight : tileRect.top;
        const clampedLeft = Math.min(Math.max(preferredLeft, allowedLeft), Math.max(allowedLeft, allowedRight - hoverWidth));
        const clampedTop = Math.min(Math.max(preferredTop, allowedTop), Math.max(allowedTop, allowedBottom - hoverHeight));

        tile.style.setProperty("--heatmap-hover-left", `${Math.round(clampedLeft - tileRect.left)}px`);
        tile.style.setProperty("--heatmap-hover-top", `${Math.round(clampedTop - tileRect.top)}px`);
    }, [measureLargestTile]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;

        measureLargestTile();

        const resizeObserver = new ResizeObserver(() => {
            measureLargestTile();
            positionHoverCard();
        });
        resizeObserver.observe(stage);
        for (const tile of stage.querySelectorAll<HTMLElement>("[data-heatmap-tile]")) {
            resizeObserver.observe(tile);
        }

        return () => resizeObserver.disconnect();
    }, [measureLargestTile, positionHoverCard]);

    return (
        <div
            className={
                dense
                    ? "grid h-full min-h-0 auto-rows-fr grid-cols-4 gap-1 overflow-hidden sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10"
                    : "grid h-full min-h-0 auto-rows-fr grid-cols-3 gap-1 overflow-hidden sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
            }
            onPointerEnter={positionHoverCard}
            onPointerMove={positionHoverCard}
            ref={stageRef}
        >
            {children}
        </div>
    );
}
