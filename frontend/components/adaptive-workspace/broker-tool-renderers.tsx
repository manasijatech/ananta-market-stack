import type { ComponentType } from "react";
import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ComposeSurfaceCard } from "@/components/adaptive-workspace/compose-surface-card";
import { HoldingsTableCard } from "@/components/adaptive-workspace/holdings-table-card";
import { PriceChartCard } from "@/components/adaptive-workspace/price-chart-card";
import { QuoteTickerCard } from "@/components/adaptive-workspace/quote-ticker-card";
import { SessionStatusCard } from "@/components/adaptive-workspace/session-status-card";
import { WorkspaceHelperCard } from "@/components/adaptive-workspace/workspace-helper-card";

export const adaptiveBrokerToolRenderers: Record<string, ComponentType<CustomToolRendererProps>> = {
    broker_get_cached_quotes: QuoteTickerCard,
    broker_get_historical: PriceChartCard,
    broker_get_ohlc: QuoteTickerCard,
    broker_get_portfolio: HoldingsTableCard,
    broker_get_quotes: QuoteTickerCard,
    broker_get_session_status: SessionStatusCard,
    broker_verify_connection: SessionStatusCard,
    compose_surface: ComposeSurfaceCard,
    patch_surface: ComposeSurfaceCard,
    workspace_get_authoring_docs: WorkspaceHelperCard,
    workspace_get_current: WorkspaceHelperCard,
    workspace_validate_spec: WorkspaceHelperCard
};
