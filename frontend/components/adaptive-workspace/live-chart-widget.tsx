"use client";

import { ColorType, LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar } from "@/components/adaptive-workspace/widget-scope-bar";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import {
    instrumentForSymbol,
    resolveWatchlist,
    stringParam,
    symbolsFromComponent,
    useDeskAccounts,
    useDeskWatchlists
} from "@/hooks/use-desk-data";
import { getMarketChartData } from "@/service/actions/broker";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { InstrumentRef, MarketChartCandle } from "@/service/types/broker";

function toUnix(value: unknown): UTCTimestamp | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return (value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)) as UTCTimestamp;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return Math.floor(parsed / 1000) as UTCTimestamp;
    }
    return null;
}

function candlePoints(candles: MarketChartCandle[]) {
    return candles.flatMap((candle) => {
        const time = toUnix(candle.time);
        if (time == null || !Number.isFinite(candle.close)) return [];
        return [{ time, value: candle.close }];
    });
}

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export function LiveChartWidget({ component, onPatch, refreshNonce }: Props) {
    const { resolvedTheme } = useTheme();
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const symbol = stringParam(component.props, ["symbol"]) || symbolsFromComponent(component, watchlist)[0] || "";
    const instrument = useMemo(
        () => instrumentForSymbol(watchlists, symbol, component) as InstrumentRef,
        [component, symbol, watchlists]
    );
    const [candles, setCandles] = useState<MarketChartCandle[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const hostRef = useRef<HTMLDivElement>(null);
    const points = useMemo(() => candlePoints(candles), [candles]);
    const dark = resolvedTheme === "dark";

    useEffect(() => {
        if (!account || !symbol) {
            setCandles([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void getMarketChartData(account.id, {
            history_days: 90,
            daily_interval: "day",
            include_live_quote: true,
            instrument: { ...instrument, symbol }
        })
            .then((result) => {
                if (cancelled) return;
                setCandles(Array.isArray(result.candles) ? result.candles : []);
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load chart.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, instrument, refreshNonce, symbol]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !points.length) return;
        const chart = createChart(host, {
            autoSize: true,
            grid: { horzLines: { visible: false }, vertLines: { visible: false } },
            height: 180,
            layout: {
                attributionLogo: false,
                background: { color: "transparent", type: ColorType.Solid },
                textColor: dark ? "#a1a1aa" : "#52525b"
            },
            rightPriceScale: { borderVisible: false },
            timeScale: { borderVisible: false }
        });
        const series = chart.addSeries(LineSeries, { color: dark ? "#93c5fd" : "#2563eb", lineWidth: 2 });
        series.setData(points);
        chart.timeScale().fitContent();
        return () => {
            chart.remove();
        };
    }, [dark, points]);

    return (
        <WidgetState error={accountError} loading={listsLoading && !watchlists.length} loadingLabel="Loading chart">
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                <WidgetScopeBar
                    allowWatchlist={false}
                    component={component}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={symbol}
                    watchlists={watchlists}
                />
                <LiveStatusBadge
                    label={loading ? "Loading" : symbol || "Pick a symbol"}
                    tone={points.length ? "live" : loading ? "cached" : "idle"}
                />
            </div>
            {error ? <p className="p-3 text-sm text-destructive">{error}</p> : null}
            {!error && points.length ? (
                <div className="h-[180px] w-full px-2 pb-2" ref={hostRef} />
            ) : !error ? (
                <p className="p-3 text-sm text-muted-foreground">
                    {loading
                        ? "Loading daily candles…"
                        : symbol
                          ? `No daily candles for ${symbol} yet.`
                          : "Pick a symbol to load a price chart."}
                </p>
            ) : null}
        </WidgetState>
    );
}
