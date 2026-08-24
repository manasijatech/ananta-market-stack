"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar } from "@/components/adaptive-workspace/widget-scope-bar";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { resolveWatchlist, useDeskAccounts, useDeskWatchlists, widgetProp } from "@/hooks/use-desk-data";
import { getLiveHeatmap } from "@/service/actions/heatmap";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { HeatmapResponse, HeatmapScope, HeatmapSymbol } from "@/service/types/heatmap";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

function isHeatmapScope(value: string): value is HeatmapScope {
    return value === "tracked" || value === "watchlist" || value === "portfolio_holdings";
}

function heatTone(value?: number | null) {
    const magnitude = Math.abs(value ?? 0);
    if ((value ?? 0) > 0) {
        if (magnitude >= 5) return "hsl(149 72% 30%)";
        if (magnitude >= 2) return "hsl(150 64% 37%)";
        if (magnitude >= 0.5) return "hsl(151 50% 45%)";
        return "hsl(151 36% 55%)";
    }
    if ((value ?? 0) < 0) {
        if (magnitude >= 5) return "hsl(0 70% 37%)";
        if (magnitude >= 2) return "hsl(0 66% 45%)";
        if (magnitude >= 0.5) return "hsl(0 58% 54%)";
        return "hsl(0 42% 62%)";
    }
    return "hsl(220 8% 42% / 0.72)";
}

function formatPercent(value?: number | null) {
    if (value == null || Number.isNaN(value)) return "—";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function CompactTile({ item }: { item: HeatmapSymbol }) {
    return (
        <article
            className="flex min-h-[3.25rem] flex-col justify-between rounded-md border border-white/15 p-1.5 text-white shadow-sm"
            style={{ backgroundColor: heatTone(item.day_change_perc) }}
        >
            <p className="truncate text-[11px] font-extrabold leading-none">{item.symbol}</p>
            <p className="font-mono text-[12px] font-semibold leading-none">{formatPercent(item.day_change_perc)}</p>
        </article>
    );
}

export function LiveHeatmapWidget({ component, onPatch, refreshNonce }: Props) {
    const { spec } = useAdaptiveWorkspace();
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const requestedScope = String(widgetProp(component, "heatmapScope") ?? widgetProp(component, "scope") ?? "tracked");
    const scope: HeatmapScope = isHeatmapScope(requestedScope)
        ? requestedScope
        : requestedScope === "watchlist"
          ? "watchlist"
          : requestedScope === "desk" || requestedScope === "symbol"
            ? "tracked"
            : "tracked";
    const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void getLiveHeatmap({
            account_id: scope === "portfolio_holdings" ? account?.id : null,
            days: 1,
            limit: 36,
            scope,
            watchlist_id: scope === "watchlist" ? watchlist?.id : null
        })
            .then((next) => {
                if (cancelled) return;
                setHeatmap(next);
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load heatmap.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account?.id, refreshNonce, scope, watchlist?.id]);

    const cards = useMemo(
        () =>
            [...(heatmap?.items ?? [])].sort(
                (left, right) => Math.abs(right.day_change_perc ?? 0) - Math.abs(left.day_change_perc ?? 0) || left.symbol.localeCompare(right.symbol)
            ),
        [heatmap]
    );
    const advancing = cards.filter((item) => (item.day_change_perc ?? 0) > 0).length;
    const declining = cards.filter((item) => (item.day_change_perc ?? 0) < 0).length;

    return (
        <WidgetState error={error || accountError} loading={loading} loadingLabel="Loading heatmap">
            <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5">
                <SimpleSelect
                    aria-label="Heatmap scope"
                    className="h-7 min-w-[8.5rem]"
                    onValueChange={(value) => onPatch({ heatmapScope: value })}
                    options={[
                        { label: "Tracked", value: "tracked" },
                        { label: "Watchlist", value: "watchlist" },
                        { label: "Holdings", value: "portfolio_holdings" }
                    ]}
                    size="sm"
                    value={scope}
                />
                {scope === "watchlist" ? (
                    <WidgetScopeBar
                        allowDesk={false}
                        allowMultiSymbol={false}
                        component={component}
                        extraSymbols={spec.universe?.symbols ?? []}
                        onPatch={onPatch}
                        selectedWatchlist={watchlist}
                        symbol=""
                        watchlists={watchlists}
                    />
                ) : null}
                <p className="ml-auto text-[11px] text-muted-foreground">
                    {advancing} up · {declining} down
                </p>
                <LiveStatusBadge label={heatmap?.scope_label || "Heatmap"} tone={cards.length ? "live" : "idle"} />
            </div>
            {!cards.length ? (
                <p className="p-3 text-sm text-muted-foreground">
                    {heatmap?.scope_label
                        ? `No live quotes for ${heatmap.scope_label} on this broker yet.`
                        : "Connect a broker session to render a live heatmap."}
                </p>
            ) : (
                <div className="min-h-0 flex-1 overflow-auto p-2">
                    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
                        {cards.slice(0, 36).map((item) => (
                            <CompactTile item={item} key={`${item.symbol}:${item.exchange ?? ""}`} />
                        ))}
                    </div>
                </div>
            )}
        </WidgetState>
    );
}
