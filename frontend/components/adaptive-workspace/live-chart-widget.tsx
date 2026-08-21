"use client";

import { ColorType, LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import {
    WidgetScopeBar,
    readHiddenSymbols,
    toggleHiddenSymbol
} from "@/components/adaptive-workspace/widget-scope-bar";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    instrumentForSymbol,
    resolveWatchlist,
    stringListParam,
    stringParam,
    symbolsFromComponent,
    useDeskAccounts,
    useDeskWatchlists,
    widgetProp
} from "@/hooks/use-desk-data";
import { getMarketChartData } from "@/service/actions/broker";
import { cn } from "@/lib/utils";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { InstrumentRef, MarketChartCandle } from "@/service/types/broker";

const SERIES_COLORS_DARK = ["#60a5fa", "#4ade80", "#fbbf24", "#f87171", "#c4b5fd", "#22d3ee", "#fb7185", "#a3e635"];
const SERIES_COLORS_LIGHT = ["#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed", "#0891b2", "#e11d48", "#65a30d"];

export function seriesColor(index: number, dark: boolean): string {
    const palette = dark ? SERIES_COLORS_DARK : SERIES_COLORS_LIGHT;
    return palette[index % palette.length];
}

export function historyDaysFromComponent(component: WorkspaceComponent, fallback = 90): number {
    const value = widgetProp(component, "historyDays");
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function overlaySymbolsFromComponent(component: WorkspaceComponent, fallbackSymbol: string): string[] {
    const listed = stringListParam(component.props, ["symbols"]).concat(
        stringListParam(component.data?.params, ["symbols"])
    );
    const unique = Array.from(new Set(listed.map((item) => item.trim().toUpperCase()).filter(Boolean)));
    if (unique.length >= 2) return unique.slice(0, 40);
    const symbol = fallbackSymbol.trim().toUpperCase();
    return symbol ? [symbol] : [];
}

export function chartSymbolsFromComponent(component: WorkspaceComponent, bound: string[], hidden: ReadonlySet<string>): string[] {
    const explicit = stringListParam(component.props, ["chartSymbols"]).concat(
        stringListParam(component.data?.params, ["chartSymbols"])
    );
    const universe = (explicit.length ? explicit : bound).map((item) => item.trim().toUpperCase()).filter(Boolean);
    return Array.from(new Set(universe)).filter((item) => !hidden.has(item)).slice(0, 40);
}

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

export function candlePoints(candles: MarketChartCandle[]) {
    return candles.flatMap((candle) => {
        const time = toUnix(candle.time);
        if (time == null || !Number.isFinite(candle.close)) return [];
        return [{ time, value: candle.close }];
    });
}

export type MarketCandleRow = {
    candles: MarketChartCandle[];
    exchange?: string | null;
    symbol: string;
};

export function useMarketCandles(
    accountId: string | undefined,
    requests: Array<{ instrument: InstrumentRef; symbol: string }>,
    historyDays: number,
    refreshNonce: number
) {
    const [rows, setRows] = useState<MarketCandleRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const requestKey = requests.map((item) => `${item.symbol}:${item.instrument.exchange ?? ""}`).join("|");
    const requestsRef = useRef(requests);
    requestsRef.current = requests;

    useEffect(() => {
        if (!accountId || !requestKey) {
            setRows([]);
            setLoading(false);
            setError(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        const payload = requestsRef.current;
        void Promise.all(
            payload.map(async (item) => {
                try {
                    const result = await getMarketChartData(accountId, {
                        daily_interval: "day",
                        history_days: historyDays,
                        include_live_quote: true,
                        instrument: { ...item.instrument, symbol: item.symbol }
                    });
                    return {
                        candles: Array.isArray(result.candles) ? result.candles : [],
                        error: null as string | null,
                        exchange: result.exchange ?? item.instrument.exchange ?? null,
                        symbol: item.symbol
                    };
                } catch (caught) {
                    return {
                        candles: [] as MarketChartCandle[],
                        error: caught instanceof Error ? caught.message : "Could not load chart.",
                        exchange: item.instrument.exchange ?? null,
                        symbol: item.symbol
                    };
                }
            })
        )
            .then((results) => {
                if (cancelled) return;
                const ok = results.filter((row) => !row.error);
                const failed = results.find((row) => row.error);
                setRows(results.map(({ candles, exchange, symbol }) => ({ candles, exchange, symbol })));
                setError(ok.length === 0 && failed?.error ? failed.error : null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [accountId, historyDays, refreshNonce, requestKey]);

    return { error, loading, rows };
}

export function OverlayLineChart({
    dark,
    height = 180,
    series
}: {
    dark: boolean;
    height?: number;
    series: Array<{ color: string; points: Array<{ time: UTCTimestamp; value: number }>; symbol: string }>;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const visible = series.filter((item) => item.points.length);
    const signature = visible.map((item) => `${item.symbol}:${item.color}:${item.points.length}`).join("|");

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !visible.length) return;
        const chart = createChart(host, {
            autoSize: true,
            grid: { horzLines: { visible: false }, vertLines: { visible: false } },
            height,
            layout: {
                attributionLogo: false,
                background: { color: "transparent", type: ColorType.Solid },
                textColor: dark ? "#a1a1aa" : "#52525b"
            },
            rightPriceScale: { borderVisible: false },
            timeScale: { borderVisible: false }
        });
        for (const item of visible) {
            const line = chart.addSeries(LineSeries, { color: item.color, lineWidth: 2 });
            line.setData(item.points);
        }
        chart.timeScale().fitContent();
        return () => {
            chart.remove();
        };
    }, [dark, height, signature]);

    if (!visible.length) return null;
    return <div className="w-full px-2 pb-2" ref={hostRef} style={{ height }} />;
}

export function ChartSeriesLegend({
    hidden,
    items,
    minItems = 2,
    onToggle
}: {
    hidden: ReadonlySet<string>;
    items: Array<{ color: string; exchange?: string | null; symbol: string }>;
    minItems?: number;
    onToggle: (symbol: string) => void;
}) {
    if (items.length < minItems) return null;
    return (
        <div className="flex flex-wrap gap-1 px-2 py-1.5">
            {items.map((item) => {
                const isHidden = hidden.has(item.symbol);
                return (
                    <Button
                        aria-pressed={!isHidden}
                        className={cn("h-6 gap-1 px-1.5 text-[11px]", isHidden && "text-muted-foreground line-through opacity-60")}
                        key={item.symbol}
                        onClick={() => onToggle(item.symbol)}
                        size="xs"
                        type="button"
                        variant="ghost"
                    >
                        <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: isHidden ? "var(--color-muted-foreground)" : item.color }}
                        />
                        {item.symbol}
                        {String(item.exchange ?? "").toUpperCase() === "BSE" ? (
                            <Badge size="sm" variant="outline">
                                BSE
                            </Badge>
                        ) : null}
                    </Button>
                );
            })}
        </div>
    );
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
    const overlaySymbols = overlaySymbolsFromComponent(component, symbol);
    const hiddenList = readHiddenSymbols(component);
    const hiddenKey = hiddenList.join("|");
    const hidden = useMemo(() => new Set(hiddenKey ? hiddenKey.split("|") : []), [hiddenKey]);
    const visibleSymbols = overlaySymbols.filter((item) => !hidden.has(item));
    const requests = useMemo(
        () =>
            visibleSymbols.map((item) => ({
                instrument: instrumentForSymbol(watchlists, item, component) as InstrumentRef,
                symbol: item
            })),
        [component, visibleSymbols, watchlists]
    );
    const historyDays = historyDaysFromComponent(component);
    const { error, loading, rows } = useMarketCandles(account?.id, requests, historyDays, refreshNonce);
    const dark = resolvedTheme === "dark";
    const series = rows.map((row) => {
        const index = overlaySymbols.indexOf(row.symbol);
        return {
            color: seriesColor(index < 0 ? 0 : index, dark),
            points: candlePoints(row.candles),
            symbol: row.symbol
        };
    });
    const hasPoints = series.some((item) => item.points.length);
    const legendItems = overlaySymbols.map((item, index) => {
        const fetched = rows.find((row) => row.symbol === item);
        const instrument = instrumentForSymbol(watchlists, item, component) as InstrumentRef;
        return {
            color: seriesColor(index, dark),
            exchange: fetched?.exchange ?? instrument.exchange ?? null,
            symbol: item
        };
    });

    return (
        <WidgetState error={accountError} loading={listsLoading && !watchlists.length} loadingLabel="Loading chart">
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                <WidgetScopeBar
                    allowMultiSymbol
                    allowWatchlist={false}
                    component={component}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={symbol}
                    watchlists={watchlists}
                />
                <LiveStatusBadge
                    label={loading ? "Loading" : overlaySymbols.length > 1 ? `${visibleSymbols.length} series` : symbol || "Pick a symbol"}
                    tone={hasPoints ? "live" : loading ? "cached" : "idle"}
                />
            </div>
            <ChartSeriesLegend
                hidden={hidden}
                items={legendItems}
                onToggle={(next) => onPatch({ hiddenSymbols: toggleHiddenSymbol(hiddenList, next) })}
            />
            {error ? <p className="p-3 text-sm text-destructive">{error}</p> : null}
            {!error && hasPoints ? (
                <OverlayLineChart dark={dark} series={series} />
            ) : !error ? (
                <p className="p-3 text-sm text-muted-foreground">
                    {loading
                        ? "Loading daily candles…"
                        : overlaySymbols.length && !visibleSymbols.length
                          ? "All series are hidden. Click a symbol in the legend to show it."
                          : symbol
                            ? `No daily candles for ${visibleSymbols.join(", ") || symbol} yet.`
                            : "Pick a symbol to load a price chart."}
                </p>
            ) : null}
        </WidgetState>
    );
}
