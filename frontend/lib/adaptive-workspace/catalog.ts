import {
    PHASE1_RENDER_TOOLS,
    SURFACE_TOOLS,
    WORKSPACE_HELPER_TOOLS,
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

export function isWorkspaceHelperTool(toolName: string): boolean {
    return (WORKSPACE_HELPER_TOOLS as readonly string[]).includes(toolName);
}

export function isAdaptiveRenderTool(toolName: string): boolean {
    return isPhase1RenderTool(toolName) || isSurfaceTool(toolName) || isWorkspaceHelperTool(toolName);
}

export function componentTypeForTool(toolName: string): AdaptiveComponentType | null {
    return TOOL_COMPONENT_MAP[toolName] ?? null;
}

export function titleForComponentType(type: string, fallback = "Widget"): string {
    switch (type) {
        case "quote-ticker":
            return "Quotes";
        case "quote-chart":
            return "Quotes & chart";
        case "holdings-table":
            return "Portfolio";
        case "price-chart":
            return "Price chart";
        case "broker-health":
            return "Broker health";
        case "watchlist":
            return "Watchlist";
        case "intel-feed":
            return "Market intelligence";
        case "alert-rule-draft":
            return "Alerts";
        case "workflow-graph":
            return "Workflow graph";
        case "workflow-simulation":
            return "Simulation";
        case "approval-card":
            return "Deploy";
        case "micro-app":
            return "Sandbox";
        case "agent-timeline":
            return "Agent timeline";
        case "notes-block":
            return "Notes";
        case "option-chain":
            return "Option chain";
        case "greeks-panel":
            return "Greeks";
        case "margin-scenario":
            return "Margin";
        case "pnl-exposure-strip":
            return "P&L exposure";
        case "market-heatmap":
            return "Heatmap";
        case "portfolio-summary":
            return "Portfolio";
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
        case "quote-chart":
            return { h: 7, w: 12, x: 0, y: 0 };
        case "watchlist":
            return { h: 4, w: 4, x: 0, y: 0 };
        case "intel-feed":
            return { h: 5, w: 6, x: 0, y: 0 };
        case "alert-rule-draft":
            return { h: 4, w: 6, x: 0, y: 0 };
        case "workflow-graph":
            return { h: 5, w: 6, x: 0, y: 0 };
        case "workflow-simulation":
            return { h: 4, w: 6, x: 0, y: 0 };
        case "approval-card":
            return { h: 4, w: 6, x: 0, y: 0 };
        case "micro-app":
            return { h: 5, w: 6, x: 0, y: 0 };
        case "agent-timeline":
            return { h: 4, w: 12, x: 0, y: 0 };
        case "notes-block":
            return { h: 4, w: 4, x: 0, y: 0 };
        case "option-chain":
            return { h: 6, w: 8, x: 0, y: 0 };
        case "greeks-panel":
            return { h: 5, w: 6, x: 0, y: 0 };
        case "margin-scenario":
            return { h: 4, w: 6, x: 0, y: 0 };
        case "pnl-exposure-strip":
            return { h: 4, w: 6, x: 0, y: 0 };
        case "market-heatmap":
            return { h: 6, w: 8, x: 0, y: 0 };
        case "portfolio-summary":
            return { h: 5, w: 12, x: 0, y: 0 };
        default:
            return { h: 3, w: 6, x: 0, y: 0 };
    }
}
