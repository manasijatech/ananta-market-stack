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

export function rectanglesOverlap(left: WorkspacePosition, right: WorkspacePosition): boolean {
    return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

export function expandedSizeForType(type: string): WorkspacePosition {
    switch (type) {
        case "holdings-table":
            return { h: 8, w: 12, x: 0, y: 0 };
        case "price-chart":
            return { h: 6, w: 12, x: 0, y: 0 };
        case "intel-feed":
            return { h: 8, w: 12, x: 0, y: 0 };
        case "watchlist":
            return { h: 8, w: 12, x: 0, y: 0 };
        case "alert-rule-draft":
            return { h: 7, w: 12, x: 0, y: 0 };
        case "quote-ticker":
            return { h: 6, w: 12, x: 0, y: 0 };
        default:
            return { h: 6, w: 12, x: 0, y: 0 };
    }
}

export function placeWithoutOverlap(
    components: Array<{ id: string; position: WorkspacePosition }>,
    id: string,
    position: WorkspacePosition
): Array<{ id: string; position: WorkspacePosition }> {
    const nextPosition = clampPosition(position);
    const moved = components.find((item) => item.id === id);
    if (!moved) return components.map((item) => ({ id: item.id, position: item.position }));
    const placed: Array<{ id: string; position: WorkspacePosition }> = [{ id, position: nextPosition }];
    const others = components
        .filter((item) => item.id !== id)
        .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x);
    for (const item of others) {
        let candidate = clampPosition(item.position);
        let guard = 0;
        while (placed.some((entry) => rectanglesOverlap(entry.position, candidate)) && guard < 240) {
            candidate = clampPosition({ ...candidate, y: candidate.y + 1 });
            guard += 1;
        }
        placed.push({ id: item.id, position: candidate });
    }
    return placed;
}
