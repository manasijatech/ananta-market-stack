"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
    deleteInstrumentStorage,
    getDataCapabilities,
    getDataOhlc,
    getDataQuotes,
    getGreeksData,
    getHistoricalData,
    getHoldings,
    getOptionChainData,
    getOrders,
    getPortfolioFunds,
    getPositions,
    getProfile,
    getStreamStatus,
    getTrades,
    searchBrokerInstruments,
    syncInstrumentData,
    syncInstrumentCsv
} from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { brokerNames, formatDate, StatusBadge, statusTone } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
    BrokerAccountDetail,
    DataCapabilities,
    InstrumentSearchRow,
    InstrumentSyncResult,
    JsonObject,
    StreamStatus
} from "@/service/types/broker";

function pretty(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function isoLocal(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function numberOrUndefined(value: string): number | undefined {
    if (!value.trim()) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function integerOrUndefined(value: string): number | undefined {
    if (!value.trim()) {
        return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

const SAMPLE_SYMBOL = "RELIANCE";
const SAMPLE_EXCHANGE = "NSE";
const SAMPLE_STRIKE = "1400";
const SAMPLE_OPTION_TYPE = "CE";
const SAMPLE_OPTION_PRICE = "25";

type MarketMode = "quote" | "ohlc" | "historical" | "option_chain" | "greeks";

const MARKET_MODE_FIELDS: Record<MarketMode, string[]> = {
    quote: ["symbol", "exchange"],
    ohlc: ["symbol", "exchange"],
    historical: ["symbol", "exchange", "interval", "from_date", "to_date"],
    option_chain: ["symbol", "exchange", "expiry"],
    greeks: [
        "symbol",
        "exchange",
        "expiry",
        "strike",
        "option_type",
        "price",
        "underlying_price",
        "volatility",
        "interest_rate",
        "days_to_expiry"
    ]
};

const MARKET_MODE_COPY: Record<MarketMode, { title: string; description: string }> = {
    quote: {
        title: "Quote request",
        description: "Uses symbol and exchange to fetch the latest quote payload for one instrument."
    },
    ohlc: {
        title: "OHLC request",
        description: "Uses symbol and exchange to fetch the latest OHLC snapshot for one instrument."
    },
    historical: {
        title: "Historical request",
        description: "Uses symbol, exchange, interval, and time range to request candle history."
    },
    option_chain: {
        title: "Option chain request",
        description: "Uses symbol, exchange, and expiry to fetch the chain for one underlying."
    },
    greeks: {
        title: "Greeks request",
        description:
            "Uses symbol, exchange, expiry, strike, and option type. The pricing fields are currently kept for future enrichment and may be ignored by the broker adapter."
    }
};

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
    return (
        <section className="border-t border-border py-6">
            <div className="mb-4">
                <h2 className="text-lg font-bold">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            {children}
        </section>
    );
}

function MarketField({
    active,
    children,
    help,
    label
}: {
    active: boolean;
    children: React.ReactNode;
    help?: string;
    label: string;
}) {
    return (
        <div className={cn("grid gap-2 border p-3", active ? "border-primary/50 bg-primary/5" : "border-border")}>
            <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
            {children}
            {help ? <div className="text-xs text-muted-foreground">{help}</div> : null}
        </div>
    );
}

export function BrokerDataTest({
    account,
    sessionActive,
    initialCapabilities,
    initialStreamStatus,
    apiBaseUrl
}: {
    account: BrokerAccountDetail;
    sessionActive: boolean;
    initialCapabilities: DataCapabilities;
    initialStreamStatus: StreamStatus;
    apiBaseUrl: string;
}) {
    const [capabilities, setCapabilities] = useState(initialCapabilities);
    const [streamStatus, setStreamStatus] = useState(initialStreamStatus);
    const [syncResult, setSyncResult] = useState<InstrumentSyncResult | null>(null);
    const [searchQuery, setSearchQuery] = useState(SAMPLE_SYMBOL);
    const [searchExchange, setSearchExchange] = useState(SAMPLE_EXCHANGE);
    const [searchRows, setSearchRows] = useState<InstrumentSearchRow[]>([]);
    const [responseTitle, setResponseTitle] = useState("");
    const [responseBody, setResponseBody] = useState("");
    const [error, setError] = useState("");
    const [marketMode, setMarketMode] = useState<MarketMode>("quote");
    const [marketSymbol, setMarketSymbol] = useState(SAMPLE_SYMBOL);
    const [marketExchange, setMarketExchange] = useState(SAMPLE_EXCHANGE);
    const [marketInterval, setMarketInterval] = useState("day");
    const [marketExpiry, setMarketExpiry] = useState(new Date().toISOString().slice(0, 10));
    const [marketFromDate, setMarketFromDate] = useState(isoLocal(new Date(new Date().setHours(9, 15, 0, 0))));
    const [marketToDate, setMarketToDate] = useState(isoLocal(new Date(new Date().setHours(15, 30, 0, 0))));
    const [marketStrike, setMarketStrike] = useState(SAMPLE_STRIKE);
    const [marketOptionType, setMarketOptionType] = useState(SAMPLE_OPTION_TYPE);
    const [marketPrice, setMarketPrice] = useState(SAMPLE_OPTION_PRICE);
    const [marketUnderlyingPrice, setMarketUnderlyingPrice] = useState("");
    const [marketVolatility, setMarketVolatility] = useState("");
    const [marketInterestRate, setMarketInterestRate] = useState("");
    const [marketDaysToExpiry, setMarketDaysToExpiry] = useState("");
    const [wsSymbol, setWsSymbol] = useState(SAMPLE_SYMBOL);
    const [wsExchange, setWsExchange] = useState(SAMPLE_EXCHANGE);
    const [wsMessages, setWsMessages] = useState<JsonObject[]>([]);
    const [wsKeepHistory, setWsKeepHistory] = useState(false);
    const [wsConnected, setWsConnected] = useState(false);
    const [isPending, startTransition] = useTransition();
    const wsRef = useRef<WebSocket | null>(null);
    const wsKeepHistoryRef = useRef(false);

    useEffect(() => {
        return () => {
            wsRef.current?.close();
            wsRef.current = null;
        };
    }, []);

    useEffect(() => {
        wsKeepHistoryRef.current = wsKeepHistory;
    }, [wsKeepHistory]);

    useEffect(() => {
        if (!wsKeepHistory && wsMessages.length > 1) {
            setWsMessages((current) => current.slice(0, 1));
        }
    }, [wsKeepHistory, wsMessages.length]);

    function setPayload(title: string, body: unknown) {
        setResponseTitle(title);
        setResponseBody(pretty(body));
    }

    function refreshMeta() {
        startTransition(async () => {
            try {
                const [nextCapabilities, nextStream] = await Promise.all([
                    getDataCapabilities(account.id),
                    getStreamStatus(account.id)
                ]);
                setCapabilities(nextCapabilities);
                setStreamStatus(nextStream);
            } catch (caught) {
                setError(parseActionError(caught).message);
            }
        });
    }

    function run(action: () => Promise<unknown>, title: string) {
        setError("");
        startTransition(async () => {
            try {
                const result = await action();
                setPayload(title, result);
            } catch (caught) {
                setError(parseActionError(caught).message);
            }
        });
    }

    function syncInstruments(storage: "db" | "csv" | "delete") {
        setError("");
        startTransition(async () => {
            try {
                const result =
                    storage === "db"
                        ? await syncInstrumentData(account.id)
                        : storage === "csv"
                          ? await syncInstrumentCsv(account.id)
                          : await deleteInstrumentStorage(account.id);
                setSyncResult(result);
                setPayload(
                    storage === "db"
                        ? "Instrument sync to DB"
                        : storage === "csv"
                          ? "Instrument sync to CSV"
                          : "Instrument storage delete",
                    result
                );
                if (storage === "delete") {
                    setSearchRows([]);
                }
                refreshMeta();
            } catch (caught) {
                setError(parseActionError(caught).message);
            }
        });
    }

    function searchInstruments() {
        setError("");
        startTransition(async () => {
            try {
                const result = await searchBrokerInstruments(account.id, {
                    q: searchQuery,
                    exchange: searchExchange || undefined,
                    limit: 30
                });
                setSearchRows(result);
            } catch (caught) {
                setError(parseActionError(caught).message);
            }
        });
    }

    function connectSocket() {
        if (wsRef.current || !streamStatus.websocket_enabled) {
            return;
        }
        const url = new URL(apiBaseUrl, window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/broker-accounts/${account.id}/data/stream/ws`;
        url.search = "";
        url.searchParams.set("user_id", account.user_id);
        const wsUrl = url.toString();
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;
        socket.onopen = () => setWsConnected(true);
        socket.onclose = () => {
            setWsConnected(false);
            wsRef.current = null;
        };
        socket.onmessage = (event) => {
            let nextPayload: JsonObject;
            try {
                nextPayload = JSON.parse(event.data) as JsonObject;
            } catch {
                nextPayload = { raw: String(event.data) };
            }
            setWsMessages((current) =>
                wsKeepHistoryRef.current ? [nextPayload, ...current].slice(0, 100) : [nextPayload]
            );
            startTransition(async () => {
                try {
                    setStreamStatus(await getStreamStatus(account.id));
                } catch {
                    return;
                }
            });
        };
    }

    function disconnectSocket() {
        wsRef.current?.close();
        wsRef.current = null;
        setWsConnected(false);
    }

    function subscribeSocket() {
        if (!wsRef.current || !wsConnected || !wsSymbol.trim()) {
            return;
        }
        wsRef.current.send(
            JSON.stringify({
                type: "subscribe",
                instruments: [{ symbol: wsSymbol.trim(), exchange: wsExchange.trim() || "NSE" }]
            })
        );
    }

    function marketInstrument() {
        return {
            symbol: marketSymbol.trim(),
            exchange: marketExchange.trim() || "NSE"
        };
    }

    function marketFieldIsActive(field: string) {
        return MARKET_MODE_FIELDS[marketMode].includes(field);
    }

    return (
        <div className="grid gap-8">
            {!sessionActive ? (
                <Alert variant="warning">
                    <AlertDescription>
                        Activate the broker session first. The read-only data APIs depend on a live broker token or
                        session.
                    </AlertDescription>
                </Alert>
            ) : null}
            {error ? (
                <Alert variant="warning">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <Section
                title="Account"
                description="Session state, broker capabilities, and the current stream manager status."
            >
                <div className="grid gap-3 min-[820px]:grid-cols-3">
                    <div className="border-t border-border py-3">
                        <div className="text-xs font-bold uppercase text-muted-foreground">Broker</div>
                        <div className="mt-2 text-lg font-bold">{brokerNames[account.broker_code]}</div>
                    </div>
                    <div className="border-t border-border py-3">
                        <div className="text-xs font-bold uppercase text-muted-foreground">Session</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <StatusBadge
                                className={
                                    account.last_verified_at
                                        ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
                                        : "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]"
                                }
                            >
                                {account.last_verified_at ? "Verified" : "Unverified"}
                            </StatusBadge>
                            <StatusBadge className={statusTone(account.session_status)}>
                                {account.session_status ?? "pending"}
                            </StatusBadge>
                        </div>
                    </div>
                    <div className="border-t border-border py-3">
                        <div className="text-xs font-bold uppercase text-muted-foreground">Stream status</div>
                        <div className="mt-2 text-lg font-bold">{streamStatus.subscription_count} subscriptions</div>
                        <div className="text-sm text-muted-foreground">{streamStatus.guidance}</div>
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(capabilities.capabilities).map(([key, value]) => (
                        <StatusBadge
                            className={
                                value.supported
                                    ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
                                    : "border-border bg-card text-muted-foreground"
                            }
                            key={key}
                        >
                            {key}
                        </StatusBadge>
                    ))}
                    <Button disabled={isPending} onClick={refreshMeta} type="button" variant="outline">
                        Refresh status
                    </Button>
                </div>
            </Section>

            <Section
                title="Instrument sync"
                description="Manage broker-scoped instrument storage in SQLite and as a local CSV under backend/data/instruments."
            >
                <div className="flex flex-wrap items-center gap-3">
                    <Button disabled={isPending || !sessionActive} onClick={() => syncInstruments("db")} type="button">
                        {isPending ? "Working..." : "Sync to DB"}
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => syncInstruments("csv")}
                        type="button"
                        variant="outline"
                    >
                        {isPending ? "Working..." : "Sync to CSV"}
                    </Button>
                    <Button
                        disabled={isPending}
                        onClick={() => syncInstruments("delete")}
                        type="button"
                        variant="destructive"
                    >
                        {isPending ? "Working..." : "Delete DB + CSV"}
                    </Button>
                    {syncResult ? (
                        <div className="grid gap-1 text-sm text-muted-foreground">
                            <div>
                                {syncResult.storage_target ?? "db"} · {syncResult.sync_status} · {syncResult.row_count}{" "}
                                rows · {formatDate(syncResult.finished_at ?? syncResult.started_at)}
                            </div>
                            {syncResult.csv_path ? <div>CSV path: {syncResult.csv_path}</div> : null}
                            {typeof syncResult.deleted_db_rows === "number" ? (
                                <div>Deleted DB rows: {syncResult.deleted_db_rows}</div>
                            ) : null}
                            {typeof syncResult.deleted_csv === "boolean" ? (
                                <div>Deleted CSV: {syncResult.deleted_csv ? "yes" : "no file found"}</div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </Section>

            <Section
                title="Instrument search"
                description="Search the broker instrument cache after a sync completes, with CSV fallback when the local export is available."
            >
                <div className="grid gap-3 min-[900px]:grid-cols-[1fr_140px_140px]">
                    <Input
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Symbol, trading symbol, name"
                        value={searchQuery}
                    />
                    <Input
                        onChange={(event) => setSearchExchange(event.target.value)}
                        placeholder="Exchange"
                        value={searchExchange}
                    />
                    <Button disabled={isPending} onClick={searchInstruments} type="button">
                        Search
                    </Button>
                </div>
                <div className="mt-4">
                    <Table className="min-w-[760px] text-left text-sm">
                        <TableHeader className="text-xs uppercase text-muted-foreground">
                            <TableRow className="border-b-0">
                                <TableHead className="py-2">Symbol</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Exchange</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Expiry</TableHead>
                                <TableHead>Identifiers</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isPending && !searchRows.length
                                ? Array.from({ length: 4 }).map((_, index) => (
                                      <TableRow className="border-t border-border" key={`search-loading-${index}`}>
                                          <TableCell className="py-3">
                                              <Skeleton className="h-5 w-28" />
                                              <Skeleton className="mt-2 h-3 w-40" />
                                          </TableCell>
                                          <TableCell>
                                              <Skeleton className="h-4 w-12" />
                                          </TableCell>
                                          <TableCell>
                                              <Skeleton className="h-4 w-14" />
                                          </TableCell>
                                          <TableCell>
                                              <Skeleton className="h-4 w-20" />
                                          </TableCell>
                                          <TableCell>
                                              <Skeleton className="h-4 w-24" />
                                          </TableCell>
                                          <TableCell>
                                              <Skeleton className="h-4 w-56" />
                                          </TableCell>
                                      </TableRow>
                                  ))
                                : null}
                            {searchRows.map((row) => (
                                <TableRow
                                    className="border-t border-border"
                                    key={`${row.exchange}-${row.symbol}-${row.expiry ?? "na"}`}
                                >
                                    <TableCell className="py-3">
                                        <div className="font-bold">{row.symbol}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {row.name ?? row.trading_symbol ?? "-"}
                                        </div>
                                    </TableCell>
                                    <TableCell>{row.source ?? "db"}</TableCell>
                                    <TableCell>{row.exchange ?? "-"}</TableCell>
                                    <TableCell>{row.instrument_type ?? "-"}</TableCell>
                                    <TableCell>{row.expiry ? formatDate(row.expiry) : "-"}</TableCell>
                                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                                        {Object.entries(row.identifiers)
                                            .filter(([, value]) => value)
                                            .map(([key, value]) => `${key}:${value}`)
                                            .join(" · ") || "-"}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {!searchRows.length && !isPending ? (
                        <div className="border-t border-border py-4 text-sm text-muted-foreground">
                            No instrument rows loaded yet.
                        </div>
                    ) : null}
                </div>
            </Section>

            <Section
                title="Portfolio reads"
                description="Run the existing read-only broker operations and inspect raw broker payloads."
            >
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => run(() => getProfile(account.id), "Profile")}
                        type="button"
                        variant="outline"
                    >
                        Profile
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => run(() => getPortfolioFunds(account.id), "Funds")}
                        type="button"
                        variant="outline"
                    >
                        Funds
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => run(() => getPositions(account.id), "Positions")}
                        type="button"
                        variant="outline"
                    >
                        Positions
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => run(() => getHoldings(account.id), "Holdings")}
                        type="button"
                        variant="outline"
                    >
                        Holdings
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => run(() => getOrders(account.id), "Orders")}
                        type="button"
                        variant="outline"
                    >
                        Orders
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => run(() => getTrades(account.id), "Trades")}
                        type="button"
                        variant="outline"
                    >
                        Trades
                    </Button>
                </div>
            </Section>

            <Section
                title="Market data"
                description="Quote, OHLC, historical, option-chain, and greeks requests through the uniform backend interface."
            >
                <div className="flex flex-wrap gap-2">
                    {(
                        Object.entries(MARKET_MODE_COPY) as Array<[MarketMode, { title: string; description: string }]>
                    ).map(([mode, meta]) => (
                        <Button
                            key={mode}
                            onClick={() => setMarketMode(mode)}
                            type="button"
                            variant={marketMode === mode ? "default" : "outline"}
                        >
                            {meta.title}
                        </Button>
                    ))}
                </div>
                <div className="mt-3 border border-border p-3">
                    <div className="text-sm font-bold">{MARKET_MODE_COPY[marketMode].title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{MARKET_MODE_COPY[marketMode].description}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                        Highlighted fields below are used for the currently selected request mode.
                    </div>
                </div>
                <div className="mt-3 grid gap-3 min-[960px]:grid-cols-4">
                    <MarketField
                        active={marketFieldIsActive("symbol")}
                        help="Underlying symbol or trading symbol used by all market-data requests."
                        label="Symbol"
                    >
                        <Input
                            onChange={(event) => setMarketSymbol(event.target.value)}
                            placeholder="RELIANCE"
                            value={marketSymbol}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("exchange")}
                        help="Usually NSE, BSE, NFO, BFO, or MCX depending on the broker instrument."
                        label="Exchange"
                    >
                        <Input
                            onChange={(event) => setMarketExchange(event.target.value)}
                            placeholder="NSE"
                            value={marketExchange}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("interval")}
                        help="Examples: day, 5minute, 15minute, 1hour. Broker adapters map these to native intervals where needed."
                        label="Interval"
                    >
                        <Input
                            onChange={(event) => setMarketInterval(event.target.value)}
                            placeholder="day"
                            value={marketInterval}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("expiry")}
                        help="Used by option-chain and greeks requests. Enter a valid contract expiry date for the underlying."
                        label="Expiry date"
                    >
                        <Input
                            onChange={(event) => setMarketExpiry(event.target.value)}
                            placeholder="YYYY-MM-DD"
                            value={marketExpiry}
                        />
                    </MarketField>
                </div>
                <div className="mt-3 grid gap-3 min-[960px]:grid-cols-2">
                    <MarketField
                        active={marketFieldIsActive("from_date")}
                        help="Historical candle start time."
                        label="From date and time"
                    >
                        <Input
                            onChange={(event) => setMarketFromDate(event.target.value)}
                            placeholder="From"
                            type="datetime-local"
                            value={marketFromDate}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("to_date")}
                        help="Historical candle end time."
                        label="To date and time"
                    >
                        <Input
                            onChange={(event) => setMarketToDate(event.target.value)}
                            placeholder="To"
                            type="datetime-local"
                            value={marketToDate}
                        />
                    </MarketField>
                </div>
                <div className="mt-3 grid gap-3 min-[960px]:grid-cols-4">
                    <MarketField
                        active={marketFieldIsActive("strike")}
                        help="Option strike used when selecting one contract for greeks."
                        label="Strike"
                    >
                        <Input
                            onChange={(event) => setMarketStrike(event.target.value)}
                            placeholder="1400"
                            value={marketStrike}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("option_type")}
                        help="Option side for greeks, usually CE or PE."
                        label="Option type"
                    >
                        <Input
                            onChange={(event) => setMarketOptionType(event.target.value)}
                            placeholder="CE or PE"
                            value={marketOptionType}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("price")}
                        help="Reserved for future local-model greeks and advanced testing."
                        label="Option price"
                    >
                        <Input
                            onChange={(event) => setMarketPrice(event.target.value)}
                            placeholder="25"
                            value={marketPrice}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("underlying_price")}
                        help="Reserved for future local-model greeks and advanced testing."
                        label="Underlying price"
                    >
                        <Input
                            onChange={(event) => setMarketUnderlyingPrice(event.target.value)}
                            placeholder="Underlying price"
                            value={marketUnderlyingPrice}
                        />
                    </MarketField>
                </div>
                <div className="mt-3 grid gap-3 min-[960px]:grid-cols-3">
                    <MarketField
                        active={marketFieldIsActive("volatility")}
                        help="Reserved for future local-model greeks and advanced testing."
                        label="Volatility"
                    >
                        <Input
                            onChange={(event) => setMarketVolatility(event.target.value)}
                            placeholder="Volatility"
                            value={marketVolatility}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("interest_rate")}
                        help="Reserved for future local-model greeks and advanced testing."
                        label="Interest rate"
                    >
                        <Input
                            onChange={(event) => setMarketInterestRate(event.target.value)}
                            placeholder="Interest rate"
                            value={marketInterestRate}
                        />
                    </MarketField>
                    <MarketField
                        active={marketFieldIsActive("days_to_expiry")}
                        help="Reserved for future local-model greeks and advanced testing."
                        label="Days to expiry"
                    >
                        <Input
                            onChange={(event) => setMarketDaysToExpiry(event.target.value)}
                            placeholder="Days to expiry"
                            value={marketDaysToExpiry}
                        />
                    </MarketField>
                </div>
                {account.broker_code === "groww" ? (
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                        <div>
                            Historical sample: symbol `RELIANCE`, exchange `NSE`, interval `day` or `5minute`, and the
                            current market-day `from`/`to` range.
                        </div>
                        <div>
                            Option chain sample: symbol `RELIANCE`, exchange `NSE`, expiry as a valid RELIANCE F&O
                            expiry from instrument search or the broker option chain.
                        </div>
                        <div>
                            Greeks sample: symbol `RELIANCE`, exchange `NSE`, expiry as a valid RELIANCE F&O expiry,
                            strike like `1400`, option type `CE` or `PE`.
                        </div>
                    </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => {
                            setMarketMode("quote");
                            run(() => getDataQuotes(account.id, { instruments: [marketInstrument()] }), "Data quotes");
                        }}
                        type="button"
                        variant={marketMode === "quote" ? "default" : "outline"}
                    >
                        Quote
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => {
                            setMarketMode("ohlc");
                            run(() => getDataOhlc(account.id, { instruments: [marketInstrument()] }), "Data OHLC");
                        }}
                        type="button"
                        variant={marketMode === "ohlc" ? "default" : "outline"}
                    >
                        OHLC
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive}
                        onClick={() => {
                            setMarketMode("historical");
                            run(
                                () =>
                                    getHistoricalData(account.id, {
                                        instrument: marketInstrument(),
                                        interval: marketInterval,
                                        from_date: new Date(marketFromDate).toISOString(),
                                        to_date: new Date(marketToDate).toISOString()
                                    }),
                                "Historical data"
                            );
                        }}
                        type="button"
                        variant={marketMode === "historical" ? "default" : "outline"}
                    >
                        Historical
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive || !capabilities.capabilities.option_chain?.supported}
                        onClick={() => {
                            setMarketMode("option_chain");
                            run(
                                () =>
                                    getOptionChainData(account.id, {
                                        symbol: marketSymbol.trim(),
                                        exchange: marketExchange.trim() || "NSE",
                                        expiry: marketExpiry.trim() || undefined
                                    }),
                                "Option chain"
                            );
                        }}
                        type="button"
                        variant={marketMode === "option_chain" ? "default" : "outline"}
                    >
                        Option chain
                    </Button>
                    <Button
                        disabled={isPending || !sessionActive || !capabilities.capabilities.greeks?.supported}
                        onClick={() => {
                            setMarketMode("greeks");
                            run(
                                () =>
                                    getGreeksData(account.id, {
                                        symbol: marketSymbol.trim(),
                                        exchange: marketExchange.trim() || "NSE",
                                        expiry: marketExpiry.trim() || undefined,
                                        strike: marketStrike.trim() || undefined,
                                        option_type: marketOptionType.trim() || undefined,
                                        price: numberOrUndefined(marketPrice),
                                        underlying_price: numberOrUndefined(marketUnderlyingPrice),
                                        volatility: numberOrUndefined(marketVolatility),
                                        interest_rate: numberOrUndefined(marketInterestRate),
                                        days_to_expiry: integerOrUndefined(marketDaysToExpiry)
                                    }),
                                "Greeks"
                            );
                        }}
                        type="button"
                        variant={marketMode === "greeks" ? "default" : "outline"}
                    >
                        Greeks
                    </Button>
                </div>
            </Section>

            <Section title="WebSocket test" description="On-demand quote streaming over the unified websocket route.">
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        disabled={!streamStatus.websocket_enabled || wsConnected}
                        onClick={connectSocket}
                        type="button"
                    >
                        Connect
                    </Button>
                    <Button disabled={!wsConnected} onClick={disconnectSocket} type="button" variant="outline">
                        Disconnect
                    </Button>
                    <Input
                        className="w-[180px]"
                        onChange={(event) => setWsSymbol(event.target.value)}
                        placeholder="Symbol"
                        value={wsSymbol}
                    />
                    <Input
                        className="w-[120px]"
                        onChange={(event) => setWsExchange(event.target.value)}
                        placeholder="Exchange"
                        value={wsExchange}
                    />
                    <Button
                        disabled={!wsConnected || !wsSymbol.trim()}
                        onClick={subscribeSocket}
                        type="button"
                        variant="outline"
                    >
                        Subscribe
                    </Button>
                    <Button
                        disabled={!wsMessages.length}
                        onClick={() => setWsMessages([])}
                        type="button"
                        variant="outline"
                    >
                        Clear
                    </Button>
                    <Label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                            checked={wsKeepHistory}
                            onCheckedChange={(checked) => setWsKeepHistory(Boolean(checked))}
                        />
                        See all received messages
                    </Label>
                </div>
                <div className="mt-4 text-sm text-muted-foreground">
                    {wsConnected ? "Connected" : "Disconnected"} · {streamStatus.subscription_count} active
                    subscriptions
                </div>
                <div className="mt-4 grid max-h-[28rem] gap-3 overflow-y-auto pr-1">
                    {wsMessages.map((message, index) => (
                        <pre
                            className="overflow-x-auto border border-border bg-muted/30 p-3 text-xs"
                            key={`${index}-${JSON.stringify(message).slice(0, 24)}`}
                        >
                            {pretty(message)}
                        </pre>
                    ))}
                    {!wsMessages.length ? (
                        <div className="border-t border-border py-4 text-sm text-muted-foreground">
                            No websocket messages yet.
                        </div>
                    ) : null}
                </div>
            </Section>

            <Section
                title={responseTitle || "Latest response"}
                description="Raw payloads returned by the backend or broker."
            >
                {isPending ? (
                    <div className="border border-border bg-muted/30 p-4">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="mt-3 h-4 w-full" />
                        <Skeleton className="mt-2 h-4 w-5/6" />
                        <Skeleton className="mt-2 h-4 w-2/3" />
                        <Skeleton className="mt-2 h-4 w-4/5" />
                    </div>
                ) : (
                    <pre className="overflow-x-auto border border-border bg-muted/30 p-4 text-xs">
                        {responseBody || "{}"}
                    </pre>
                )}
            </Section>
        </div>
    );
}
