"use client";

import { LiveAlertDraftWidget } from "@/components/adaptive-workspace/live-alert-draft-widget";
import { LiveAlertsWidget } from "@/components/adaptive-workspace/live-alerts-widget";
import { LiveAgentTimelineWidget } from "@/components/adaptive-workspace/live-agent-timeline-widget";
import { LiveApprovalCardWidget } from "@/components/adaptive-workspace/live-approval-card-widget";
import { LiveChartWidget } from "@/components/adaptive-workspace/live-chart-widget";
import { LiveIntelWidget } from "@/components/adaptive-workspace/live-intel-widget";
import { LiveMicroAppWidget } from "@/components/adaptive-workspace/live-micro-app-widget";
import { LiveNotesWidget } from "@/components/adaptive-workspace/live-notes-widget";
import { LiveHealthWidget, LiveHoldingsWidget } from "@/components/adaptive-workspace/live-portfolio-widgets";
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
            return <LiveQuotesWidget component={component} refreshNonce={refreshNonce} />;
        case "intel-feed":
            return <LiveIntelWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "alert-rule-draft":
            if (component.data?.tool === "alert_get_studio") {
                return <LiveAlertDraftWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
            }
            return <LiveAlertsWidget component={component} refreshNonce={refreshNonce} />;
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
        case "broker-health":
            return (
                <SuppressPin>
                    <LiveHealthWidget refreshNonce={refreshNonce} />
                </SuppressPin>
            );
        case "price-chart":
            return <LiveChartWidget component={component} refreshNonce={refreshNonce} />;
        case "micro-app":
            return <LiveMicroAppWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />;
        case "notes-block":
            return <LiveNotesWidget component={component} />;
        case "agent-timeline":
            return <LiveAgentTimelineWidget />;
        default:
            return <p className="p-3 text-sm text-muted-foreground">This widget type does not have a live renderer yet.</p>;
    }
}
