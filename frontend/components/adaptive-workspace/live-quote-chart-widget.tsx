"use client";

import { useMemo, useRef, type PointerEvent } from "react";
import { useTheme } from "next-themes";
import {
    ChartSeriesLegend,
    OverlayLineChart,
    candlePoints,
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
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import {
    componentScope,
    instrumentForSymbol,
    resolveWatchlist,
    symbolsFromComponent,
    universeSymbols,
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
    return typeof value === "boolean" ? value : fallback;
}

function splitRatio(component: WorkspaceComponent): number {
    const value = widgetProp(component, "chartSplit");
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0.58;
    if (!Number.isFinite(parsed)) return 0.58;
    return Math.min(0.82, Math.max(0.28, parsed));
}

export function LiveQuoteChartWidget({ component, onPatch, refreshNonce }: Props) {
    const { resolvedTheme } = useTheme();
    const { patchUniverse, spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const boundSymbols = symbolsFromComponent(component, watchlist, deskSymbols);
    const instruments = useMemo(
        () =>
            componentScope(component) === "desk"
                ? boundSymbols.map((symbol) => instrumentForSymbol(watchlists, symbol, component) as InstrumentRef)
                : instrumentsForComponent(component, watchlist, watchlists),
        [boundSymbols, component, watchlist, watchlists]
    );
    const hiddenList = readHiddenSymbols(component);
    const hidden = useMemo(() => new Set(hiddenList), [hiddenList.join("|")]);
    const showQuotes = boolProp(component, "showQuotes", true);
    const showChart = boolProp(component, "showChart", true);
    const ratio = splitRatio(component);
    const historyDays = historyDaysFromComponent(component);
    const overlayOrder = boundSymbols.slice(0, 40);
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
            overlayOrder.map((symbol) => ({
                instrument: instrumentForSymbol(watchlists, symbol, component) as InstrumentRef,
                symbol
            })),
        [component, overlayOrder.join("|"), watchlists]
    );
    const { error: chartError, loading: chartLoading, rows: candleRows } = useMarketCandles(
        showChart ? account?.id : undefined,
        showChart ? chartRequests : [],
        historyDays,
        refreshNonce
    );
    const dark = resolvedTheme === "dark";
    const percent = overlayOrder.length > 1;
    const series = candleRows
        .filter((row) => !hidden.has(row.symbol))
        .map((row) => {
            const index = overlayOrder.indexOf(row.symbol);
            return {
                color: seriesColor(index < 0 ? 0 : index, dark),
                points: candlePoints(row.candles, { percent }),
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
    const dragRef = useRef<{ startY: number; origin: number } | null>(null);

    function toggleHidden(symbol: string) {
        onPatch({ hiddenSymbols: toggleHiddenSymbol(hiddenList, symbol) });
    }

    function onSplitMove(event: PointerEvent<HTMLButtonElement>) {
        const drag = dragRef.current;
        const parent = event.currentTarget.parentElement;
        if (!drag || !parent) return;
        const height = parent.clientHeight || 1;
        const next = drag.origin + (event.clientY - drag.startY) / height;
        onPatch({ chartSplit: Math.min(0.82, Math.max(0.28, next)) });
    }

    return (
        <WidgetState
            error={quoteError || accountError}
            loading={listsLoading && !instruments.length && !boundSymbols.length}
            loadingLabel="Loading quotes and chart"
        >
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
                    <WidgetScopeBar
                        allowDesk
                        allowMultiSymbol
                        component={component}
                        extraSymbols={deskSymbols}
                        onPatch={onPatch}
                        selectedWatchlist={watchlist}
                        symbol={focusSymbol}
                        watchlists={watchlists}
                    />
                    <LiveStatusBadge
                        label={
                            live.state === "connected" ? "Live" : percent ? `${overlayOrder.length} · %` : chartLoading ? "Loading" : "Snapshot"
                        }
                        tone={live.state === "connected" || hasPoints ? "live" : live.state === "error" ? "error" : "cached"}
                    />
                </div>
                {prefs?.canvasLocked !== false ? (
                    percent ? (
                        <p className="px-3 pt-1 text-[11px] text-muted-foreground">Indexed to first close</p>
                    ) : null
                ) : (
                    <p className="px-3 pt-1 text-[11px] text-muted-foreground">
                        {scopeHint(component, watchlist?.name, deskSymbols.length)}
                        {percent ? " · indexed to first close" : ""}
                    </p>
                )}
                {showChart ? (
                    <div className="flex min-h-0 flex-col" style={{ flex: showQuotes ? `${ratio} 1 0` : "1 1 0" }}>
                        <ChartSeriesLegend hidden={hidden} items={legendItems} onToggle={toggleHidden} />
                        {chartError ? <p className="px-3 text-sm text-destructive">{chartError}</p> : null}
                        {!chartError && hasPoints ? (
                            <OverlayLineChart className="px-2" dark={dark} percent={percent} series={series} />
                        ) : !chartError ? (
                            <p className="p-3 text-sm text-muted-foreground">
                                {chartLoading
                                    ? "Loading daily candles…"
                                    : overlayOrder.length && overlayOrder.every((item) => hidden.has(item))
                                      ? "All series are hidden. Click a symbol to show it."
                                      : focusSymbol
                                        ? `No daily candles for ${overlayOrder.filter((item) => !hidden.has(item)).join(", ") || focusSymbol} yet.`
                                        : "Add desk symbols to load quotes and a chart."}
                            </p>
                        ) : null}
                    </div>
                ) : null}
                {showChart && showQuotes && prefs?.canvasLocked === false ? (
                    <button
                        aria-label="Resize chart and quotes"
                        className="h-2 shrink-0 cursor-row-resize border-y border-border/50 bg-border/30 hover:bg-primary/40"
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            dragRef.current = { origin: ratio, startY: event.clientY };
                        }}
                        onPointerMove={onSplitMove}
                        onPointerUp={() => {
                            dragRef.current = null;
                        }}
                        type="button"
                    />
                ) : showChart && showQuotes ? (
                    <div className="h-px shrink-0 bg-border/50" />
                ) : null}
                {showQuotes ? (
                    <div className="min-h-0 overflow-auto" style={{ flex: showChart ? `${1 - ratio} 1 0` : "1 1 0" }}>
                        <QuotesMoveTable
                            emptyLabel="No symbols on this desk list yet. Add one above."
                            layoutLocked={prefs?.canvasLocked !== false}
                            onRemove={
                                componentScope(component) === "desk"
                                    ? (symbol) => patchUniverse(deskSymbols.filter((item) => item !== symbol))
                                    : undefined
                            }
                            onToggleHidden={toggleHidden}
                            rows={tableRows}
                            showExchangeBadge
                        />
                    </div>
                ) : null}
            </div>
        </WidgetState>
    );
}
