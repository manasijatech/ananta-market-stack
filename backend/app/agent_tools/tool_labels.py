"""Human-facing aliases for stored and streamed tool traces.

Keep in sync with frontend/lib/agent/tool-labels.ts.
"""

from __future__ import annotations

from typing import Any

TOOL_DISPLAY_NAMES: dict[str, str] = {
    "sandbox_run_python": "Run calculation",
    "web_fetch": "Open page",
    "web_search": "Web search",
    "intel_get_feed": "Market intelligence",
    "intel_list_alert_workflows": "List alert workflows",
    "intel_list_alert_notifications": "List alert notifications",
    "broker_list_accounts": "List broker accounts",
    "broker_list_watchlists": "List watchlists",
    "broker_get_watchlist_symbols": "Watchlist symbols",
    "broker_create_watchlist": "Create watchlist",
    "broker_rename_watchlist": "Rename watchlist",
    "broker_delete_watchlist": "Delete watchlist",
    "broker_add_watchlist_symbols": "Add watchlist symbols",
    "broker_replace_watchlist_symbols": "Replace watchlist symbols",
    "broker_remove_watchlist_symbols": "Remove watchlist symbols",
    "broker_get_session_status": "Broker session",
    "broker_verify_connection": "Verify broker",
    "broker_run_session_maintenance": "Refresh broker session",
    "broker_get_data_capabilities": "Broker capabilities",
    "broker_search_instruments": "Search instruments",
    "broker_sync_instruments": "Sync instruments",
    "broker_get_cached_quotes": "Cached quotes",
    "broker_get_quotes": "Live quotes",
    "broker_get_ohlc": "OHLC",
    "broker_get_historical": "Historical prices",
    "broker_get_option_chain": "Option chain",
    "broker_get_greeks": "Greeks",
    "broker_get_portfolio": "Portfolio",
    "broker_get_profile": "Broker profile",
    "broker_calculate_margin": "Margin estimate",
    "broker_get_stream_status": "Stream status",
    "alert_get_studio": "Alert studio",
    "alert_refresh_studio": "Refresh alert studio",
    "alert_deploy_snapshot": "Deploy alert",
    "alert_create_draft": "Draft alert",
    "workspace_get_authoring_docs": "Workspace docs",
    "workspace_get_current": "Read desk",
    "workspace_validate_spec": "Validate desk",
    "compose_surface": "Compose desk",
    "patch_surface": "Update desk",
    "workspace_evaluate_request": "Plan desk",
    "workspace_list_templates": "Desk templates",
    "workspace_list_skills": "Desk skills",
    "workspace_list_saved_desks": "Saved desks",
    "workspace_list_preferences": "Desk preferences",
    "workspace_export_a2ui": "Export A2UI",
    "workspace_validate_a2ui": "Validate A2UI",
    "workspace_export_agui": "Export AG-UI",
    "workspace_get_micro_app": "Micro-app",
    "workspace_publish_html_artifact": "Publish canvas",
    "workspace_update_html_artifact": "Update canvas",
    "session_search": "Recall from this chat",
    "session_expand": "Expand chat recall",
    "get_daily_summary": "Daily summary",
    "get_news": "News",
    "get_top_movers": "Top movers",
    "get_price_and_volume": "Price and volume",
    "get_events": "Events",
    "get_filings": "Filings",
    "get_earnings": "Earnings",
    "describe_tools": "List MCP tools",
    "execute_tool": "Run MCP tool",
}


def canonical_tool_name(tool_name: str | None) -> str:
    name = (tool_name or "tool").strip() or "tool"
    if "__" in name:
        name = name.rsplit("__", 1)[-1]
    if name.startswith("mcp_"):
        name = name[4:]
    return name


def display_name_for_tool(tool_name: str | None) -> str:
    name = canonical_tool_name(tool_name)
    if name in TOOL_DISPLAY_NAMES:
        return TOOL_DISPLAY_NAMES[name]
    pretty = name.replace("-", "_")
    if pretty in TOOL_DISPLAY_NAMES:
        return TOOL_DISPLAY_NAMES[pretty]
    return pretty.replace("_", " ").strip().title() or "Tool"


def decorate_tool_payload(tool_name: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    decorated = dict(payload)
    label = display_name_for_tool(tool_name)
    decorated["tool_name"] = tool_name or decorated.get("tool_name") or "tool"
    decorated["display_name"] = label
    decorated["tool_alias"] = label
    return decorated
