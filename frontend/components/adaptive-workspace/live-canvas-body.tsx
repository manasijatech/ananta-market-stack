"use client";

import { LiveAlertDraftWidget } from "@/components/adaptive-workspace/live-alert-draft-widget";
import { LiveAlertsWidget } from "@/components/adaptive-workspace/live-alerts-widget";
import { LiveAgentTimelineWidget } from "@/components/adaptive-workspace/live-agent-timeline-widget";
import { LiveApprovalCardWidget } from "@/components/adaptive-workspace/live-approval-card-widget";
import { LiveChartWidget } from "@/components/adaptive-workspace/live-chart-widget";
import { LiveGreeksWidget } from "@/components/adaptive-workspace/live-greeks-widget";
import { LiveHeatmapWidget } from "@/components/adaptive-workspace/live-heatmap-widget";
import { LiveHtmlArtifactWidget } from "@/components/adaptive-workspace/live-html-artifact-widget";
import { LiveIntelWidget } from "@/components/adaptive-workspace/live-intel-widget";
import { LiveMarginWidget } from "@/components/adaptive-workspace/live-margin-widget";
import { LiveMicroAppWidget } from "@/components/adaptive-workspace/live-micro-app-widget";
import { LiveNotesWidget } from "@/components/adaptive-workspace/live-notes-widget";
import { LiveOptionChainWidget } from "@/components/adaptive-workspace/live-option-chain-widget";
import { LivePnlWidget } from "@/components/adaptive-workspace/live-pnl-widget";
import { LiveHealthWidget, LiveHoldingsWidget } from "@/components/adaptive-workspace/live-portfolio-widgets";
import { LiveQuoteChartWidget } from "@/components/adaptive-workspace/live-quote-chart-widget";
import { LiveQuotesWidget } from "@/components/adaptive-workspace/live-quotes-widget";
import { LiveWatchlistWidget } from "@/components/adaptive-workspace/live-watchlist-widget";
import { LiveWorkflowGraphWidget } from "@/components/adaptive-workspace/live-workflow-graph-widget";
import { LiveWorkflowSimulationWidget } from "@/components/adaptive-workspace/live-workflow-simulation-widget";
import { SuppressPin } from "@/components/adaptive-workspace/tool-card-shell";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export function LiveCanvasBody({ component, onPatch, refreshNonce }: Props) {
    switch (component.type) {
        case "watchlist":
            return <LiveWatchlistWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "quote-ticker":
            return <LiveQuotesWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "quote-chart":
            return <LiveQuoteChartWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "intel-feed":
            return <LiveIntelWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "alert-rule-draft":
            if (component.data?.tool === "alert_get_studio") {
                return <LiveAlertDraftWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
            }
            return <LiveAlertsWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "workflow-graph":
            return <LiveWorkflowGraphWidget component={component} refreshNonce={refreshNonce} />;
        case "workflow-simulation":
            return <LiveWorkflowSimulationWidget component={component} refreshNonce={refreshNonce} />;
        case "approval-card":
            return <LiveApprovalCardWidget component={component} refreshNonce={refreshNonce} />;
        case "holdings-table":
        case "portfolio-summary":
            return (
                <SuppressPin>
                    <LiveHoldingsWidget refreshNonce={refreshNonce} />
                </SuppressPin>
            );
        case "pnl-exposure-strip":
            return (
                <SuppressPin>
                    <LivePnlWidget refreshNonce={refreshNonce} />
                </SuppressPin>
            );
        case "option-chain":
            return <LiveOptionChainWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "greeks-panel":
            return <LiveGreeksWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "margin-scenario":
            return <LiveMarginWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "market-heatmap":
            return <LiveHeatmapWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "broker-health":
            return (
                <SuppressPin>
                    <LiveHealthWidget refreshNonce={refreshNonce} />
                </SuppressPin>
            );
        case "price-chart":
            return <LiveChartWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "micro-app":
            return <LiveMicroAppWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "html-artifact":
            return <LiveHtmlArtifactWidget component={component} />;
        case "notes-block":
            return <LiveNotesWidget component={component} onPatch={onPatch} />;
        case "agent-timeline":
            return <LiveAgentTimelineWidget />;
        default:
            return <p className="p-3 text-sm text-muted-foreground">This widget type does not have a live renderer yet.</p>;
    }
}
