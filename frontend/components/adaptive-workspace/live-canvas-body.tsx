"use client";

import { LiveAlertsWidget } from "@/components/adaptive-workspace/live-alerts-widget";
import { LiveChartWidget } from "@/components/adaptive-workspace/live-chart-widget";
import { LiveIntelWidget } from "@/components/adaptive-workspace/live-intel-widget";
import { LiveHealthWidget, LiveHoldingsWidget } from "@/components/adaptive-workspace/live-portfolio-widgets";
import { LiveQuotesWidget } from "@/components/adaptive-workspace/live-quotes-widget";
import { LiveWatchlistWidget } from "@/components/adaptive-workspace/live-watchlist-widget";
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
            return <LiveAlertsWidget component={component} refreshNonce={refreshNonce} />;
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
        default:
            return <p className="p-3 text-sm text-muted-foreground">This widget type does not have a live renderer yet.</p>;
    }
}
