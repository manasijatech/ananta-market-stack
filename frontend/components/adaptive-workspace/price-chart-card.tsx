"use client";

import { ColorType, LineSeries, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import {
    asToolEnvelope,
    isRecord,
    numberFrom,
    provenanceFromEnvelope,
    stringFrom,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";

type CandlePoint = { time: UTCTimestamp; value: number };

function collectCandleArrays(source: unknown, depth = 0): unknown[][] {
    if (depth > 4 || source == null) return [];
    if (Array.isArray(source)) {
        if (source.length && (Array.isArray(source[0]) || isRecord(source[0]))) {
            return [source];
        }
        return [];
    }
    if (!isRecord(source)) return [];
    const keys = ["candles", "data", "payload", "ohlc", "historical", "result"];
    const found: unknown[][] = [];
    for (const key of keys) {
        found.push(...collectCandleArrays(source[key], depth + 1));
    }
    return found;
}

function toUnix(value: unknown): UTCTimestamp | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return (value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)) as UTCTimestamp;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed / 1000) as UTCTimestamp;
        }
    }
    return null;
}

function extractCloses(envelope: Record<string, unknown> | null): CandlePoint[] {
    if (!envelope) return [];
    const payload = isRecord(envelope.data) ? envelope.data : envelope;
    for (const rows of collectCandleArrays(payload)) {
        const points: CandlePoint[] = [];
        for (const row of rows) {
            if (Array.isArray(row)) {
                const time = toUnix(row[0]);
                const close = typeof row[4] === "number" ? row[4] : typeof row[1] === "number" ? row[1] : Number(row[4] ?? row[1]);
                if (time != null && Number.isFinite(close)) {
                    points.push({ time, value: close });
                }
                continue;
            }
            if (!isRecord(row)) continue;
            const time = toUnix(row.time ?? row.timestamp ?? row.date ?? row.datetime);
            const close = numberFrom(row, ["close", "c", "ltp", "last_price", "value"]);
            if (time != null && close != null) {
                points.push({ time, value: close });
            }
        }
        if (points.length >= 2) {
            return points.sort((a, b) => a.time - b.time);
        }
    }
    return [];
}

export function PriceChartCard({ input, name, output, status }: CustomToolRendererProps) {
    const { resolvedTheme } = useTheme();
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const points = ok ? extractCloses(envelope) : [];
    const instrument = isRecord(input.instrument) ? input.instrument : {};
    const symbol = stringFrom(instrument, ["symbol", "tradingsymbol"], "Instrument");
    const hostRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const dark = resolvedTheme === "dark";
    const seriesData = useMemo(() => points, [points]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !seriesData.length) return;
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
        series.setData(seriesData);
        chart.timeScale().fitContent();
        chartRef.current = chart;
        return () => {
            chart.remove();
            chartRef.current = null;
        };
    }, [dark, seriesData]);

    return (
        <ToolCardShell
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel="Loading historical candles"
            provenance={provenanceFromEnvelope(envelope, name)}
            title={`${symbol} chart`}
        >
            {seriesData.length ? (
                <div className="h-[180px] w-full" ref={hostRef} />
            ) : (
                <p className="text-sm text-muted-foreground">No historical candles could be parsed from this broker payload.</p>
            )}
        </ToolCardShell>
    );
}
