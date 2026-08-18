import {
    PHASE1_RENDER_TOOLS,
    SURFACE_TOOLS,
    TOOL_COMPONENT_MAP,
    type AdaptiveComponentType,
    type WorkspacePosition
} from "@/service/types/adaptive-workspace";

export function isPhase1RenderTool(toolName: string): boolean {
    return (PHASE1_RENDER_TOOLS as readonly string[]).includes(toolName);
}

export function isSurfaceTool(toolName: string): boolean {
    return (SURFACE_TOOLS as readonly string[]).includes(toolName);
}

export function isAdaptiveRenderTool(toolName: string): boolean {
    return isPhase1RenderTool(toolName) || isSurfaceTool(toolName);
}

export function componentTypeForTool(toolName: string): AdaptiveComponentType | null {
    return TOOL_COMPONENT_MAP[toolName] ?? null;
}

export function titleForComponentType(type: string, fallback = "Widget"): string {
    switch (type) {
        case "quote-ticker":
            return "Quotes";
        case "holdings-table":
            return "Portfolio";
        case "price-chart":
            return "Price chart";
        case "broker-health":
            return "Broker health";
        default:
            return fallback;
    }
}

export function pinTitleForTool(toolName: string, fallback = "Pinned component"): string {
    return titleForComponentType(componentTypeForTool(toolName) ?? "", fallback);
}

export function defaultSizeForType(type: string): WorkspacePosition {
    switch (type) {
        case "holdings-table":
            return { h: 5, w: 12, x: 0, y: 0 };
        case "price-chart":
            return { h: 4, w: 8, x: 0, y: 0 };
        case "broker-health":
            return { h: 3, w: 4, x: 0, y: 0 };
        case "quote-ticker":
            return { h: 3, w: 6, x: 0, y: 0 };
        default:
            return { h: 3, w: 6, x: 0, y: 0 };
    }
}
