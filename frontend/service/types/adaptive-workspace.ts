export const WORKSPACE_SPEC_VERSION = "1" as const;
export const GRID_COLUMNS = 12;

export const ADAPTIVE_COMPONENT_TYPES = [
    "portfolio-summary",
    "holdings-table",
    "pnl-exposure-strip",
    "price-chart",
    "quote-ticker",
    "quote-chart",
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
    "notes-block",
    "micro-app"
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
    "broker_list_accounts",
    "intel_get_feed",
    "intel_list_alert_workflows",
    "intel_list_alert_notifications",
    "alert_get_studio",
    "workspace_get_micro_app"
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
    "duplicate",
    "deploy-alert"
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
    broker_get_watchlist_symbols: "watchlist",
    intel_get_feed: "intel-feed",
    intel_list_alert_workflows: "alert-rule-draft",
    intel_list_alert_notifications: "alert-rule-draft",
    alert_get_studio: "alert-rule-draft",
    workspace_get_micro_app: "micro-app"
};

export const PHASE1_RENDER_TOOLS = [
    "broker_get_quotes",
    "broker_get_cached_quotes",
    "broker_get_ohlc",
    "broker_get_historical",
    "broker_get_portfolio",
    "broker_get_session_status",
    "broker_verify_connection",
    "broker_list_watchlists",
    "broker_get_watchlist_symbols",
    "intel_get_feed",
    "intel_list_alert_workflows",
    "intel_list_alert_notifications",
    "alert_get_studio",
    "alert_refresh_studio",
    "alert_deploy_snapshot"
] as const;

export const SURFACE_TOOLS = ["compose_surface", "patch_surface"] as const;

export const WORKSPACE_HELPER_TOOLS = [
    "workspace_get_authoring_docs",
    "workspace_get_current",
    "workspace_validate_spec",
    "workspace_evaluate_request",
    "workspace_list_templates",
    "workspace_list_skills",
    "workspace_list_saved_desks",
    "workspace_list_preferences",
    "workspace_get_micro_app"
] as const;

export const MICRO_APP_IDS = ["payoff-diagram", "notes-scratch"] as const;
export type MicroAppId = (typeof MICRO_APP_IDS)[number];
export const A2UI_VERSION = "v0.9";
export const A2UI_CATALOG_ID = "ananta-workspace-v1";
export const A2UI_ROOT_ID = "a2ui-root";

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

export interface AdaptiveWorkspaceSavedDesk {
    created_at: string;
    id: string;
    name: string;
    updated_at: string;
    user_id: string;
    valid: boolean;
    validation: Record<string, unknown>;
    workspace_payload: WorkspaceSpec;
}

export interface AdaptiveWorkspacePreference {
    deletable: boolean;
    key: string;
    updated_at: string;
    value: unknown;
}

export interface AdaptiveWorkspaceSuggestion {
    auto_apply: boolean;
    id: string;
    kind: "skill" | "template";
    label?: string;
    message: string;
    target_id: string;
}

export interface AdaptiveWorkspaceCatalogItem {
    description: string;
    id: string;
    label: string;
    spec: WorkspaceSpec;
}

export interface AdaptiveAlertStudioWorkflow {
    id?: string | null;
    name?: string | null;
    status?: string | null;
    symbol?: string | null;
}

export interface AdaptiveAlertStudio {
    applied_at?: string | null;
    compile: Record<string, unknown>;
    diff: Record<string, unknown>;
    explanation: Record<string, unknown>;
    graph_dsl: {
        edges: Array<{ source?: string; target?: string }>;
        nodes: Array<{ id?: string; kind?: string; label?: string }>;
    };
    name: string;
    samples: Record<string, unknown>;
    session_id?: string | null;
    snapshot_id?: string | null;
    source: "snapshot" | "workflow" | "empty";
    status: string;
    valid: boolean;
    validation: Record<string, unknown>;
    workflow_id?: string | null;
    workflow_payload: Record<string, unknown>;
    workflows: AdaptiveAlertStudioWorkflow[];
}
