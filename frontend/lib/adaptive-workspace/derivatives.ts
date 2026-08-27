import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";

export type OptionSideQuote = {
    delta: number | null;
    gamma: number | null;
    iv: number | null;
    ltp: number | null;
    oi: number | null;
    symbol: string;
    theta: number | null;
    vega: number | null;
};

export type OptionChainRow = {
    pe: OptionSideQuote;
    strike: number;
    ce: OptionSideQuote;
};

export type OptionChainView = {
    expiries: string[];
    message: string;
    rows: OptionChainRow[];
    spot: number | null;
    underlying: string;
    unsupported: boolean;
};

export type GreeksRow = {
    delta: number | null;
    gamma: number | null;
    iv: number | null;
    ltp: number | null;
    optionType: string;
    strike: number | null;
    symbol: string;
    theta: number | null;
    vega: number | null;
};

function asNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
    return null;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function firstRecord(value: unknown): Record<string, unknown> {
    if (isRecord(value)) return value;
    return {};
}

function nestedPayload(value: unknown): Record<string, unknown> {
    const root = firstRecord(value);
    const payload = firstRecord(root.payload);
    const data = firstRecord(root.data);
    const result = firstRecord(root.result);
    return { ...result, ...data, ...payload, ...root };
}

function greeksFrom(source: Record<string, unknown>): Pick<OptionSideQuote, "delta" | "gamma" | "theta" | "vega"> {
    const nested = firstRecord(source.greeks);
    const bag = Object.keys(nested).length ? nested : source;
    return {
        delta: asNumber(bag.delta ?? bag.Delta),
        gamma: asNumber(bag.gamma ?? bag.Gamma),
        theta: asNumber(bag.theta ?? bag.Theta),
        vega: asNumber(bag.vega ?? bag.Vega)
    };
}

function sideFrom(value: unknown, fallbackSymbol = ""): OptionSideQuote {
    const source = firstRecord(value);
    const greeks = greeksFrom(source);
    return {
        ...greeks,
        iv: asNumber(source.iv ?? source.implied_volatility ?? source.impliedVolatility ?? source.IV),
        ltp: asNumber(source.ltp ?? source.last_price ?? source.lastPrice ?? source.close ?? source.premium),
        oi: asNumber(source.oi ?? source.open_interest ?? source.openInterest ?? source.OI),
        symbol: asString(source.symbol ?? source.tradingsymbol ?? source.trading_symbol ?? source.tsym) || fallbackSymbol
    };
}

function emptySide(): OptionSideQuote {
    return { delta: null, gamma: null, iv: null, ltp: null, oi: null, symbol: "", theta: null, vega: null };
}

function strikeValue(value: unknown, fallback = 0): number {
    return asNumber(value) ?? fallback;
}

function rowsFromStrikeMap(strikes: Record<string, unknown>): OptionChainRow[] {
    return Object.entries(strikes)
        .map(([key, value]) => {
            const row = firstRecord(value);
            const ce = row.CE ?? row.ce ?? row.call ?? row.Call;
            const pe = row.PE ?? row.pe ?? row.put ?? row.Put;
            return {
                strike: strikeValue(row.strike ?? row.strike_price ?? key),
                ce: sideFrom(ce),
                pe: sideFrom(pe)
            };
        })
        .filter((row) => Number.isFinite(row.strike))
        .sort((left, right) => left.strike - right.strike);
}

function rowsFromArray(items: unknown[]): OptionChainRow[] {
    const byStrike = new Map<number, OptionChainRow>();
    for (const item of items) {
        const row = firstRecord(item);
        const strike = strikeValue(row.strike ?? row.strike_price ?? row.StrikePrice ?? row.strikePrice);
        if (!Number.isFinite(strike) || strike <= 0) continue;
        const existing = byStrike.get(strike) ?? { strike, ce: emptySide(), pe: emptySide() };
        const optionType = asString(row.option_type ?? row.optionType ?? row.type ?? row.right).toUpperCase();
        const hasCe = Boolean(row.CE ?? row.ce ?? row.call);
        const hasPe = Boolean(row.PE ?? row.pe ?? row.put);
        if (hasCe || hasPe) {
            if (hasCe) existing.ce = sideFrom(row.CE ?? row.ce ?? row.call, existing.ce.symbol);
            if (hasPe) existing.pe = sideFrom(row.PE ?? row.pe ?? row.put, existing.pe.symbol);
        } else if (optionType === "PE" || optionType === "PUT") {
            existing.pe = sideFrom(row, existing.pe.symbol);
        } else {
            existing.ce = sideFrom(row, existing.ce.symbol);
        }
        byStrike.set(strike, existing);
    }
    return [...byStrike.values()].sort((left, right) => left.strike - right.strike);
}

function expiriesFrom(source: Record<string, unknown>): string[] {
    const candidates = [source.expiry_dates, source.expiries, source.expiryList, source.ExpiryList, source.expiry_list];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.map(asString).filter(Boolean);
        }
    }
    const nested = firstRecord(source.data);
    if (Array.isArray(nested.expiry_dates) || Array.isArray(nested.expiries)) {
        return expiriesFrom(nested);
    }
    return [];
}

export function normalizeOptionChain(payload: unknown): OptionChainView {
    const root = firstRecord(payload);
    const nested = nestedPayload(payload);
    const status = asString(root.status || nested.status).toLowerCase();
    const message = asString(root.message || nested.message || nested.guidance);
    const unsupported = status === "unsupported" || /not implemented/i.test(message);
    const strikes = nested.strikes;
    const rows = isRecord(strikes)
        ? rowsFromStrikeMap(strikes)
        : Array.isArray(nested.oc)
          ? rowsFromArray(nested.oc)
          : Array.isArray(nested.options)
            ? rowsFromArray(nested.options)
            : Array.isArray(nested.data)
              ? rowsFromArray(nested.data)
              : Array.isArray(payload)
                ? rowsFromArray(payload)
                : [];
    return {
        expiries: expiriesFrom(nested),
        message,
        rows,
        spot: asNumber(nested.spot ?? nested.underlying_price ?? nested.underlyingPrice ?? nested.ltp ?? nested.underlying_ltp),
        underlying: asString(nested.underlying ?? nested.symbol ?? nested.underlying_symbol),
        unsupported
    };
}

export function normalizeGreeks(payload: unknown): { message: string; rows: GreeksRow[]; unsupported: boolean } {
    const chain = normalizeOptionChain(payload);
    if (chain.unsupported) {
        return { message: chain.message, rows: [], unsupported: true };
    }
    if (chain.rows.length) {
        const rows: GreeksRow[] = [];
        for (const row of chain.rows) {
            if (row.ce.delta != null || row.ce.gamma != null || row.ce.theta != null || row.ce.vega != null) {
                rows.push({
                    delta: row.ce.delta,
                    gamma: row.ce.gamma,
                    iv: row.ce.iv,
                    ltp: row.ce.ltp,
                    optionType: "CE",
                    strike: row.strike,
                    symbol: row.ce.symbol || `${chain.underlying} ${row.strike} CE`,
                    theta: row.ce.theta,
                    vega: row.ce.vega
                });
            }
            if (row.pe.delta != null || row.pe.gamma != null || row.pe.theta != null || row.pe.vega != null) {
                rows.push({
                    delta: row.pe.delta,
                    gamma: row.pe.gamma,
                    iv: row.pe.iv,
                    ltp: row.pe.ltp,
                    optionType: "PE",
                    strike: row.strike,
                    symbol: row.pe.symbol || `${chain.underlying} ${row.strike} PE`,
                    theta: row.pe.theta,
                    vega: row.pe.vega
                });
            }
        }
        if (rows.length) return { message: chain.message, rows, unsupported: false };
    }
    const nested = nestedPayload(payload);
    const greeks = greeksFrom(nested);
    const hasAny = [greeks.delta, greeks.gamma, greeks.theta, greeks.vega].some((item) => item != null);
    if (!hasAny) {
        return { message: chain.message || "No greeks in this broker response.", rows: [], unsupported: false };
    }
    return {
        message: chain.message,
        rows: [
            {
                ...greeks,
                iv: asNumber(nested.iv ?? nested.implied_volatility),
                ltp: asNumber(nested.ltp ?? nested.last_price ?? nested.premium),
                optionType: asString(nested.option_type ?? nested.optionType).toUpperCase() || "—",
                strike: asNumber(nested.strike),
                symbol: asString(nested.symbol) || chain.underlying || "Contract"
            }
        ],
        unsupported: false
    };
}

function metricLabel(key: string) {
    return key.replaceAll("_", " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function metricNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
    return null;
}

export function flattenMetricRows(payload: unknown, limit = 16): Array<{ label: string; value: string }> {
    const nested = nestedPayload(payload);
    const rows: Array<{ label: string; value: string }> = [];
    const visit = (source: Record<string, unknown>, depth = 0) => {
        for (const [key, value] of Object.entries(source)) {
            if (["status", "message", "guidance", "raw", "payload", "data", "result"].includes(key)) {
                if (isRecord(value) && depth < 2) visit(value, depth + 1);
                continue;
            }
            const numeric = metricNumber(value);
            if (numeric != null) {
                rows.push({
                    label: metricLabel(key),
                    value: new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(numeric)
                });
            } else if (isRecord(value) && depth < 2) {
                visit(value, depth + 1);
            } else if (typeof value === "string" && value.trim() && value.length < 80) {
                rows.push({ label: metricLabel(key), value: value.trim() });
            }
            if (rows.length >= limit) return;
        }
    };
    visit(nested);
    return rows;
}
