import { GRID_COLUMNS, type WorkspacePosition } from "@/service/types/adaptive-workspace";

export const CANVAS_ROW_HEIGHT = 76;
export const CANVAS_GAP = 12;
export const CANVAS_MIN_W = 3;
export const CANVAS_MIN_H = 2;

export function clampPosition(position: WorkspacePosition): WorkspacePosition {
    const w = Math.max(CANVAS_MIN_W, Math.min(GRID_COLUMNS, Math.round(position.w)));
    const h = Math.max(CANVAS_MIN_H, Math.min(24, Math.round(position.h)));
    const x = Math.max(0, Math.min(GRID_COLUMNS - w, Math.round(position.x)));
    const y = Math.max(0, Math.round(position.y));
    return { h, w, x, y };
}

export function pointerDeltaToGrid(
    deltaX: number,
    deltaY: number,
    containerWidth: number
): { dx: number; dy: number } {
    const colWidth = Math.max(1, (containerWidth - CANVAS_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
    return {
        dx: Math.round(deltaX / (colWidth + CANVAS_GAP)),
        dy: Math.round(deltaY / (CANVAS_ROW_HEIGHT + CANVAS_GAP))
    };
}
