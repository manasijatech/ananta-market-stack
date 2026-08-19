import { isRecord, numberFrom } from "@/lib/adaptive-workspace/tool-envelope";

const LTP_KEYS = ["ltp", "last_price", "lastPrice", "lastTradedPrice", "LastTradedPrice"];
const CHANGE_KEYS = [
    "netChange",
    "net_change",
    "change",
    "day_change",
    "absoluteChange",
    "ch",
    "change_abs"
];
const CHANGE_PCT_KEYS = [
    "pChange",
    "percent_change",
    "percentageChange",
    "day_change_percentage",
    "day_change_perc",
    "change_pct",
    "changePercent",
    "chp"
];
const CLOSE_KEYS = ["close", "close_price", "previous_close", "prev_close", "previousClose"];

function pickNumber(sources: Array<Record<string, unknown> | null | undefined>, keys: string[]): number | null {
    for (const source of sources) {
        if (!source) continue;
        const value = numberFrom(source, keys);
        if (value != null) return value;
    }
    return null;
}

function nestedSources(row: Record<string, unknown>): Array<Record<string, unknown>> {
    const detail = isRecord(row.detail) ? row.detail : null;
    const raw = detail && isRecord(detail.raw) ? detail.raw : isRecord(row.raw) ? row.raw : null;
    const ohlc = raw && isRecord(raw.ohlc) ? raw.ohlc : detail && isRecord(detail.ohlc) ? detail.ohlc : null;
    return [row, detail, raw, ohlc].filter((item): item is Record<string, unknown> => Boolean(item));
}

export function quoteMoveFromRecord(row: Record<string, unknown>): {
    change: number | null;
    changePercent: number | null;
    ltp: number | null;
} {
    const sources = nestedSources(row);
    const ltp = pickNumber(sources, LTP_KEYS);
    let change = pickNumber(sources, CHANGE_KEYS);
    let changePercent = pickNumber(sources, CHANGE_PCT_KEYS);
    const close = pickNumber(sources, CLOSE_KEYS);
    if (changePercent == null && ltp != null && close != null && close !== 0) {
        change = change ?? ltp - close;
        changePercent = (change / close) * 100;
    } else if (change == null && changePercent != null && close != null) {
        change = (changePercent / 100) * close;
    }
    return { change, changePercent, ltp };
}

export function formatSigned(value: number | null, suffix = ""): string {
    if (value == null || !Number.isFinite(value)) return "—";
    const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
    return `${value > 0 ? "+" : ""}${formatted}${suffix}`;
}

export function moveTone(value: number | null): "up" | "down" | "flat" {
    if (value == null || value === 0) return "flat";
    return value > 0 ? "up" : "down";
}
