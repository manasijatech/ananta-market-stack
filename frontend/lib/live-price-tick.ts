import type { LivePriceTick } from "@/service/types/alerts";

export function livePriceNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
}

function numericField(...values: unknown[]): number | string | null {
    for (const value of values) {
        if (livePriceNumber(value) !== null) return value as number | string;
    }
    return null;
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function flattenLivePriceTick(
    source: Record<string, unknown> | LivePriceTick | null | undefined,
    extras: Partial<LivePriceTick> = {}
): LivePriceTick | null {
    const quote = record(source) ?? {};
    const detail = record(quote.detail);
    const raw = record(quote.raw) ?? record(detail?.raw) ?? {};
    const ohlc = record(quote.ohlc) ?? record(raw.ohlc) ?? record(detail?.ohlc) ?? {};
    const depth = record(quote.depth) ?? record(raw.depth);
    const buy = Array.isArray(depth?.buy) ? record(depth.buy[0]) : null;
    const sell = Array.isArray(depth?.sell) ? record(depth.sell[0]) : null;
    const symbol = String(extras.symbol ?? quote.symbol ?? "").trim();
    if (!symbol && !Object.keys(quote).length) return null;
    const ltp = numericField(quote.ltp, quote.last_price, quote.lastPrice, raw.last_price, raw.ltp);
    const change = numericField(
        quote.change_pct,
        quote.day_change_perc,
        quote.day_change_percentage,
        raw.day_change_perc,
        raw.day_change_percentage,
        raw.pChange
    );
    return {
        ...(quote as Partial<LivePriceTick>),
        ...extras,
        symbol: symbol || String(extras.symbol ?? ""),
        exchange: extras.exchange ?? (typeof quote.exchange === "string" ? quote.exchange : null) ?? (typeof detail?.exchange === "string" ? detail.exchange : null),
        ltp,
        last_price: numericField(quote.last_price, ltp),
        open: numericField(quote.open, ohlc.open, raw.open),
        high: numericField(quote.high, ohlc.high, raw.high),
        low: numericField(quote.low, ohlc.low, raw.low),
        close: numericField(quote.close, ohlc.close, raw.close, raw.prev_close, quote.previous_close),
        day_change: numericField(quote.day_change, raw.day_change, raw.net_change, quote.net_change),
        day_change_perc: change,
        change_pct: change,
        volume: numericField(quote.volume, raw.volume, ohlc.volume),
        best_bid_price: numericField(quote.best_bid_price, raw.best_bid_price, buy?.price),
        best_ask_price: numericField(quote.best_ask_price, raw.best_ask_price, sell?.price),
        received_at: extras.received_at ?? (typeof quote.received_at === "string" ? quote.received_at : null)
    };
}

export function tickHasLivePrice(tick: LivePriceTick | undefined): boolean {
    return livePriceNumber(tick?.ltp ?? tick?.last_price) !== null;
}

export function mergeLivePriceTick(current: LivePriceTick | undefined, incoming: LivePriceTick): LivePriceTick {
    if (!current || !tickHasLivePrice(current)) return incoming;
    if (!tickHasLivePrice(incoming)) return current;
    const incomingChange = livePriceNumber(incoming.change_pct ?? incoming.day_change_perc);
    if (incomingChange !== null) return incoming;
    return {
        ...incoming,
        change_pct: current.change_pct ?? current.day_change_perc,
        day_change_perc: current.day_change_perc ?? current.change_pct,
        day_change: incoming.day_change ?? current.day_change,
        open: incoming.open ?? current.open,
        high: incoming.high ?? current.high,
        low: incoming.low ?? current.low,
        close: incoming.close ?? current.close,
        volume: incoming.volume ?? current.volume,
        best_bid_price: incoming.best_bid_price ?? current.best_bid_price,
        best_ask_price: incoming.best_ask_price ?? current.best_ask_price
    };
}
