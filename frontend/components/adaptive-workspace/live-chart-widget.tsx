"use client";

import { ColorType, LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { DeskAccountState, LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import {
    WidgetScopeBar,
    readHiddenSymbols,
    toggleHiddenSymbol
} from "@/components/adaptive-workspace/widget-scope-bar";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import {
    instrumentForSymbol,
    resolveWatchlist,
    stringListParam,
    stringParam,
    symbolsFromComponent,
    universeSymbols,
    useDeskAccounts,
    useDeskWatchlists,
    widgetProp
} from "@/hooks/use-desk-data";
import { getMarketChartDataResult } from "@/service/actions/broker";
import { brokerReconnectCopy } from "@/lib/broker-auth-error";
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

export function candlePoints(
    candles: MarketChartCandle[],
    options: { percent?: boolean } = {}
) {
    const byDay = new Map<number, { time: UTCTimestamp; value: number }>();
    for (const candle of candles) {
        const time = toUnix(candle.time);
        if (time == null || !Number.isFinite(candle.close)) continue;
        let day = time;
        if (typeof candle.time === "string" && /^\d{4}-\d{2}-\d{2}/.test(candle.time)) {
            const parsed = Date.parse(`${candle.time.slice(0, 10)}T00:00:00Z`);
            if (Number.isFinite(parsed)) day = Math.floor(parsed / 1000) as UTCTimestamp;
        } else {
            const date = new Date(time * 1000);
            day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000) as UTCTimestamp;
        }
        byDay.set(day, { time: day as UTCTimestamp, value: candle.close });
    }
    const points = [...byDay.values()].sort((left, right) => left.time - right.time);
    if (!options.percent || points.length < 2) return points;
    const base = points[0].value;
    if (!base) return points;
    return points.map((point) => ({ time: point.time, value: ((point.value / base) - 1) * 100 }));
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
                const result = await getMarketChartDataResult(accountId, {
                    daily_interval: "day",
                    history_days: historyDays,
                    include_live_quote: false,
                    instrument: { ...item.instrument, symbol: item.symbol }
                });
                if (result.ok && result.data) {
                    return {
                        authFailed: false,
                        candles: Array.isArray(result.data.candles) ? result.data.candles : [],
                        error: null as string | null,
                        exchange: result.data.exchange ?? item.instrument.exchange ?? null,
                        symbol: item.symbol
                    };
                }
                return {
                    authFailed: result.authFailed,
                    candles: [] as MarketChartCandle[],
                    error: result.authFailed
                        ? brokerReconnectCopy(result.error || "")
                        : result.error || "Could not load chart.",
                    exchange: item.instrument.exchange ?? null,
                    symbol: item.symbol
                };
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
    className,
    dark,
    percent = false,
    series
}: {
    className?: string;
    dark: boolean;
    percent?: boolean;
    series: Array<{ color: string; points: Array<{ time: UTCTimestamp; value: number }>; symbol: string }>;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const visible = series.filter((item) => item.points.length);
    const signature = visible.map((item) => `${item.symbol}:${item.color}:${item.points.length}:${percent ? "pct" : "px"}`).join("|");

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !visible.length) return;
        const chart = createChart(host, {
            autoSize: true,
            grid: { horzLines: { color: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", visible: true }, vertLines: { visible: false } },
            height: Math.max(140, host.clientHeight || 180),
            layout: {
                attributionLogo: false,
                background: { color: "transparent", type: ColorType.Solid },
                textColor: dark ? "#a1a1aa" : "#52525b"
            },
            rightPriceScale: { borderVisible: false, scaleMargins: { bottom: 0.08, top: 0.1 } },
            timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true }
        });
        for (const item of visible) {
            const line = chart.addSeries(LineSeries, {
                color: item.color,
                lineWidth: 2,
                priceFormat: percent
                    ? {
                          type: "custom",
                          formatter: (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`,
                          minMove: 0.1
                      }
                    : { minMove: 0.01, precision: 2, type: "price" }
            });
            line.setData(item.points);
        }
        chart.timeScale().fitContent();
        const observer = new ResizeObserver(() => {
            const width = host.clientWidth;
            const height = host.clientHeight;
            if (width > 0 && height > 0) chart.applyOptions({ height, width });
        });
        observer.observe(host);
        return () => {
            observer.disconnect();
            chart.remove();
        };
    }, [dark, percent, signature]);

    if (!visible.length) return null;
    return <div className={cn("min-h-[140px] w-full flex-1", className)} ref={hostRef} />;
}

export function ChartSeriesLegend({
    hidden,
    items,
    minItems = 1,
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
    const { spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const bound = symbolsFromComponent(component, watchlist, deskSymbols);
    const symbol = stringParam(component.props, ["symbol"]) || bound[0] || "";
    const overlaySymbols = overlaySymbolsFromComponent(component, symbol).length
        ? overlaySymbolsFromComponent(component, symbol)
        : bound.slice(0, 40);
    const hiddenList = readHiddenSymbols(component);
    const hiddenKey = hiddenList.join("|");
    const hidden = useMemo(() => new Set(hiddenKey ? hiddenKey.split("|") : []), [hiddenKey]);
    const visibleSymbols = overlaySymbols.filter((item) => !hidden.has(item));
    const requests = useMemo(
        () =>
            overlaySymbols.map((item) => ({
                instrument: instrumentForSymbol(watchlists, item, component) as InstrumentRef,
                symbol: item
            })),
        [component, overlaySymbols, watchlists]
    );
    const historyDays = historyDaysFromComponent(component);
    const { error, loading, rows } = useMarketCandles(account?.id, requests, historyDays, refreshNonce);
    const dark = resolvedTheme === "dark";
    const percent = overlaySymbols.length > 1;
    const series = rows
        .filter((row) => !hidden.has(row.symbol))
        .map((row) => {
            const index = overlaySymbols.indexOf(row.symbol);
            return {
                color: seriesColor(index < 0 ? 0 : index, dark),
                points: candlePoints(row.candles, { percent }),
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
        <WidgetState error={accountError} loading={accountsLoading || (listsLoading && !watchlists.length)} loadingLabel="Loading chart">
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
                    <WidgetScopeBar
                        allowDesk
                        allowMultiSymbol
                        allowWatchlist={false}
                        component={component}
                        extraSymbols={deskSymbols}
                        onPatch={onPatch}
                        selectedWatchlist={watchlist}
                        symbol={symbol}
                        watchlists={watchlists}
                    />
                    <LiveStatusBadge
                        label={
                            loading
                                ? "Loading"
                                : percent
                                  ? `${visibleSymbols.length} · %`
                                  : symbol || "Pick a symbol"
                        }
                        tone={hasPoints ? "live" : loading ? "cached" : "idle"}
                    />
                </div>
                <ChartSeriesLegend
                    hidden={hidden}
                    items={legendItems}
                    onToggle={(next) => onPatch({ hiddenSymbols: toggleHiddenSymbol(hiddenList, next) })}
                />
                {error ? <p className="p-3 text-sm text-destructive">{error}</p> : null}
                <DeskAccountState account={account} accounts={accounts}>
                {!error && hasPoints ? (
                    <OverlayLineChart className="px-2 pb-2" dark={dark} percent={percent} series={series} />
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
                </DeskAccountState>
            </div>
        </WidgetState>
    );
}
