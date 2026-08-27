"use client";

import { useEffect, useState } from "react";
import { HoldingsTableCard } from "@/components/adaptive-workspace/holdings-table-card";
import { SessionStatusCard } from "@/components/adaptive-workspace/session-status-card";
import { DeskAccountState, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { normalizeHoldings } from "@/components/brokers/normalizers";
import { useDeskAccounts } from "@/hooks/use-desk-data";
import { numberFrom } from "@/lib/adaptive-workspace/tool-envelope";
import { cn } from "@/lib/utils";
import { brokerReconnectCopy } from "@/lib/broker-auth-error";
import {
    getHoldingsResult,
    getPortfolioFundsResult,
    getQuotesResult,
    getSessionStatusResult,
    searchBrokerInstrumentsResult
} from "@/service/actions/broker";
import type { BrokerCode, InstrumentRef, InstrumentSearchRow, JsonObject, QuoteResponse, SessionStatus } from "@/service/types/broker";

type Props = {
    refreshNonce: number;
};

type HoldingsProps = Props & {
    vsIndex?: boolean;
};

const INDEX_INSTRUMENTS = [
    { exchange: "NSE", symbol: "NIFTY 50" },
    { exchange: "NSE", symbol: "NIFTY50" },
    { exchange: "NSE", symbol: "NIFTY" }
];

function formatPct(value: number | null) {
    if (value == null || !Number.isFinite(value)) return "—";
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(2)}%`;
}

function quoteChangePct(quote: QuoteResponse): number | null {
    const detail = quote.detail ?? {};
    const direct = numberFrom(detail, [
        "day_change_percentage",
        "dayChangePerc",
        "change_percent",
        "change_perc",
        "net_change_percent",
        "pChange",
        "percentageChange"
    ]);
    if (direct != null) return direct;
    const net = numberFrom(detail, ["net_change", "change", "day_change", "netChange"]);
    if (net != null && quote.ltp && quote.ltp !== net) {
        const previous = quote.ltp - net;
        if (previous) return (net / previous) * 100;
    }
    return null;
}

function holdingsSessionPct(data: JsonObject): number | null {
    const rows = normalizeHoldings(data);
    let weight = 0;
    let weighted = 0;
    for (const row of rows) {
        const value = (row.quantity || 0) * (row.last_price ?? row.average_price ?? 0);
        if (!value) continue;
        let pct = row.pnl_percent;
        if (pct == null && row.last_price != null && row.average_price) {
            pct = ((row.last_price - row.average_price) / row.average_price) * 100;
        }
        if (pct == null) continue;
        weight += value;
        weighted += value * pct;
    }
    return weight ? weighted / weight : null;
}

function isCashIndexRow(row: InstrumentSearchRow) {
    const type = `${row.instrument_type || ""} ${row.segment || ""}`.toUpperCase();
    if (/\b(CE|PE|FUT|FUTURE|OPT)\b/.test(type)) return false;
    const blob = `${row.symbol} ${row.trading_symbol || ""} ${row.name || ""}`.toUpperCase();
    if (blob.includes("QNIFTY") || blob.includes("GIFT NIFTY") || blob.includes("NIFTYIT") || blob.includes("BANKNIFTY")) {
        return false;
    }
    return /\bNIFTY\s*50\b/.test(blob) || blob.includes("NIFTY50");
}

function instrumentFromSearch(row: InstrumentSearchRow): InstrumentRef {
    const ids = row.identifiers ?? {};
    const text = (key: string) => {
        const value = ids[key];
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
    };
    return {
        exchange: row.exchange || "NSE",
        indmoney_scrip_code: text("indmoney_scrip_code"),
        arrow_token: text("arrow_token"),
        dhan_security_id: text("dhan_security_id"),
        dhan_exchange_segment: text("dhan_exchange_segment"),
        groww_trading_symbol: text("groww_trading_symbol") || row.trading_symbol,
        symbol: row.trading_symbol || row.symbol,
        upstox_instrument_key: text("upstox_instrument_key")
    };
}

async function loadIndexQuote(accountId: string): Promise<{ label: string; quote: QuoteResponse } | null> {
    const searched = await searchBrokerInstrumentsResult(accountId, { exchange: "NSE", limit: 20, q: "NIFTY 50" });
    const searchRows = searched.ok ? searched.data ?? [] : [];
    const candidates: InstrumentRef[] = [
        ...searchRows.filter(isCashIndexRow).slice(0, 4).map(instrumentFromSearch),
        ...INDEX_INSTRUMENTS
    ];
    for (const instrument of candidates) {
        const rows = await getQuotesResult(accountId, { instruments: [instrument] });
        if (!rows.ok || rows.authFailed) continue;
        const quote = (rows.data ?? []).find((item) => item.ltp != null && item.ltp !== 0) ?? rows.data?.[0];
        if (quote?.ltp) {
            return { label: instrument.symbol || "NIFTY 50", quote };
        }
    }
    return null;
}

function VsIndexStrip({
    indexChange,
    indexLabel,
    indexLtp,
    portfolioChange
}: {
    indexChange: number | null;
    indexLabel: string;
    indexLtp: number | null;
    portfolioChange: number | null;
}) {
    const relative =
        portfolioChange != null && indexChange != null ? portfolioChange - indexChange : null;
    return (
        <div className="grid grid-cols-3 gap-2 border-b border-border/70 px-3 py-2 text-xs">
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {indexLabel}
                </p>
                <p className="font-mono font-semibold tabular-nums">
                    {indexLtp != null ? indexLtp.toLocaleString("en-IN") : "—"}
                </p>
                <p className={cn("tabular-nums", (indexChange ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                    {formatPct(indexChange)}
                </p>
            </div>
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Holdings</p>
                <p className={cn("font-mono font-semibold tabular-nums", (portfolioChange ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                    {formatPct(portfolioChange)}
                </p>
                <p className="text-muted-foreground">Weighted move</p>
            </div>
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Relative</p>
                <p className={cn("font-mono font-semibold tabular-nums", (relative ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                    {formatPct(relative)}
                </p>
                <p className="text-muted-foreground">vs index</p>
            </div>
        </div>
    );
}

export function LiveHoldingsWidget({ refreshNonce, vsIndex = false }: HoldingsProps) {
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const [output, setOutput] = useState<Record<string, unknown> | null>(null);
    const [index, setIndex] = useState<{ label: string; quote: QuoteResponse } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account) {
            if (!accountsLoading) setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void (async () => {
            const holdingsResult = await getHoldingsResult(account.id);
            if (cancelled) return;
            if (!holdingsResult.ok) {
                setOutput(null);
                setIndex(null);
                setError(
                    holdingsResult.authFailed
                        ? brokerReconnectCopy(holdingsResult.error || "")
                        : holdingsResult.error || "Could not load holdings."
                );
                setLoading(false);
                return;
            }
            const fundsResult = await getPortfolioFundsResult(account.id);
            const nextIndex = await loadIndexQuote(account.id);
            if (cancelled) return;
            setOutput({
                account: { account_id: account.id, broker_code: account.broker_code, label: account.label },
                data: { ...(holdingsResult.data as JsonObject), ...(fundsResult.data ?? {}) },
                ok: true
            });
            setIndex(nextIndex);
            setError(null);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [account, accountsLoading, refreshNonce]);

    const holdingsData = output && typeof output.data === "object" && output.data ? (output.data as JsonObject) : {};
    const showStrip = vsIndex || Boolean(index);

    return (
        <WidgetState error={error || accountError} loading={accountsLoading || loading} loadingLabel="Loading portfolio">
            <DeskAccountState account={account} accounts={accounts}>
                {showStrip ? (
                    <VsIndexStrip
                        indexChange={index ? quoteChangePct(index.quote) : null}
                        indexLabel={index?.label ?? "Nifty 50"}
                        indexLtp={index?.quote.ltp ?? null}
                        portfolioChange={holdingsSessionPct(holdingsData)}
                    />
                ) : null}
                {vsIndex && !index ? (
                    <p className="px-3 pt-2 text-[11px] text-muted-foreground">
                        Index quote was unavailable. Holdings still loaded for this account.
                    </p>
                ) : null}
                {output ? <HoldingsTableCard input={{}} name="broker_get_portfolio" output={output} status="success" /> : null}
            </DeskAccountState>
        </WidgetState>
    );
}

export function LiveHealthWidget({ refreshNonce }: Props) {
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const [status, setStatus] = useState<SessionStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account) {
            if (!accountsLoading) setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void getSessionStatusResult(account.id, account.broker_code as BrokerCode)
            .then((next) => {
                if (cancelled) return;
                if (next.ok) {
                    setStatus(next.data);
                    setError(null);
                } else {
                    setStatus(null);
                    setError(
                        next.authFailed
                            ? brokerReconnectCopy(next.error || "")
                            : next.error || "Could not load broker health."
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, accountsLoading, refreshNonce]);

    return (
        <WidgetState error={error || accountError} loading={accountsLoading || loading} loadingLabel="Checking broker session">
            <DeskAccountState account={account} accounts={accounts}>
                {status ? (
                    <SessionStatusCard
                        input={{}}
                        name="broker_get_session_status"
                        output={{ ok: true, session: status }}
                        status="success"
                    />
                ) : null}
            </DeskAccountState>
        </WidgetState>
    );
}
