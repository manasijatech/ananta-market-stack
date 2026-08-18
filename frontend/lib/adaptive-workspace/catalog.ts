import {
    PHASE1_RENDER_TOOLS,
    TOOL_COMPONENT_MAP,
    type AdaptiveComponentType
} from "@/service/types/adaptive-workspace";

export function isPhase1RenderTool(toolName: string): boolean {
    return (PHASE1_RENDER_TOOLS as readonly string[]).includes(toolName);
}

export function componentTypeForTool(toolName: string): AdaptiveComponentType | null {
    return TOOL_COMPONENT_MAP[toolName] ?? null;
}

export function pinTitleForTool(toolName: string, fallback = "Pinned component"): string {
    switch (componentTypeForTool(toolName)) {
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
