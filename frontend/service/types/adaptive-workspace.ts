export const WORKSPACE_SPEC_VERSION = "1" as const;
export const GRID_COLUMNS = 12;

export const ADAPTIVE_COMPONENT_TYPES = [
    "portfolio-summary",
    "holdings-table",
    "pnl-exposure-strip",
    "price-chart",
    "quote-ticker",
    "watchlist",
    "market-heatmap",
    "option-chain",
    "greeks-panel",
    "margin-scenario",
    "broker-health",
    "intel-feed",
    "alert-rule-draft",
    "workflow-graph",
    "workflow-simulation",
    "agent-timeline",
    "approval-card",
    "notes-block"
] as const;

export type AdaptiveComponentType = (typeof ADAPTIVE_COMPONENT_TYPES)[number];

export const ALLOWED_DATA_TOOLS = [
    "broker_get_quotes",
    "broker_get_cached_quotes",
    "broker_get_ohlc",
    "broker_get_historical",
    "broker_get_portfolio",
    "broker_get_session_status",
    "broker_verify_connection",
    "broker_get_option_chain",
    "broker_get_greeks",
    "broker_calculate_margin",
    "broker_list_watchlists",
    "broker_get_watchlist_symbols",
    "broker_get_data_capabilities",
    "broker_list_accounts"
] as const;

export type AdaptiveDataTool = (typeof ALLOWED_DATA_TOOLS)[number];

export const ALLOWED_ACTIONS = [
    "pin",
    "unpin",
    "refresh",
    "create-alert",
    "open-broker",
    "select",
    "remove",
    "duplicate"
] as const;

export type AdaptiveAction = (typeof ALLOWED_ACTIONS)[number];

export const TOOL_COMPONENT_MAP: Record<string, AdaptiveComponentType> = {
    broker_get_quotes: "quote-ticker",
    broker_get_cached_quotes: "quote-ticker",
    broker_get_historical: "price-chart",
    broker_get_ohlc: "quote-ticker",
    broker_get_portfolio: "holdings-table",
    broker_get_session_status: "broker-health",
    broker_verify_connection: "broker-health",
    broker_get_option_chain: "option-chain",
    broker_get_greeks: "greeks-panel",
    broker_calculate_margin: "margin-scenario",
    broker_list_watchlists: "watchlist",
    broker_get_watchlist_symbols: "watchlist"
};

export const PHASE1_RENDER_TOOLS = [
    "broker_get_quotes",
    "broker_get_cached_quotes",
    "broker_get_ohlc",
    "broker_get_historical",
    "broker_get_portfolio",
    "broker_get_session_status",
    "broker_verify_connection"
] as const;

export const SURFACE_TOOLS = ["compose_surface", "patch_surface"] as const;

export interface WorkspaceLayout {
    mode: "grid";
    columns: 12;
}

export interface WorkspacePosition {
    h: number;
    w: number;
    x: number;
    y: number;
}

export interface WorkspaceDataRef {
    params?: Record<string, unknown>;
    tool: string;
}

export interface WorkspaceComponent {
    actions?: string[];
    data?: WorkspaceDataRef | null;
    id: string;
    position: WorkspacePosition;
    props?: Record<string, unknown>;
    type: string;
}

export interface WorkspaceSpec {
    components: WorkspaceComponent[];
    layout: WorkspaceLayout;
    title: string;
    version: "1";
}

export interface WorkspaceAccountMeta {
    account_id?: string | null;
    broker_code?: string | null;
    label?: string | null;
}

export interface WorkspaceProvenance {
    account?: WorkspaceAccountMeta | null;
    asOf?: string | null;
    freshnessLabel?: string;
    source: "live" | "cached" | "model" | "unknown";
    toolName: string;
}

export interface PinnedWorkspaceItem {
    id: string;
    input: Record<string, unknown>;
    output: unknown;
    pinnedAt: string;
    title: string;
    toolName: string;
    type: AdaptiveComponentType;
}

export interface WorkspaceSpecIssue {
    message: string;
    path: string;
}

export interface WorkspaceWidgetOutput {
    input: Record<string, unknown>;
    output: unknown;
    toolName: string;
}

export interface AdaptiveWorkspaceSnapshot {
    applied_at?: string | null;
    created_at: string;
    id: string;
    label: string;
    session_id: string;
    user_id: string;
    valid: boolean;
    validation: Record<string, unknown>;
    version: number;
    workspace_payload: WorkspaceSpec;
}

export interface AdaptiveWorkspaceCurrent {
    snapshot: AdaptiveWorkspaceSnapshot | null;
    spec: WorkspaceSpec;
}
