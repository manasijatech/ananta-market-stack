"use client";

import {
    CandlestickSeries,
    ColorType,
    HistogramSeries,
    createChart,
    createSeriesMarkers,
    type IChartApi,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type SeriesMarker,
    type Time,
    type UTCTimestamp,
} from "lightweight-charts";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { brokerNames } from "@/components/brokers/ui";
import type { MarketIntelligenceFeeds } from "@/components/market-intelligence/market-intelligence-data";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type {
    BrokerDataDefaultAccount,
    InstrumentRef,
    JsonObject,
    MarketChartSnapshot,
} from "@/service/types/broker";

type BrokerChartState = {
    error: string;
    isLoading: boolean;
    snapshot: MarketChartSnapshot | null;
};

type MarkerSection = "news" | "announcements" | "earnings" | "concalls" | "alerts";

const markerStyles = {
    news: { color: "#2563eb", shape: "circle", position: "aboveBar", label: "News" },
    announcements: { color: "#f97316", shape: "square", position: "aboveBar", label: "Announcement" },
    earnings: { color: "#ca8a04", shape: "arrowDown", position: "aboveBar", label: "Earnings" },
    concalls: { color: "#0891b2", shape: "circle", position: "belowBar", label: "Concall" },
    alerts: { color: "#dc2626", shape: "arrowUp", position: "belowBar", label: "Alert" },
} as const;

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoteRaw(snapshot: MarketChartSnapshot | null): JsonObject {
    const detail = snapshot?.latest_quote?.detail;
    if (!isJsonObject(detail)) return {};
    const raw = detail.raw;
    return isJsonObject(raw) ? raw : detail;
}

function displayRaw(raw: JsonObject, keys: string[]): string {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === "string" || typeof value === "number") return String(value);
    }
    const ohlc = raw.ohlc;
    if (isJsonObject(ohlc)) {
        for (const key of keys) {
            const value = ohlc[key];
            if (typeof value === "string" || typeof value === "number") return String(value);
        }
    }
    return "-";
}

function toChartTime(value: string): UTCTimestamp {
    return Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
}

function mergeLiveQuote(snapshot: MarketChartSnapshot, row: Record<string, unknown>): MarketChartSnapshot {
    const ltp = typeof row.ltp === "number" ? row.ltp : Number(row.ltp ?? NaN);
    if (!Number.isFinite(ltp)) return snapshot;
    const detail = isJsonObject(row.detail) ? row.detail : {};
    const raw = isJsonObject(detail.raw) ? detail.raw : detail;
    const timeValue =
        (typeof raw.timestamp === "string" && raw.timestamp) ||
        (typeof raw.last_trade_time === "string" && raw.last_trade_time) ||
        new Date().toISOString();
    const candleTime = new Date(timeValue);
    if (Number.isNaN(candleTime.getTime())) return snapshot;
    candleTime.setSeconds(0, 0);
    const candleIso = candleTime.toISOString();
    const volume =
        typeof raw.volume === "number"
            ? raw.volume
            : typeof raw.volume === "string"
              ? Number(raw.volume)
              : undefined;
    const candles = [...snapshot.candles];
    const last = candles.at(-1);
    if (last && new Date(last.time).toISOString() === candleIso) {
        candles[candles.length - 1] = {
            ...last,
            high: Math.max(last.high, ltp),
            low: Math.min(last.low, ltp),
            close: ltp,
            volume: Number.isFinite(volume) ? volume : last.volume ?? null,
        };
    } else {
        candles.push({
            time: candleIso,
            open: ltp,
            high: ltp,
            low: ltp,
            close: ltp,
            volume: Number.isFinite(volume) ? volume : null,
            interval: "1minute",
        });
    }
    return {
        ...snapshot,
        candles,
        latest_quote: snapshot.latest_quote
            ? {
                  ...snapshot.latest_quote,
                  ltp,
                  detail,
              }
            : snapshot.latest_quote,
        last_price_time: timeValue,
    };
}

function eventDateFor(section: MarkerSection, item: unknown): string | null {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const value =
        section === "alerts"
            ? record.timestamp
            : (record.date ?? record.timestamp ?? record.created_at ?? record.updated_at);
    return typeof value === "string" && value.trim() ? value : null;
}

function eventTextFor(section: MarkerSection, item: unknown): string {
    if (!item || typeof item !== "object") return markerStyles[section].label;
    const record = item as Record<string, unknown>;
    const value =
        record.headline ??
        record.title ??
        record.summary ??
        record.reason ??
        record.quarter ??
        markerStyles[section].label;
    return String(value).trim().slice(0, 40) || markerStyles[section].label;
}

function buildMarkers(snapshot: MarketChartSnapshot | null, feeds: MarketIntelligenceFeeds): SeriesMarker<Time>[] {
    if (!snapshot?.candles.length) return [];
    const candleTimes = snapshot.candles.map((item) => toChartTime(item.time));
    const minuteMap = new Map<number, UTCTimestamp>();
    const dayMap = new Map<string, UTCTimestamp>();
    for (const time of candleTimes) {
        minuteMap.set(Number(time) - (Number(time) % 60), time);
        const dayKey = new Date(Number(time) * 1000).toISOString().slice(0, 10);
        if (!dayMap.has(dayKey)) dayMap.set(dayKey, time);
    }

    function markerTime(rawValue: string): UTCTimestamp | null {
        const parsed = new Date(rawValue);
        if (Number.isNaN(parsed.getTime())) return null;
        const seconds = Math.floor(parsed.getTime() / 1000);
        const exactMinute = minuteMap.get(seconds - (seconds % 60));
        if (exactMinute) return exactMinute;
        return dayMap.get(parsed.toISOString().slice(0, 10)) ?? null;
    }

    const sections: [MarkerSection, unknown[]][] = [
        ["news", feeds.news],
        ["announcements", feeds.announcements],
        ["earnings", feeds.earnings],
        ["concalls", feeds.concalls],
        ["alerts", feeds.alerts],
    ];

    return sections.flatMap(([section, items]) =>
        items
            .map((item) => {
                const eventDate = eventDateFor(section, item);
                if (!eventDate) return null;
                const time = markerTime(eventDate);
                if (!time) return null;
                const style = markerStyles[section];
                return {
                    time,
                    color: style.color,
                    position: style.position,
                    shape: style.shape,
                    text: eventTextFor(section, item),
                } as SeriesMarker<Time>;
            })
            .filter(Boolean) as SeriesMarker<Time>[]
    );
}

export function MarketIntelligenceSymbolChart({
    account,
    feeds,
    instrument,
    state,
    symbol,
    symbolMetadata,
}: {
    account: BrokerDataDefaultAccount | null;
    feeds: MarketIntelligenceFeeds;
    instrument: InstrumentRef | null;
    state: BrokerChartState;
    symbol: string;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
}) {
    const { user } = useSession();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const fittedRef = useRef(false);
    const [liveSnapshot, setLiveSnapshot] = useState<MarketChartSnapshot | null>(state.snapshot);
    useEffect(() => {
        setLiveSnapshot(state.snapshot);
    }, [state.snapshot]);

    const snapshot = liveSnapshot;
    const metadata = symbolMetadata[symbol];
    const raw = quoteRaw(snapshot);
    const latestPrice = snapshot?.latest_quote?.ltp ?? null;
    const markers = useMemo(() => buildMarkers(snapshot, feeds), [feeds, snapshot]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !snapshot?.candles.length) return;

        if (!chartRef.current) {
            chartRef.current = createChart(container, {
                autoSize: true,
                layout: {
                    background: { type: ColorType.Solid, color: "transparent" },
                    textColor: "#5f564d",
                },
                grid: {
                    vertLines: { color: "rgba(191, 161, 102, 0.12)" },
                    horzLines: { color: "rgba(191, 161, 102, 0.12)" },
                },
                rightPriceScale: {
                    borderColor: "rgba(191, 161, 102, 0.24)",
                },
                timeScale: {
                    borderColor: "rgba(191, 161, 102, 0.24)",
                    timeVisible: true,
                    secondsVisible: false,
                },
                crosshair: {
                    vertLine: { color: "rgba(214, 146, 35, 0.45)" },
                    horzLine: { color: "rgba(214, 146, 35, 0.45)" },
                },
            });
            candleSeriesRef.current = chartRef.current.addSeries(CandlestickSeries, {
                upColor: "#1f9d71",
                downColor: "#c2410c",
                borderVisible: false,
                wickUpColor: "#1f9d71",
                wickDownColor: "#c2410c",
                priceLineVisible: true,
            });
            volumeSeriesRef.current = chartRef.current.addSeries(HistogramSeries, {
                priceFormat: { type: "volume" },
                priceScaleId: "",
                color: "rgba(196, 133, 28, 0.45)",
            });
            volumeSeriesRef.current.priceScale().applyOptions({
                scaleMargins: { top: 0.82, bottom: 0 },
            });
            markersRef.current = createSeriesMarkers(candleSeriesRef.current, []);
        }

        candleSeriesRef.current?.setData(
            snapshot.candles.map((item) => ({
                time: toChartTime(item.time),
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
            }))
        );
        volumeSeriesRef.current?.setData(
            snapshot.candles
                .filter((item) => typeof item.volume === "number")
                .map((item) => ({
                    time: toChartTime(item.time),
                    value: item.volume as number,
                    color: item.close >= item.open ? "rgba(31, 157, 113, 0.45)" : "rgba(194, 65, 12, 0.45)",
                }))
        );
        markersRef.current?.setMarkers(markers);
        if (!fittedRef.current) {
            chartRef.current?.timeScale().fitContent();
            fittedRef.current = true;
        }
    }, [markers, snapshot]);

    useEffect(() => {
        fittedRef.current = false;
    }, [snapshot?.symbol]);

    useEffect(() => {
        const container = containerRef.current;
        const chart = chartRef.current;
        if (!container || !chart) return;
        const resizeObserver = new ResizeObserver(() => {
            chart.timeScale().fitContent();
        });
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, [snapshot?.symbol]);

    useEffect(() => {
        return () => {
            markersRef.current?.detach();
            chartRef.current?.remove();
            markersRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            chartRef.current = null;
            fittedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!snapshot?.candles.length || !account?.account_id || !instrument || !user?.id) {
            return;
        }

        const url = new URL(getPublicApiBaseUrl());
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/broker-accounts/${account.account_id}/data/stream/ws`;
        url.searchParams.set("user_id", user.id);
        const socket = new WebSocket(url.toString());
        socket.onopen = () => {
            socket.send(
                JSON.stringify({
                    type: "subscribe",
                    instruments: [instrument],
                })
            );
        };
        socket.onmessage = (event) => {
            let payload: unknown;
            try {
                payload = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (!payload || typeof payload !== "object") return;
            const message = payload as { type?: string; rows?: unknown[] };
            if (message.type !== "quotes" || !Array.isArray(message.rows) || !message.rows.length) return;
            const row = message.rows[0];
            if (!row || typeof row !== "object") return;
            setLiveSnapshot((current) => (current ? mergeLiveQuote(current, row as Record<string, unknown>) : current));
        };
        return () => socket.close();
    }, [account?.account_id, instrument, snapshot?.candles.length, user?.id]);

    return (
        <section className="overflow-hidden border border-border/80 bg-[linear-gradient(180deg,rgba(214,146,35,0.08),rgba(255,255,255,0))]">
            <div className="flex flex-col gap-4 border-b border-border/70 px-4 py-4 min-[980px]:flex-row min-[980px]:items-start min-[980px]:justify-between">
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Broker chart</p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h2 className="truncate text-xl font-semibold text-foreground">{symbol}</h2>
                        {metadata?.company_name ? (
                            <p className="truncate text-sm text-muted-foreground">{metadata.company_name}</p>
                        ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {account
                            ? `${account.label} / ${brokerNames[account.broker_code as keyof typeof brokerNames] ?? account.broker_code}`
                            : "No default broker"}
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm min-[720px]:grid-cols-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">LTP</p>
                        <p className="mt-1 text-xl font-semibold text-foreground">{latestPrice ?? "-"}</p>
                    </div>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Open</p>
                        <p className="mt-1 text-foreground">{displayRaw(raw, ["open", "open_price"])}</p>
                    </div>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">High</p>
                        <p className="mt-1 text-foreground">{displayRaw(raw, ["high", "high_price"])}</p>
                    </div>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Low</p>
                        <p className="mt-1 text-foreground">{displayRaw(raw, ["low", "low_price"])}</p>
                    </div>
                </div>
            </div>
            <div className="relative">
                <div
                    className={snapshot?.candles.length ? "h-[420px] w-full" : "h-[420px] w-full opacity-0"}
                    ref={containerRef}
                />
                {state.isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-3 bg-background/70 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading chart data...
                    </div>
                ) : state.error ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70 px-6 text-center text-sm text-destructive">
                        {state.error}
                    </div>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70 px-6 text-center text-sm text-muted-foreground">
                        No broker candle history is available for this symbol yet.
                    </div>
                )}
            </div>
            <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground min-[980px]:flex-row min-[980px]:items-center min-[980px]:justify-between">
                <span>
                    Cached daily: {snapshot?.cache_status.used_cached_daily ? "yes" : "no"} / Cached intraday:{" "}
                    {snapshot?.cache_status.used_cached_intraday ? "yes" : "no"}
                </span>
                <Button asChild className="h-7 px-0 text-xs" size="sm" variant="link">
                    <a href="https://www.tradingview.com/lightweight-charts/" rel="noreferrer" target="_blank">
                        Charts by TradingView Lightweight Charts
                        <ExternalLink className="size-3.5" />
                    </a>
                </Button>
            </div>
        </section>
    );
}
