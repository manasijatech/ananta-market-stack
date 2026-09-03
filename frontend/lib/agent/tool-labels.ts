/** Human-facing aliases for stored and streamed tool traces.
 * Keep in sync with backend/app/agent_tools/tool_labels.py.
 */

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
    sandbox_run_python: "Run calculation",
    web_fetch: "Open page",
    web_search: "Web search",
    intel_get_feed: "Market intelligence",
    intel_list_alert_workflows: "List alert workflows",
    intel_list_alert_notifications: "List alert notifications",
    broker_list_accounts: "List broker accounts",
    broker_list_watchlists: "List watchlists",
    broker_get_watchlist_symbols: "Watchlist symbols",
    broker_create_watchlist: "Create watchlist",
    broker_rename_watchlist: "Rename watchlist",
    broker_delete_watchlist: "Delete watchlist",
    broker_add_watchlist_symbols: "Add watchlist symbols",
    broker_replace_watchlist_symbols: "Replace watchlist symbols",
    broker_remove_watchlist_symbols: "Remove watchlist symbols",
    broker_get_session_status: "Broker session",
    broker_verify_connection: "Verify broker",
    broker_run_session_maintenance: "Refresh broker session",
    broker_get_data_capabilities: "Broker capabilities",
    broker_search_instruments: "Search instruments",
    broker_sync_instruments: "Sync instruments",
    broker_get_cached_quotes: "Cached quotes",
    broker_get_quotes: "Live quotes",
    broker_get_ohlc: "OHLC",
    broker_get_historical: "Historical prices",
    broker_get_option_chain: "Option chain",
    broker_get_greeks: "Greeks",
    broker_get_portfolio: "Portfolio",
    broker_get_profile: "Broker profile",
    broker_calculate_margin: "Margin estimate",
    broker_get_stream_status: "Stream status",
    alert_get_studio: "Alert studio",
    alert_refresh_studio: "Refresh alert studio",
    alert_deploy_snapshot: "Deploy alert",
    alert_create_draft: "Draft alert",
    workspace_get_authoring_docs: "Workspace docs",
    workspace_get_current: "Read desk",
    workspace_validate_spec: "Validate desk",
    compose_surface: "Compose desk",
    patch_surface: "Update desk",
    workspace_evaluate_request: "Plan desk",
    workspace_list_templates: "Desk templates",
    workspace_list_skills: "Desk skills",
    workspace_list_saved_desks: "Saved desks",
    workspace_list_preferences: "Desk preferences",
    workspace_export_a2ui: "Export A2UI",
    workspace_validate_a2ui: "Validate A2UI",
    workspace_export_agui: "Export AG-UI",
    workspace_get_micro_app: "Micro-app",
    workspace_publish_html_artifact: "Publish canvas",
    workspace_update_html_artifact: "Update canvas",
    session_search: "Recall from this chat",
    session_expand: "Expand chat recall",
    get_daily_summary: "Daily summary",
    get_news: "News",
    get_top_movers: "Top movers",
    get_price_and_volume: "Price and volume",
    get_events: "Events",
    get_filings: "Filings",
    get_earnings: "Earnings",
    describe_tools: "List MCP tools",
    execute_tool: "Run MCP tool"
};

export function canonicalToolName(toolName: string | null | undefined): string {
    let name = (toolName || "tool").trim() || "tool";
    if (name.includes("__")) {
        name = name.split("__").pop() || name;
    }
    if (name.startsWith("mcp_")) name = name.slice(4);
    return name;
}

export function displayNameForTool(toolName: string | null | undefined, fallback?: string | null): string {
    if (fallback && fallback.trim()) return fallback.trim();
    const name = canonicalToolName(toolName);
    return TOOL_DISPLAY_NAMES[name] || TOOL_DISPLAY_NAMES[name.replace(/-/g, "_")] || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Tool";
}
