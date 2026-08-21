"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import {
    ChartSeriesLegend,
    OverlayLineChart,
    candlePoints,
    chartSymbolsFromComponent,
    historyDaysFromComponent,
    seriesColor,
    useMarketCandles
} from "@/components/adaptive-workspace/live-chart-widget";
import {
    QuotesMoveTable,
    buildQuoteMoveRows,
    instrumentsForComponent
} from "@/components/adaptive-workspace/live-quotes-widget";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import {
    WidgetScopeBar,
    readHiddenSymbols,
    scopeHint,
    toggleHiddenSymbol
} from "@/components/adaptive-workspace/widget-scope-bar";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import {
    instrumentForSymbol,
    resolveWatchlist,
    symbolsFromComponent,
    useDeskAccounts,
    useDeskWatchlists,
    widgetProp
} from "@/hooks/use-desk-data";
import { useLivePrices } from "@/hooks/use-live-prices";
import { useQuoteSnapshots } from "@/hooks/use-quote-snapshots";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { InstrumentRef } from "@/service/types/broker";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

function boolProp(component: WorkspaceComponent, key: string, fallback: boolean): boolean {
    const value = widgetProp(component, key);
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
    return fallback;
}

export function LiveQuoteChartWidget({ component, onPatch, refreshNonce }: Props) {
    const { resolvedTheme } = useTheme();
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const instruments = useMemo(
        () => instrumentsForComponent(component, watchlist, watchlists),
        [component, watchlist, watchlists]
    );
    const boundSymbols = symbolsFromComponent(component, watchlist);
    const hiddenList = readHiddenSymbols(component);
    const hiddenKey = hiddenList.join("|");
    const hidden = useMemo(() => new Set(hiddenKey ? hiddenKey.split("|") : []), [hiddenKey]);
    const showQuotes = boolProp(component, "showQuotes", true);
    const showChart = boolProp(component, "showChart", true);
    const historyDays = historyDaysFromComponent(component);
    const visibleChartSymbols = chartSymbolsFromComponent(component, boundSymbols, hidden);
    const { error: quoteError, rows: snapshots } = useQuoteSnapshots(account?.id, instruments, refreshNonce);
    const demand = useMemo(
        () =>
            instruments.slice(0, 40).flatMap((item) => {
                const symbol = String(item.symbol ?? "").trim();
                if (!symbol) return [];
                return [
                    {
                        account_id: account?.id,
                        broker_code: account?.broker_code,
                        exchange: item.exchange,
                        instrument_ref: item,
                        symbol
                    }
                ];
            }),
        [account?.broker_code, account?.id, instruments]
    );
    const live = useLivePrices(demand, `quote-chart:${component.id}`, account?.user_id);
    const tableRows = buildQuoteMoveRows(instruments, snapshots, live, account, hidden);
    const chartRequests = useMemo(
        () =>
            visibleChartSymbols.map((symbol) => ({
                instrument: instrumentForSymbol(watchlists, symbol, component) as InstrumentRef,
                symbol
            })),
        [component, visibleChartSymbols, watchlists]
    );
    const { error: chartError, loading: chartLoading, rows: candleRows } = useMarketCandles(
        showChart ? account?.id : undefined,
        showChart ? chartRequests : [],
        historyDays,
        refreshNonce
    );
    const dark = resolvedTheme === "dark";
    const overlayOrder = chartSymbolsFromComponent(component, boundSymbols, new Set());
    const series = candleRows.map((row) => {
        const index = overlayOrder.indexOf(row.symbol);
        return {
            color: seriesColor(index < 0 ? 0 : index, dark),
            points: candlePoints(row.candles),
            symbol: row.symbol
        };
    });
    const hasPoints = series.some((item) => item.points.length);
    const legendItems = overlayOrder.map((item, index) => {
        const fetched = candleRows.find((row) => row.symbol === item);
        const instrument = instrumentForSymbol(watchlists, item, component) as InstrumentRef;
        return {
            color: seriesColor(index, dark),
            exchange: fetched?.exchange ?? instrument.exchange ?? null,
            symbol: item
        };
    });
    const focusSymbol = boundSymbols[0] || "";

    function toggleHidden(symbol: string) {
        onPatch({ hiddenSymbols: toggleHiddenSymbol(hiddenList, symbol) });
    }

    return (
        <WidgetState
            error={quoteError || accountError}
            loading={listsLoading && !instruments.length}
            loadingLabel="Loading quotes and chart"
        >
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                <WidgetScopeBar
                    allowMultiSymbol
                    component={component}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={focusSymbol}
                    watchlists={watchlists}
                />
                <LiveStatusBadge
                    label={
                        live.state === "connected"
                            ? "Live"
                            : live.state === "connecting"
                              ? "Connecting"
                              : chartLoading
                                ? "Loading"
                                : "Snapshot"
                    }
                    tone={live.state === "connected" || hasPoints ? "live" : live.state === "error" ? "error" : "cached"}
                />
            </div>
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">{scopeHint(component, watchlist?.name)}</p>
            {showQuotes ? (
                <QuotesMoveTable
                    onToggleHidden={toggleHidden}
                    rows={tableRows}
                    showExchangeBadge
                />
            ) : null}
            {showChart ? (
                <>
                    <ChartSeriesLegend hidden={hidden} items={legendItems} minItems={1} onToggle={toggleHidden} />
                    {chartError ? <p className="p-3 text-sm text-destructive">{chartError}</p> : null}
                    {!chartError && hasPoints ? (
                        <OverlayLineChart dark={dark} height={200} series={series} />
                    ) : !chartError ? (
                        <p className="p-3 text-sm text-muted-foreground">
                            {chartLoading
                                ? "Loading daily candles…"
                                : overlayOrder.length && !visibleChartSymbols.length
                                  ? "All series are hidden. Show a symbol in the table or legend."
                                  : focusSymbol
                                    ? `No daily candles for ${visibleChartSymbols.join(", ") || focusSymbol} yet.`
                                    : "Pick symbols to load quotes and a chart."}
                        </p>
                    ) : null}
                </>
            ) : null}
        </WidgetState>
    );
}
