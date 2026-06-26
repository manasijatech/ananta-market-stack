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
    type MouseEventParams,
    type SeriesMarker,
    type Time,
    type UTCTimestamp,
} from "lightweight-charts";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseActionError } from "@/components/brokers/action-error";
import { brokerNames } from "@/components/brokers/ui";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";
import { cn } from "@/lib/utils";
import type { MarketIntelligenceFeeds } from "@/components/market-intelligence/market-intelligence-data";
import { getMarketChartData } from "@/service/actions/broker";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type {
    BrokerDataDefaultAccount,
    InstrumentRef,
    JsonObject,
    MarketChartRequest,
    MarketChartSnapshot,
} from "@/service/types/broker";

type BrokerChartState = {
    error: string;
    isLoading: boolean;
    snapshot: MarketChartSnapshot | null;
};

type MarkerSection = "news" | "announcements" | "earnings" | "concalls" | "alerts";

type RangePreset = {
    id: "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y";
    label: string;
    request: Omit<MarketChartRequest, "instrument" | "include_live_quote">;
};

type ChartEvent = {
    date: string;
    headline: string;
    section: MarkerSection;
};

type AggregatedMarker = {
    events: ChartEvent[];
    marker: SeriesMarker<Time>;
    time: UTCTimestamp;
};

type HoveredCandle = {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number | null;
    interval: string;
};

const RANGE_PRESETS: RangePreset[] = [
    {
        id: "1D",
        label: "1D",
        request: { history_days: 5, daily_interval: "day", intraday_interval: "1minute", intraday_lookback_days: 1 },
    },
    {
        id: "5D",
        label: "5D",
        request: { history_days: 10, daily_interval: "day", intraday_interval: "5minute", intraday_lookback_days: 5 },
    },
    {
        id: "1M",
        label: "1M",
        request: { history_days: 30, daily_interval: "day", intraday_interval: "15minute", intraday_lookback_days: 30 },
    },
    {
        id: "3M",
        label: "3M",
        request: { history_days: 90, daily_interval: "day", intraday_interval: "day", intraday_lookback_days: 0 },
    },
    {
        id: "6M",
        label: "6M",
        request: { history_days: 180, daily_interval: "day", intraday_interval: "day", intraday_lookback_days: 0 },
    },
    {
        id: "1Y",
        label: "1Y",
        request: { history_days: 365, daily_interval: "day", intraday_interval: "day", intraday_lookback_days: 0 },
    },
    {
        id: "5Y",
        label: "5Y",
        request: { history_days: 1825, daily_interval: "day", intraday_interval: "day", intraday_lookback_days: 0 },
    },
];

const sectionTone = {
    news: "bg-sky-500",
    announcements: "bg-orange-500",
    earnings: "bg-amber-500",
    concalls: "bg-cyan-500",
    alerts: "bg-rose-500",
} satisfies Record<MarkerSection, string>;

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

function dayKeyFromDate(value: string): string | null {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

function mergeLiveQuote(
    snapshot: MarketChartSnapshot,
    row: Record<string, unknown>,
    interval: string,
): MarketChartSnapshot {
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
    const normalizedInterval = interval.toLowerCase();
    if (normalizedInterval.endsWith("minute")) {
        const bucketMinutes = Math.max(1, Number.parseInt(normalizedInterval.replace("minute", ""), 10) || 1);
        candleTime.setSeconds(0, 0);
        candleTime.setMinutes(Math.floor(candleTime.getMinutes() / bucketMinutes) * bucketMinutes);
    } else if (normalizedInterval.endsWith("hour")) {
        const bucketHours = Math.max(1, Number.parseInt(normalizedInterval.replace("hour", ""), 10) || 1);
        candleTime.setMinutes(0, 0, 0);
        candleTime.setHours(Math.floor(candleTime.getHours() / bucketHours) * bucketHours);
    } else {
        candleTime.setHours(0, 0, 0, 0);
    }
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
            interval,
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
    if (!item || typeof item !== "object") return section;
    const record = item as Record<string, unknown>;
    const value = record.headline ?? record.title ?? record.summary ?? record.reason ?? record.quarter ?? section;
    return String(value).trim() || section;
}

function eventSections(feeds: MarketIntelligenceFeeds): [MarkerSection, unknown[]][] {
    return [
        ["news", feeds.news],
        ["announcements", feeds.announcements],
        ["earnings", feeds.earnings],
        ["concalls", feeds.concalls],
        ["alerts", feeds.alerts],
    ];
}

function buildAggregatedMarkers(snapshot: MarketChartSnapshot | null, feeds: MarketIntelligenceFeeds): AggregatedMarker[] {
    if (!snapshot?.candles.length) return [];

    const dayToCandle = new Map<string, UTCTimestamp>();
    for (const candle of snapshot.candles) {
        const key = dayKeyFromDate(candle.time);
        if (!key) continue;
        dayToCandle.set(key, toChartTime(candle.time));
    }

    const grouped = new Map<string, ChartEvent[]>();
    for (const [section, items] of eventSections(feeds)) {
        for (const item of items) {
            const date = eventDateFor(section, item);
            const dayKey = date ? dayKeyFromDate(date) : null;
            if (!date || !dayKey || !dayToCandle.has(dayKey)) continue;
            const current = grouped.get(dayKey) ?? [];
            current.push({ date, headline: eventTextFor(section, item), section });
            grouped.set(dayKey, current);
        }
    }

    return [...grouped.entries()]
        .sort((first, second) => second[0].localeCompare(first[0]))
        .slice(0, 12)
        .map(([dayKey, events]) => {
            const time = dayToCandle.get(dayKey) as UTCTimestamp;
            return {
                time,
                events,
                marker: {
                    time,
                    position: "belowBar" as const,
                    shape: "circle" as const,
                    color: events.length === 1 ? markerColor(events[0].section) : "#6b7280",
                    text: String(Math.min(events.length, 9)),
                },
            };
        })
        .sort((first, second) => Number(first.time) - Number(second.time));
}

function markerColor(section: MarkerSection): string {
    if (section === "news") return "#0ea5e9";
    if (section === "announcements") return "#f97316";
    if (section === "earnings") return "#eab308";
    if (section === "concalls") return "#06b6d4";
    return "#f43f5e";
}

function readableDate(value: string | null): string {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatPrice(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatVolume(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
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
    const [activeRangeId, setActiveRangeId] = useState<RangePreset["id"]>("3M");
    const [liveSnapshot, setLiveSnapshot] = useState<MarketChartSnapshot | null>(state.snapshot);
    const [rangeLoading, setRangeLoading] = useState(false);
    const [rangeError, setRangeError] = useState("");
    const [selectedMarker, setSelectedMarker] = useState<AggregatedMarker | null>(null);
    const [hoveredCandle, setHoveredCandle] = useState<HoveredCandle | null>(null);
    const metadata = symbolMetadata[symbol];
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const aggregatedMarkersRef = useRef<AggregatedMarker[]>([]);
    const candlesRef = useRef<MarketChartSnapshot["candles"]>([]);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const fittedRef = useRef(false);

    useEffect(() => {
        setActiveRangeId("3M");
        setLiveSnapshot(state.snapshot);
        setRangeError("");
        setSelectedMarker(null);
        setHoveredCandle(state.snapshot?.candles.at(-1) ?? null);
        fittedRef.current = false;
    }, [state.snapshot, symbol]);

    const snapshot = liveSnapshot;
    const raw = quoteRaw(snapshot);
    const latestPrice = snapshot?.latest_quote?.ltp ?? null;
    const activeRange = RANGE_PRESETS.find((item) => item.id === activeRangeId) ?? RANGE_PRESETS[3];
    const aggregatedMarkers = useMemo(() => buildAggregatedMarkers(snapshot, feeds), [feeds, snapshot]);
    useEffect(() => {
        aggregatedMarkersRef.current = aggregatedMarkers;
    }, [aggregatedMarkers]);
    useEffect(() => {
        candlesRef.current = snapshot?.candles ?? [];
    }, [snapshot?.candles]);

    async function loadRange(nextRangeId: RangePreset["id"]) {
        if (!account?.account_id || !instrument) return;
        const nextRange = RANGE_PRESETS.find((item) => item.id === nextRangeId);
        if (!nextRange) return;
        setActiveRangeId(nextRangeId);
        setRangeError("");
        setSelectedMarker(null);
        setRangeLoading(true);
        try {
            const nextSnapshot = await getMarketChartData(account.account_id, {
                instrument,
                include_live_quote: true,
                ...nextRange.request,
            });
            setLiveSnapshot(nextSnapshot);
            setHoveredCandle(nextSnapshot.candles.at(-1) ?? null);
            fittedRef.current = false;
        } catch (caught) {
            setRangeError(parseActionError(caught).message);
        } finally {
            setRangeLoading(false);
        }
    }

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!chartRef.current) {
            chartRef.current = createChart(container, {
                autoSize: true,
                layout: {
                    background: { type: ColorType.Solid, color: "#f7f3ea" },
                    textColor: "#5a5348",
                },
                grid: {
                    vertLines: { color: "rgba(163, 124, 49, 0.08)" },
                    horzLines: { color: "rgba(163, 124, 49, 0.08)" },
                },
                rightPriceScale: {
                    borderColor: "rgba(163, 124, 49, 0.16)",
                },
                timeScale: {
                    borderColor: "rgba(163, 124, 49, 0.16)",
                    timeVisible: true,
                    secondsVisible: false,
                    rightOffset: 6,
                },
                crosshair: {
                    vertLine: { color: "rgba(161, 98, 7, 0.24)" },
                    horzLine: { color: "rgba(161, 98, 7, 0.24)" },
                },
            });
            candleSeriesRef.current = chartRef.current.addSeries(CandlestickSeries, {
                upColor: "#18946b",
                downColor: "#b45309",
                wickUpColor: "#18946b",
                wickDownColor: "#b45309",
                borderVisible: false,
                priceLineVisible: false,
                lastValueVisible: true,
            });
            volumeSeriesRef.current = chartRef.current.addSeries(HistogramSeries, {
                priceFormat: { type: "volume" },
                priceScaleId: "",
            });
            volumeSeriesRef.current.priceScale().applyOptions({
                scaleMargins: { top: 0.82, bottom: 0 },
            });
            markersRef.current = createSeriesMarkers(candleSeriesRef.current, []);
            chartRef.current.subscribeClick((param: MouseEventParams<Time>) => {
                if (!param.time) {
                    setSelectedMarker(null);
                    return;
                }
                const match = aggregatedMarkersRef.current.find((item) => item.time === param.time);
                setSelectedMarker(match ?? null);
            });
            chartRef.current.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
                if (!param.time) {
                    setHoveredCandle(candlesRef.current.at(-1) ?? null);
                    return;
                }
                const epochSeconds = typeof param.time === "number" ? param.time : null;
                const isoTime = epochSeconds ? new Date(epochSeconds * 1000).toISOString() : null;
                if (!isoTime) {
                    setHoveredCandle(candlesRef.current.at(-1) ?? null);
                    return;
                }
                const candle = candlesRef.current.find((item) => item.time === isoTime);
                setHoveredCandle(candle ?? candlesRef.current.at(-1) ?? null);
            });
        }
    }, []);

    useEffect(() => {
        if (!snapshot?.candles.length) return;
        if (!hoveredCandle) {
            setHoveredCandle(snapshot.candles.at(-1) ?? null);
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
                    color: item.close >= item.open ? "rgba(24, 148, 107, 0.24)" : "rgba(180, 83, 9, 0.24)",
                }))
        );
        markersRef.current?.setMarkers(aggregatedMarkers.map((item) => item.marker));
        if (!fittedRef.current) {
            chartRef.current?.timeScale().fitContent();
            fittedRef.current = true;
        }
    }, [aggregatedMarkers, snapshot]);

    useEffect(() => {
        const container = containerRef.current;
        const chart = chartRef.current;
        if (!container || !chart) return;
        const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        if (!snapshot?.candles.length || !account?.account_id || !instrument || !user?.id) return;
        const intradayRange = activeRange.id === "1D" || activeRange.id === "5D";
        if (!intradayRange) return;

        const url = new URL(getPublicApiBaseUrl());
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/broker-accounts/${account.account_id}/data/stream/ws`;
        url.searchParams.set("user_id", user.id);
        const socket = new WebSocket(url.toString());
        socket.onopen = () => {
            socket.send(JSON.stringify({ type: "subscribe", instruments: [instrument] }));
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
            setLiveSnapshot((current) =>
                current
                    ? mergeLiveQuote(
                          current,
                          row as Record<string, unknown>,
                          activeRange.request.intraday_interval ?? "1minute"
                      )
                    : current
            );
        };
        return () => socket.close();
    }, [account?.account_id, activeRange.id, activeRange.request.intraday_interval, instrument, snapshot?.candles.length, user?.id]);

    useEffect(() => {
        return () => {
            markersRef.current?.detach();
            chartRef.current?.remove();
            markersRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            chartRef.current = null;
        };
    }, []);

    return (
        <section className="overflow-hidden border border-border/70 bg-[linear-gradient(180deg,#fbf8f1,#f4efe4)]">
            <div className="border-b border-border/60 px-4 py-4">
                <div className="flex flex-col gap-4 min-[980px]:flex-row min-[980px]:items-start min-[980px]:justify-between">
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
                        <Metric label="LTP" value={formatPrice(latestPrice)} emphasis />
                        <Metric label="Open" value={displayRaw(raw, ["open", "open_price"])} />
                        <Metric label="High" value={displayRaw(raw, ["high", "high_price"])} />
                        <Metric label="Low" value={displayRaw(raw, ["low", "low_price"])} />
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    {RANGE_PRESETS.map((range) => (
                        <button
                            key={range.id}
                            type="button"
                            onClick={() => void loadRange(range.id)}
                            className={cn(
                                "h-8 min-w-11 border px-3 text-xs font-semibold uppercase tracking-[0.14em] transition-colors",
                                range.id === activeRangeId
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border/70 bg-background/65 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            )}
                            disabled={rangeLoading}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="relative">
                <div className="h-[460px] w-full" ref={containerRef} />
                {(state.isLoading || rangeLoading) && (
                    <div className="absolute inset-0 flex items-center justify-center gap-3 bg-[#f7f3ea]/85 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading {activeRange.label} chart...
                    </div>
                )}
                {!state.isLoading && !rangeLoading && (state.error || rangeError) ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#f7f3ea]/85 px-6 text-center text-sm text-destructive">
                        {state.error || rangeError}
                    </div>
                ) : null}
                {!state.isLoading && !rangeLoading && !(state.error || rangeError) && !snapshot?.candles.length ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#f7f3ea]/85 px-6 text-center text-sm text-muted-foreground">
                        No broker candle history is available for this symbol yet.
                    </div>
                ) : null}
            </div>

            <div className="grid gap-3 border-t border-border/40 bg-background/35 px-4 py-3 text-sm min-[820px]:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(90px,1fr))]">
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Candle</p>
                    <p className="mt-1 truncate font-medium text-foreground">
                        {readableDate(hoveredCandle?.time ?? snapshot?.last_price_time ?? null)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Interval {hoveredCandle?.interval ?? activeRange.request.intraday_interval ?? activeRange.request.daily_interval}
                    </p>
                </div>
                <Metric label="Open" value={formatPrice(hoveredCandle?.open)} />
                <Metric label="High" value={formatPrice(hoveredCandle?.high)} />
                <Metric label="Low" value={formatPrice(hoveredCandle?.low)} />
                <Metric label="Close" value={formatPrice(hoveredCandle?.close)} />
                <Metric label="Volume" value={formatVolume(hoveredCandle?.volume)} />
            </div>

            <div className="border-t border-border/60 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-[0.14em] text-primary">Events</span>
                    <span>Markers are grouped by day. Click a marker bubble to inspect the linked items.</span>
                </div>
                {selectedMarker ? (
                    <div className="mt-3 border border-border/70 bg-background/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Selected event day</p>
                                <h3 className="mt-1 text-sm font-semibold text-foreground">
                                    {readableDate(selectedMarker.events[0]?.date ?? null)}
                                </h3>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => setSelectedMarker(null)}>
                                Clear
                            </Button>
                        </div>
                        <div className="mt-4 grid gap-3">
                            {selectedMarker.events.map((event, index) => (
                                <article className="border-l-2 border-border pl-3" key={`${event.section}-${event.date}-${index}`}>
                                    <div className="flex items-center gap-2">
                                        <span className={cn("size-2 rounded-full", sectionTone[event.section])} />
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                            {event.section}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{readableDate(event.date)}</span>
                                    </div>
                                    <p className="mt-1 text-sm text-foreground">{event.headline}</p>
                                </article>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {aggregatedMarkers.length ? (
                            aggregatedMarkers.map((marker, index) => (
                                <button
                                    key={`${marker.time}-${index}`}
                                    type="button"
                                    className="border border-border/70 bg-background/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                                    onClick={() => setSelectedMarker(marker)}
                                >
                                    <span className="block font-semibold text-foreground">
                                        {new Date(Number(marker.time) * 1000).toLocaleDateString("en-IN", {
                                            day: "2-digit",
                                            month: "short",
                                        })}
                                    </span>
                                    <span>{marker.events.length} linked event{marker.events.length > 1 ? "s" : ""}</span>
                                </button>
                            ))
                        ) : (
                            <p className="text-sm text-muted-foreground">No linked news or alert events fall inside the current chart range.</p>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

function Metric({ emphasis = false, label, value }: { emphasis?: boolean; label: string; value: string }) {
    return (
        <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <p className={cn("mt-1 text-foreground", emphasis ? "text-xl font-semibold" : "text-sm")}>{value}</p>
        </div>
    );
}
