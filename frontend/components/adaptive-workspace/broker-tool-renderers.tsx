import type { ComponentType } from "react";
import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { AlertInboxCard } from "@/components/adaptive-workspace/alert-inbox-card";
import { AlertStudioCard } from "@/components/adaptive-workspace/alert-studio-card";
import { ComposeSurfaceCard } from "@/components/adaptive-workspace/compose-surface-card";
import { HoldingsTableCard } from "@/components/adaptive-workspace/holdings-table-card";
import { IntelFeedCard } from "@/components/adaptive-workspace/intel-feed-card";
import { PriceChartCard } from "@/components/adaptive-workspace/price-chart-card";
import { QuoteTickerCard } from "@/components/adaptive-workspace/quote-ticker-card";
import { SessionStatusCard } from "@/components/adaptive-workspace/session-status-card";
import { WatchlistCard } from "@/components/adaptive-workspace/watchlist-card";
import { WorkspaceHelperCard } from "@/components/adaptive-workspace/workspace-helper-card";

export const adaptiveBrokerToolRenderers: Record<string, ComponentType<CustomToolRendererProps>> = {
    broker_get_cached_quotes: QuoteTickerCard,
    broker_get_historical: PriceChartCard,
    broker_get_ohlc: QuoteTickerCard,
    broker_get_portfolio: HoldingsTableCard,
    broker_get_quotes: QuoteTickerCard,
    broker_get_session_status: SessionStatusCard,
    broker_verify_connection: SessionStatusCard,
    broker_list_watchlists: WatchlistCard,
    broker_get_watchlist_symbols: WatchlistCard,
    intel_get_feed: IntelFeedCard,
    intel_list_alert_workflows: AlertInboxCard,
    intel_list_alert_notifications: AlertInboxCard,
    alert_get_studio: AlertStudioCard,
    alert_refresh_studio: AlertStudioCard,
    alert_deploy_snapshot: AlertStudioCard,
    compose_surface: ComposeSurfaceCard,
    patch_surface: ComposeSurfaceCard,
    workspace_get_authoring_docs: WorkspaceHelperCard,
    workspace_get_current: WorkspaceHelperCard,
    workspace_validate_spec: WorkspaceHelperCard,
    workspace_evaluate_request: WorkspaceHelperCard,
    workspace_list_templates: WorkspaceHelperCard,
    workspace_list_skills: WorkspaceHelperCard,
    workspace_list_saved_desks: WorkspaceHelperCard,
    workspace_list_preferences: WorkspaceHelperCard,
    workspace_get_micro_app: WorkspaceHelperCard
};
