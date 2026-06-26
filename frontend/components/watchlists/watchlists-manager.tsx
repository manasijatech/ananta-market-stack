"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type UIEvent } from "react";
import { AlertTriangle, CandlestickChart, Check, Loader2, Minus, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getLivePricesWebSocketConfig, touchLiveDemandSubscriptions } from "@/service/actions/alerts";
import { searchDefaultBrokerInstruments } from "@/service/actions/broker";
import {
    addPresetWatchlist,
    addSymbolsToWatchlist,
    createWatchlist,
    deleteWatchlist,
    refreshWatchlist,
    removeSymbolFromWatchlist,
    searchWatchlistPresets,
    updateWatchlist
} from "@/service/actions/watchlist";
import type { InstrumentRef } from "@/service/types/alerts";
import type { LivePriceTick } from "@/service/types/alerts";
import type { InstrumentSearchRow } from "@/service/types/broker";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { Watchlist, WatchlistPresetCatalogEntry } from "@/service/types/watchlist";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { PageHeader } from "@/components/brokers/ui";
import { notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";
import { formatIstDateTime } from "@/lib/datetime";
import { DRISHTI_API_SIGNUP_URL } from "@/lib/drishti";
import { formatMarketCap } from "@/lib/market-cap";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";

function parseSymbols(input: string): string[] {
    return Array.from(
        new Set(
            input
                .split(/[\n,\s]+/)
                .map((item) => item.trim().toUpperCase())
                .filter(Boolean)
        )
    );
}

function parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let inQuotes = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '"') {
            if (inQuotes && next === '"') {
                currentCell += '"';
                index += 1;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes && char === ",") {
            currentRow.push(currentCell);
            currentCell = "";
            continue;
        }
        if (!inQuotes && (char === "\n" || char === "\r")) {
            if (char === "\r" && next === "\n") index += 1;
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentRow = [];
            currentCell = "";
            continue;
        }
        currentCell += char;
    }
    if (currentCell || currentRow.length) {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }
    return rows.filter((row) => row.some((cell) => cell.trim()));
}

function extractSymbolsFromCsv(text: string): string[] {
    const rows = parseCsvRows(text.replace(/^\ufeff/, ""));
    if (!rows.length) return [];
    const headers = rows[0].map((cell) => cell.trim());
    const symbolIndex = headers.findIndex((header) => header.toLowerCase().includes("symbol"));
    if (symbolIndex < 0) {
        throw new Error("CSV must include a column containing 'symbol' or 'symbols'.");
    }
    return Array.from(
        new Set(
            rows
                .slice(1)
                .map((row) => row[symbolIndex] ?? "")
                .flatMap((value) => value.split(/[\s,;|]+/))
                .map((value) => value.trim().toUpperCase())
                .filter(Boolean)
        )
    );
}

function formatDate(value?: string | null): string {
    return formatIstDateTime(value, "-");
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function formatLivePrice(value: unknown): string {
    const numeric = toNumber(value);
    if (numeric === null) return "-";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(numeric);
}

function formatLiveChange(value: unknown): string {
    const numeric = toNumber(value);
    if (numeric === null) return "-";
    return `${numeric >= 0 ? "+" : ""}${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(numeric)}%`;
}

function livePriceKey(row: { account_id?: string | null; broker_code?: string | null; symbol: string }): string {
    return [row.account_id || "", row.broker_code || "", row.symbol.trim().toUpperCase()].join(":");
}

function livePriceLabel(price: LivePriceTick | undefined): string {
    if (price?.unavailable_reason && toNumber(price.ltp ?? price.last_price) === null) return "—";
    return formatLivePrice(price?.ltp ?? price?.last_price);
}

function liveStateBadgeVariant(
    state: "connecting" | "connected" | "disconnected" | "error"
): NonNullable<BadgeProps["variant"]> {
    if (state === "connected") return "success";
    if (state === "connecting") return "warning";
    if (state === "error") return "error";
    return "secondary";
}

function liveStateLabel(state: "connecting" | "connected" | "disconnected" | "error"): string {
    if (state === "connected") return "Live";
    if (state === "connecting") return "Connecting";
    if (state === "error") return "Live error";
    return "Live offline";
}

function SymbolAvatar({
    symbol,
    logo,
    className
}: {
    symbol: string;
    logo?: string | null;
    className?: string;
}) {
    if (logo) {
        return <img alt="" className={cn("shrink-0 object-contain", className)} src={logo} />;
    }
    return (
        <span
            className={cn(
                "flex shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground",
                className
            )}
        >
            {symbol.slice(0, 2)}
        </span>
    );
}

function normalizedInstrumentToken(value: string | null | undefined): string {
    return (value ?? "").trim().toUpperCase();
}

function isDerivativeSearchRow(row: InstrumentSearchRow): boolean {
    const segment = normalizedInstrumentToken(row.segment);
    const instrumentType = normalizedInstrumentToken(row.instrument_type);
    const symbol = normalizedInstrumentToken(row.symbol);
    if (row.expiry || row.option_type || row.strike) return true;
    if (
        segment.includes("OPT") ||
        segment.includes("FUT") ||
        segment.includes("FNO") ||
        segment.includes("DERIV")
    ) {
        return true;
    }
    if (
        instrumentType.includes("OPT") ||
        instrumentType.includes("FUT") ||
        instrumentType.includes("FNO") ||
        instrumentType.includes("DERIV")
    ) {
        return true;
    }
    return /-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4}-.*-(?:CE|PE)$/.test(symbol);
}

function isLivePreviewCandidate(row: InstrumentSearchRow): boolean {
    return !isDerivativeSearchRow(row);
}

function sortWatchlists(items: Watchlist[]): Watchlist[] {
    return [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function upsertWatchlist(items: Watchlist[], next: Watchlist): Watchlist[] {
    const existing = new Map(items.map((item) => [item.id, item]));
    existing.set(next.id, next);
    return sortWatchlists(Array.from(existing.values()));
}

function instrumentFromSearch(row: InstrumentSearchRow): InstrumentRef {
    return {
        symbol: row.symbol,
        exchange: row.exchange ?? null,
        zerodha_instrument_token: row.identifiers.zerodha_instrument_token
            ? Number(row.identifiers.zerodha_instrument_token)
            : null,
        upstox_instrument_key: row.identifiers.upstox_instrument_key ?? null,
        angel_exchange: row.identifiers.angel_exchange ?? row.exchange ?? null,
        angel_token: row.identifiers.angel_token ? Number(row.identifiers.angel_token) : null,
        dhan_exchange_segment: row.identifiers.dhan_exchange_segment ?? null,
        dhan_security_id: row.identifiers.dhan_security_id ?? null,
        groww_exchange: row.identifiers.groww_exchange ?? row.exchange ?? null,
        groww_segment: row.identifiers.groww_segment ?? row.segment ?? null,
        groww_trading_symbol: row.identifiers.groww_trading_symbol ?? row.trading_symbol ?? null,
        indmoney_scrip_code: row.identifiers.indmoney_scrip_code ?? null,
        kotak_query: row.identifiers.kotak_query ?? null,
        kotak_segment: row.identifiers.kotak_segment ?? null,
        kotak_psymbol: row.identifiers.kotak_psymbol ?? null
    };
}

function WatchlistTableColGroup({ hasActions }: { hasActions: boolean }) {
    return (
        <colgroup>
            <col style={{ width: hasActions ? "15%" : "16%" }} />
            <col style={{ width: hasActions ? "24%" : "26%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: hasActions ? "18%" : "20%" }} />
            <col style={{ width: hasActions ? "11%" : "10%" }} />
            {hasActions ? <col style={{ width: "4%" }} /> : null}
        </colgroup>
    );
}

const PRESET_PAGE_SIZE = 24;
const WATCHLIST_EXCHANGES = ["NSE", "BSE"] as const;
type WatchlistExchange = (typeof WATCHLIST_EXCHANGES)[number];

function isWatchlistExchange(value: string): value is WatchlistExchange {
    return WATCHLIST_EXCHANGES.includes(value as WatchlistExchange);
}

function ExchangeSelect({
    id,
    value,
    onValueChange,
    className,
    "aria-label": ariaLabel = "Exchange"
}: {
    id?: string;
    value: WatchlistExchange;
    onValueChange: (value: WatchlistExchange) => void;
    className?: string;
    "aria-label"?: string;
}) {
    return (
        <Select
            onValueChange={(next) => {
                if (next && isWatchlistExchange(next)) onValueChange(next);
            }}
            value={value}
        >
            <SelectTrigger
                aria-label={ariaLabel}
                className={cn("h-10 min-w-0 px-2.5 font-mono text-sm", className)}
                id={id}
            >
                <span className="min-w-0 flex-1 truncate">{value}</span>
            </SelectTrigger>
            <SelectContent>
                {WATCHLIST_EXCHANGES.map((option) => (
                    <SelectItem key={option} value={option}>
                        {option}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function WatchlistsManager({
    hasAlphaApiKey,
    initialWatchlists
}: {
    hasAlphaApiKey: boolean;
    initialWatchlists: Watchlist[];
}) {
    const router = useRouter();
    const [watchlists, setWatchlists] = useState(() => sortWatchlists(initialWatchlists));
    const [selectedId, setSelectedId] = useState(initialWatchlists[0]?.id ?? "");
    const [createName, setCreateName] = useState("");
    const [createSymbols, setCreateSymbols] = useState("");
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createSearch, setCreateSearch] = useState("");
    const [createSuggestions, setCreateSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [createSuggestionMetadata, setCreateSuggestionMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [createSelectedInstruments, setCreateSelectedInstruments] = useState<InstrumentSearchRow[]>([]);
    const [createSelectedMetadata, setCreateSelectedMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [createActiveSuggestionIndex, setCreateActiveSuggestionIndex] = useState(-1);
    const [createSearchLoading, setCreateSearchLoading] = useState(false);
    const [showCreateSuggestions, setShowCreateSuggestions] = useState(false);
    const [symbolSearch, setSymbolSearch] = useState("");
    const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [suggestionMetadata, setSuggestionMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [watchlistMetadata, setWatchlistMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const [searchLoading, setSearchLoading] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [exchange, setExchange] = useState<WatchlistExchange>("NSE");
    const [presetQuery, setPresetQuery] = useState("");
    const [presetResults, setPresetResults] = useState<WatchlistPresetCatalogEntry[]>([]);
    const [presetLoading, setPresetLoading] = useState(false);
    const [presetLoadingMore, setPresetLoadingMore] = useState(false);
    const [presetHasMore, setPresetHasMore] = useState(true);
    const [editingName, setEditingName] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showAlphaConfigPrompt, setShowAlphaConfigPrompt] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [livePrices, setLivePrices] = useState<Record<string, LivePriceTick>>({});
    const [liveState, setLiveState] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
    const [isPending, startTransition] = useTransition();
    const searchWrapRef = useRef<HTMLDivElement | null>(null);
    const presetListRef = useRef<HTMLDivElement | null>(null);
    const createCsvInputRef = useRef<HTMLInputElement | null>(null);
    const addCsvInputRef = useRef<HTMLInputElement | null>(null);
    const livePendingRef = useRef<Map<string, LivePriceTick>>(new Map());
    const liveFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const liveSocketRef = useRef<WebSocket | null>(null);

    const selected = useMemo(
        () => watchlists.find((item) => item.id === selectedId) ?? watchlists[0] ?? null,
        [selectedId, watchlists]
    );
    const selectedSymbols = useMemo(
        () => selected?.items.map((item) => item.symbol.trim().toUpperCase()).filter(Boolean) ?? [],
        [selected]
    );
    const selectedLiveDemand = useMemo(
        () =>
            selected?.items.map((item) => ({
                symbol: item.symbol,
                exchange: item.exchange ?? null,
                instrument_ref: item.instrument_ref,
                source_type: "watchlist_view",
                source_id: selected.id,
                source_label: selected.name
            })) ?? [],
        [selected]
    );
    const suggestionLiveDemand = useMemo(
        () =>
            [...suggestions, ...createSuggestions]
                .filter(isLivePreviewCandidate)
                .slice(0, 12)
                .map((row) => ({
                account_id: row.account_id ?? null,
                broker_code: row.broker_code ?? null,
                symbol: row.symbol,
                exchange: row.exchange ?? (exchange.trim().toUpperCase() || null),
                instrument_ref: instrumentFromSearch(row),
                source_type: "symbol_search",
                source_id: "watchlist_symbol_search",
                source_label: "Watchlist symbol search"
            })),
        [createSuggestions, exchange, suggestions]
    );
    const livePriceRefs = useMemo(
        () =>
            [...selectedLiveDemand, ...suggestionLiveDemand]
                .flatMap((row) => {
                    const accountId = "account_id" in row ? row.account_id : null;
                    const brokerCode = "broker_code" in row ? row.broker_code : null;
                    return typeof accountId === "string" && typeof brokerCode === "string" && row.symbol
                        ? [{ account_id: accountId, broker_code: brokerCode, symbol: row.symbol }]
                        : [];
                })
                .slice(0, 40),
        [selectedLiveDemand, suggestionLiveDemand]
    );
    const livePriceRefKey = useMemo(
        () => livePriceRefs.map((row) => [row.account_id ?? "", row.broker_code ?? "", row.symbol].join(":")).join(","),
        [livePriceRefs]
    );
    const alphaSymbols = selectedSymbols;
    const alphaSymbolKey = alphaSymbols.join(",");
    const createParsedSymbols = useMemo(
        () =>
            Array.from(
                new Set([
                    ...createSelectedInstruments.map((item) => item.symbol.trim().toUpperCase()).filter(Boolean),
                    ...parseSymbols(createSymbols)
                ])
            ),
        [createSelectedInstruments, createSymbols]
    );
    const createNameMissing = !createName.trim();
    const createCanSubmit = !isPending && !createNameMissing;
    const canEditSelected = Boolean(selected?.is_editable);

    useEffect(() => {
        if (!selected && watchlists[0]) {
            setSelectedId(watchlists[0].id);
        }
    }, [selected, watchlists]);

    useEffect(() => {
        if (selected && !editingName) {
            setDraftName(selected.name);
        }
        setConfirmDelete(false);
    }, [editingName, selected]);

    useEffect(() => {
        if (!alphaSymbols.length) {
            setWatchlistMetadata({});
            return;
        }
        let cancelled = false;
        getAlphaSymbolMetadata(alphaSymbols)
            .then((metadata) => {
                if (cancelled) return;
                setWatchlistMetadata(
                    metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
                        acc[item.symbol.trim().toUpperCase()] = item;
                        return acc;
                    }, {})
                );
            })
            .catch((caught) => {
                notifyAlphaCreditWarning(caught);
                if (!cancelled) setWatchlistMetadata({});
            });
        return () => {
            cancelled = true;
        };
    }, [alphaSymbolKey, alphaSymbols]);

    useEffect(() => {
        let cancelled = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        function flushLivePrices() {
            liveFlushTimerRef.current = null;
            if (!livePendingRef.current.size) return;
            const updates = Array.from(livePendingRef.current.entries());
            livePendingRef.current.clear();
            setLivePrices((current) => {
                const next = { ...current };
                for (const [key, value] of updates) next[key] = value;
                return next;
            });
        }

        function enqueue(rows: LivePriceTick[]) {
            for (const row of rows) {
                if (!row?.symbol) continue;
                livePendingRef.current.set(livePriceKey(row), row);
                livePendingRef.current.set(livePriceKey({ symbol: row.symbol }), row);
            }
            if (!liveFlushTimerRef.current) {
                liveFlushTimerRef.current = setTimeout(flushLivePrices, 200);
            }
        }

        async function connect() {
            if (!livePriceRefs.length) {
                setLiveState("disconnected");
                setLivePrices({});
                livePendingRef.current.clear();
                return;
            }
            setLiveState("connecting");
            setLivePrices({});
            livePendingRef.current.clear();
            try {
                const { url } = await getLivePricesWebSocketConfig(livePriceRefs);
                if (cancelled) return;
                const socket = new WebSocket(url);
                liveSocketRef.current = socket;
                socket.onopen = () => setLiveState("connected");
                socket.onmessage = (event) => {
                    try {
                        const payload = JSON.parse(String(event.data)) as { type?: string; rows?: LivePriceTick[] };
                        if (payload.type === "snapshot" || payload.type === "prices") {
                            enqueue(Array.isArray(payload.rows) ? payload.rows : []);
                        }
                    } catch {
                        setLiveState("error");
                    }
                };
                socket.onerror = () => setLiveState("error");
                socket.onclose = () => {
                    if (liveSocketRef.current === socket) liveSocketRef.current = null;
                    if (cancelled) return;
                    setLiveState("disconnected");
                    reconnectTimer = setTimeout(connect, 2500);
                };
            } catch {
                if (cancelled) return;
                setLiveState("error");
                reconnectTimer = setTimeout(connect, 2500);
            }
        }

        connect();
        return () => {
            cancelled = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (liveFlushTimerRef.current) clearTimeout(liveFlushTimerRef.current);
            liveSocketRef.current?.close();
            liveSocketRef.current = null;
        };
    }, [livePriceRefKey]);

    useEffect(() => {
        const demand = [...selectedLiveDemand, ...suggestionLiveDemand];
        if (!demand.length) return;
        let cancelled = false;

        async function touchDemand() {
            try {
                await touchLiveDemandSubscriptions({ subscriptions: demand });
            } catch {
                if (!cancelled) setLiveState("error");
            }
        }

        touchDemand();
        const handle = window.setInterval(touchDemand, 30_000);
        return () => {
            cancelled = true;
            window.clearInterval(handle);
        };
    }, [selectedLiveDemand, suggestionLiveDemand]);

    useEffect(() => {
        function handlePointerDown(event: MouseEvent) {
            if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        }
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, []);

    useEffect(() => {
        if (!showCreateSuggestions || createActiveSuggestionIndex < 0) return;
        document
            .getElementById(`create-watchlist-symbol-suggestion-${createActiveSuggestionIndex}`)
            ?.scrollIntoView({ block: "nearest" });
    }, [createActiveSuggestionIndex, showCreateSuggestions]);

    useEffect(() => {
        if (!showSuggestions || activeSuggestionIndex < 0) return;
        document
            .getElementById(`watchlist-symbol-suggestion-${activeSuggestionIndex}`)
            ?.scrollIntoView({ block: "nearest" });
    }, [activeSuggestionIndex, showSuggestions]);

    useEffect(() => {
        const query = createSearch.trim();
        if (!query || !showCreateForm) {
            setCreateSuggestions([]);
            setCreateSuggestionMetadata({});
            setCreateActiveSuggestionIndex(-1);
            setCreateSearchLoading(false);
            return;
        }
        let cancelled = false;
        const handle = window.setTimeout(() => {
            setCreateSearchLoading(true);
            startTransition(async () => {
                try {
                    const result = await searchDefaultBrokerInstruments({
                        q: query,
                        exchange: exchange.trim() || undefined,
                        limit: 20
                    });
                    if (cancelled) return;
                    setCreateSuggestions(result);
                    setCreateActiveSuggestionIndex(result.length ? 0 : -1);
                    setShowCreateSuggestions(true);
                    const symbols = Array.from(
                        new Set(result.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))
                    );
                    if (!symbols.length) {
                        setCreateSuggestionMetadata({});
                        return;
                    }
                    try {
                        const metadata = await getAlphaSymbolMetadata(symbols);
                        if (cancelled) return;
                        setCreateSuggestionMetadata(
                            metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
                                acc[item.symbol.trim().toUpperCase()] = item;
                                return acc;
                            }, {})
                        );
                    } catch (caught) {
                        notifyAlphaCreditWarning(caught);
                        if (!cancelled) setCreateSuggestionMetadata({});
                    }
                } catch {
                    if (cancelled) return;
                    setCreateSuggestions([]);
                    setCreateSuggestionMetadata({});
                    setCreateActiveSuggestionIndex(-1);
                } finally {
                    if (!cancelled) {
                        setCreateSearchLoading(false);
                    }
                }
            });
        }, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [createSearch, exchange, showCreateForm, startTransition]);

    useEffect(() => {
        const query = symbolSearch.trim();
        if (!query) {
            setSuggestions([]);
            setSuggestionMetadata({});
            setActiveSuggestionIndex(-1);
            setSearchLoading(false);
            return;
        }
        let cancelled = false;
        const handle = window.setTimeout(() => {
            setSearchLoading(true);
            startTransition(async () => {
                try {
                    const result = await searchDefaultBrokerInstruments({
                        q: query,
                        exchange: exchange.trim() || undefined,
                        limit: 20
                    });
                    if (cancelled) return;
                    setSuggestions(result);
                    setActiveSuggestionIndex(result.length ? 0 : -1);
                    setShowSuggestions(true);
                    const symbols = Array.from(
                        new Set(result.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))
                    ).slice(0, 20);
                    if (!symbols.length) {
                        setSuggestionMetadata({});
                        return;
                    }
                    try {
                        const metadata = await getAlphaSymbolMetadata(symbols);
                        if (cancelled) return;
                        setSuggestionMetadata(
                            metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
                                acc[item.symbol.trim().toUpperCase()] = item;
                                return acc;
                            }, {})
                        );
                    } catch (caught) {
                        notifyAlphaCreditWarning(caught);
                        if (!cancelled) setSuggestionMetadata({});
                    }
                } catch {
                    if (cancelled) return;
                    setSuggestions([]);
                    setSuggestionMetadata({});
                    setActiveSuggestionIndex(-1);
                } finally {
                    if (!cancelled) {
                        setSearchLoading(false);
                    }
                }
            });
        }, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [exchange, startTransition, symbolSearch]);

    useEffect(() => {
        let cancelled = false;
        const handle = window.setTimeout(() => {
            setPresetLoading(true);
            setPresetLoadingMore(false);
            (async () => {
                try {
                    const result = await searchWatchlistPresets(presetQuery, PRESET_PAGE_SIZE, 0);
                    if (cancelled) return;
                    setPresetResults(result);
                    setPresetHasMore(result.length === PRESET_PAGE_SIZE);
                } catch {
                    if (cancelled) return;
                    setPresetResults([]);
                    setPresetHasMore(false);
                } finally {
                    if (!cancelled) setPresetLoading(false);
                }
            })();
        }, 180);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [presetQuery]);

    useEffect(() => {
        const container = presetListRef.current;
        if (!container || presetLoading || presetLoadingMore || !presetHasMore || !presetResults.length) return;
        if (container.scrollHeight > container.clientHeight + 24) return;
        let cancelled = false;
        setPresetLoadingMore(true);
        (async () => {
            try {
                const result = await searchWatchlistPresets(presetQuery, PRESET_PAGE_SIZE, presetResults.length);
                if (cancelled) return;
                setPresetResults((current) => {
                    const existing = new Set(current.map((item) => item.id));
                    return [...current, ...result.filter((item) => !existing.has(item.id))];
                });
                setPresetHasMore(result.length === PRESET_PAGE_SIZE);
            } catch {
                if (!cancelled) setPresetHasMore(false);
            } finally {
                if (!cancelled) setPresetLoadingMore(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [presetHasMore, presetLoading, presetLoadingMore, presetQuery, presetResults]);

    function fail(caught: unknown, fallback: string) {
        setNotice("");
        setError(caught instanceof Error ? caught.message : fallback);
    }

    async function readSymbolsFromCsv(file: File): Promise<string[]> {
        return extractSymbolsFromCsv(await file.text());
    }

    function importCreateCsv(file: File | null) {
        if (!file) return;
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const symbols = await readSymbolsFromCsv(file);
                if (!symbols.length) {
                    setNotice("No symbols found in the CSV.");
                    return;
                }
                setCreateSymbols((current) => Array.from(new Set([...parseSymbols(current), ...symbols])).join(", "));
                setNotice(`Loaded ${symbols.length} symbols from CSV.`);
            } catch (caught) {
                fail(caught, "Could not read the CSV file.");
            } finally {
                if (createCsvInputRef.current) createCsvInputRef.current.value = "";
            }
        });
    }

    function importSymbolsIntoSelected(file: File | null) {
        if (!selected || !file) return;
        if (!canEditSelected) {
            setError("Preset watchlists are read-only.");
            return;
        }
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const symbols = await readSymbolsFromCsv(file);
                if (!symbols.length) {
                    setNotice("No symbols found in the CSV.");
                    return;
                }
                const result = await addSymbolsToWatchlist(selected.id, {
                    symbols,
                    exchange
                });
                setWatchlists((current) => upsertWatchlist(current, result.watchlist));
                setSelectedId(result.watchlist.id);
                const skipped = result.skipped_symbols.length
                    ? ` Skipped ${result.skipped_symbols.length} duplicates already in this watchlist.`
                    : "";
                setNotice(`Imported ${result.added_symbols.length} symbols from CSV.${skipped}`);
            } catch (caught) {
                fail(caught, "Could not import CSV symbols.");
            } finally {
                if (addCsvInputRef.current) addCsvInputRef.current.value = "";
            }
        });
    }

    function createInstrumentKey(row: InstrumentSearchRow): string {
        return [
            row.symbol.trim().toUpperCase(),
            row.exchange ?? "",
            row.trading_symbol ?? "",
            row.account_id ?? ""
        ].join(":");
    }

    function addCreateSearchedSymbol(row: InstrumentSearchRow) {
        const symbol = row.symbol.trim().toUpperCase();
        const metadata = createSuggestionMetadata[symbol];
        setCreateSelectedInstruments((current) => {
            const nextKey = createInstrumentKey(row);
            if (current.some((item) => createInstrumentKey(item) === nextKey)) return current;
            return [...current, row];
        });
        if (metadata) {
            setCreateSelectedMetadata((current) => ({ ...current, [symbol]: metadata }));
        }
        setCreateSearch("");
        setCreateSuggestions([]);
        setCreateActiveSuggestionIndex(-1);
        setShowCreateSuggestions(false);
    }

    function removeCreateSearchedSymbol(row: InstrumentSearchRow) {
        const removeKey = createInstrumentKey(row);
        setCreateSelectedInstruments((current) => current.filter((item) => createInstrumentKey(item) !== removeKey));
    }

    function resetCreateModal() {
        setCreateName("");
        setCreateSymbols("");
        setCreateSearch("");
        setCreateSuggestions([]);
        setCreateSuggestionMetadata({});
        setCreateSelectedInstruments([]);
        setCreateSelectedMetadata({});
        setCreateActiveSuggestionIndex(-1);
        setCreateSearchLoading(false);
        setShowCreateSuggestions(false);
        setShowCreateForm(false);
    }

    function requestCreateWatchlist() {
        setError("");
        setNotice("");
        if (!hasAlphaApiKey) {
            setShowAlphaConfigPrompt(true);
            return;
        }
        setShowCreateForm(true);
    }

    function create() {
        if (!hasAlphaApiKey) {
            setShowCreateForm(false);
            setShowAlphaConfigPrompt(true);
            return;
        }
        const name = createName.trim();
        if (!name) {
            setError("Enter a watchlist name.");
            return;
        }
        if (name.length > 128) {
            setError("Watchlist names must be 128 characters or fewer.");
            return;
        }
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const created = await createWatchlist({ name, symbols: parseSymbols(createSymbols) });
                let finalWatchlist = created;
                if (createSelectedInstruments.length) {
                    const result = await addSymbolsToWatchlist(created.id, {
                        symbols: [],
                        items: createSelectedInstruments.map((row) => ({
                            symbol: row.symbol,
                            exchange: row.exchange ?? (exchange.trim().toUpperCase() || null),
                            account_id: row.account_id ?? null,
                            broker_code: row.broker_code ?? null,
                            instrument_ref: instrumentFromSearch(row)
                        }))
                    });
                    finalWatchlist = result.watchlist;
                }
                setWatchlists((current) => upsertWatchlist(current, finalWatchlist));
                setSelectedId(finalWatchlist.id);
                resetCreateModal();
                setNotice(`Created ${finalWatchlist.name}.`);
            } catch (caught) {
                fail(caught, "Could not create watchlist.");
            }
        });
    }

    function saveName() {
        if (!selected) return;
        if (!canEditSelected) {
            setError("Preset watchlists are read-only.");
            return;
        }
        const name = draftName.trim();
        if (!name) {
            setError("Enter a watchlist name.");
            return;
        }
        if (name.length > 128) {
            setError("Watchlist names must be 128 characters or fewer.");
            return;
        }
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const updated = await updateWatchlist(selected.id, { name });
                setWatchlists((current) => upsertWatchlist(current, updated));
                setSelectedId(updated.id);
                setEditingName(false);
                setNotice(`Renamed to ${updated.name}.`);
            } catch (caught) {
                fail(caught, "Could not rename watchlist.");
            }
        });
    }

    function addSearchedSymbol(row: InstrumentSearchRow) {
        if (!selected) return;
        if (!canEditSelected) {
            setError("Preset watchlists are read-only.");
            return;
        }
        const selectedExchange = row.exchange ?? (exchange.trim().toUpperCase() || null);
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const result = await addSymbolsToWatchlist(selected.id, {
                    symbols: [],
                    items: [
                        {
                            symbol: row.symbol,
                            exchange: selectedExchange,
                            account_id: row.account_id ?? null,
                            broker_code: row.broker_code ?? null,
                            instrument_ref: instrumentFromSearch(row)
                        }
                    ]
                });
                setWatchlists((current) => upsertWatchlist(current, result.watchlist));
                setSelectedId(result.watchlist.id);
                setSymbolSearch("");
                setSuggestions([]);
                setActiveSuggestionIndex(-1);
                setShowSuggestions(false);
                const skipped = result.skipped_symbols.length ? " Already in this watchlist." : "";
                setNotice(
                    result.added_symbols.length ? `Added ${row.symbol}.` : `${row.symbol} was not added.${skipped}`
                );
            } catch (caught) {
                fail(caught, "Could not add symbol.");
            }
        });
    }

    function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") {
            setShowSuggestions(false);
            return;
        }
        if (!suggestions.length) {
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setShowSuggestions(true);
            setActiveSuggestionIndex((current) => Math.min(current < 0 ? 0 : current + 1, suggestions.length - 1));
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setShowSuggestions(true);
            setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
            return;
        }
        if (event.key === "Enter" && showSuggestions) {
            event.preventDefault();
            const selectedSuggestion = suggestions[Math.max(0, activeSuggestionIndex)];
            if (selectedSuggestion) {
                addSearchedSymbol(selectedSuggestion);
            }
        }
    }

    function handleCreateSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") {
            setShowCreateSuggestions(false);
            return;
        }
        if (!createSuggestions.length) {
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setShowCreateSuggestions(true);
            setCreateActiveSuggestionIndex((current) =>
                Math.min(current < 0 ? 0 : current + 1, createSuggestions.length - 1)
            );
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setShowCreateSuggestions(true);
            setCreateActiveSuggestionIndex((current) => Math.max(current - 1, 0));
            return;
        }
        if (event.key === "Enter" && showCreateSuggestions) {
            event.preventDefault();
            const selectedSuggestion = createSuggestions[Math.max(0, createActiveSuggestionIndex)];
            if (selectedSuggestion) {
                addCreateSearchedSymbol(selectedSuggestion);
            }
        }
    }

    function removeSymbol(symbol: string, symbolExchange?: string | null) {
        if (!selected) return;
        if (!canEditSelected) {
            setError("Preset watchlists are read-only.");
            return;
        }
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const updated = await removeSymbolFromWatchlist(selected.id, symbol, symbolExchange);
                setWatchlists((current) => upsertWatchlist(current, updated));
                setSelectedId(updated.id);
                setNotice(`Removed ${symbol}.`);
            } catch (caught) {
                fail(caught, "Could not remove symbol.");
            }
        });
    }

    function removeWatchlist() {
        if (!selected) return;
        const deletedId = selected.id;
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                await deleteWatchlist(deletedId);
                const next = watchlists.filter((item) => item.id !== deletedId);
                setWatchlists(next);
                setSelectedId(next[0]?.id ?? "");
                setConfirmDelete(false);
                setNotice("Watchlist deleted.");
            } catch (caught) {
                fail(caught, "Could not delete watchlist.");
            }
        });
    }

    function addPreset(entry: WatchlistPresetCatalogEntry) {
        if (!hasAlphaApiKey) {
            setShowAlphaConfigPrompt(true);
            return;
        }
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const created = await addPresetWatchlist(entry.id);
                setWatchlists((current) => upsertWatchlist(current, created));
                setSelectedId(created.id);
                setPresetResults((current) =>
                    current.map((item) =>
                        item.id === entry.id
                            ? {
                                  ...item,
                                  is_added: true,
                                  user_watchlist_id: created.id,
                                  constituent_count: created.items.length
                              }
                            : item
                    )
                );
                setNotice(`Added ${created.name}.`);
            } catch (caught) {
                fail(caught, "Could not add preset watchlist.");
            }
        });
    }

    function loadMorePresets() {
        if (presetLoading || presetLoadingMore || !presetHasMore) return;
        setPresetLoadingMore(true);
        const currentQuery = presetQuery;
        const currentOffset = presetResults.length;
        void (async () => {
            try {
                const result = await searchWatchlistPresets(currentQuery, PRESET_PAGE_SIZE, currentOffset);
                setPresetResults((current) => {
                    const existing = new Set(current.map((item) => item.id));
                    return [...current, ...result.filter((item) => !existing.has(item.id))];
                });
                setPresetHasMore(result.length === PRESET_PAGE_SIZE);
            } catch {
                setPresetHasMore(false);
            } finally {
                setPresetLoadingMore(false);
            }
        })();
    }

    function handlePresetScroll(event: UIEvent<HTMLDivElement>) {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        if (scrollHeight - scrollTop - clientHeight <= 120) {
            loadMorePresets();
        }
    }

    function refreshSelectedPreset() {
        if (!selected || selected.kind !== "preset") return;
        setError("");
        setNotice("");
        startTransition(async () => {
            try {
                const updated = await refreshWatchlist(selected.id);
                setWatchlists((current) => upsertWatchlist(current, updated));
                setSelectedId(updated.id);
                setPresetResults((current) =>
                    current.map((item) =>
                        item.id === updated.preset_id
                            ? {
                                  ...item,
                                  constituent_count: updated.items.length,
                                  sync_status: updated.preset_sync_status ?? item.sync_status,
                                  last_constituents_sync_at:
                                      updated.preset_last_synced_at ?? item.last_constituents_sync_at
                              }
                            : item
                    )
                );
                setNotice(`Refreshed ${updated.name}.`);
            } catch (caught) {
                fail(caught, "Could not refresh preset watchlist.");
            }
        });
    }

    return (
        <section className="flex min-h-0 flex-col min-[980px]:h-[calc(100dvh-8rem)] min-[980px]:overflow-hidden">
            {error ? (
                <div className="mb-4 shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            ) : null}
            {notice ? (
                <div className="mb-4 shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
                    {notice}
                </div>
            ) : null}

            <div className="shrink-0">
                <PageHeader
                    description="Search instruments, maintain focused symbol lists, and keep broker-native identifiers attached to every selected ticker."
                    eyebrow="Market workspace"
                    title="Watchlists"
                />
            </div>

                <Dialog open={showAlphaConfigPrompt} onOpenChange={setShowAlphaConfigPrompt}>
                    <DialogContent className="w-[calc(100vw-2rem)] max-w-[425px] gap-4 p-6">
                        <DialogHeader className="pr-8">
                            <DialogTitle>Drishti API key required</DialogTitle>
                            <DialogDescription>
                                Add a Drishti API key in Settings before creating watchlists. Don&apos;t have one yet?{" "}
                                <Link
                                    className="font-medium text-primary underline underline-offset-2"
                                    href={DRISHTI_API_SIGNUP_URL}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                >
                                    Create one at drishti.manasija.in
                                </Link>
                                .
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                className="normal-case tracking-normal"
                                onClick={() => setShowAlphaConfigPrompt(false)}
                                type="button"
                                variant="outline"
                            >
                                Cancel
                            </Button>
                            <Button
                                className="normal-case tracking-normal"
                                onClick={() => {
                                    setShowAlphaConfigPrompt(false);
                                    router.push("/settings");
                                }}
                                type="button"
                            >
                                Go to Settings
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog
                    open={confirmDelete}
                    onOpenChange={(open) => {
                        if (!isPending) setConfirmDelete(open);
                    }}
                >
                    <DialogContent
                        className="w-[calc(100vw-2rem)] max-w-[425px] gap-4 p-6"
                        showCloseButton={!isPending}
                    >
                        <DialogHeader className="pr-8">
                            <div className="flex items-start gap-3">
                                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center border border-destructive/40 bg-destructive/10 text-destructive">
                                    <AlertTriangle className="size-5" />
                                </span>
                                <div className="min-w-0">
                                    <DialogTitle>Delete watchlist?</DialogTitle>
                                    <DialogDescription className="mt-2 leading-6">
                                        This will permanently delete{" "}
                                        <span className="font-semibold text-foreground">
                                            {selected?.name ?? "this watchlist"}
                                        </span>
                                        {selected ? ` and its ${selected.items.length} saved symbols` : ""}. This
                                        action cannot be undone.
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>
                        <div className="border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            Any alert workflows using this watchlist may lose that source after deletion.
                        </div>
                        <DialogFooter>
                            <Button
                                className="normal-case tracking-normal"
                                disabled={isPending}
                                onClick={() => setConfirmDelete(false)}
                                type="button"
                                variant="outline"
                            >
                                Cancel
                            </Button>
                            <Button
                                className="normal-case tracking-normal"
                                disabled={isPending}
                                onClick={removeWatchlist}
                                type="button"
                                variant="destructive"
                            >
                                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                                Delete watchlist
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog
                    open={showCreateForm}
                    onOpenChange={(open) => {
                        if (open) {
                            requestCreateWatchlist();
                        } else {
                            resetCreateModal();
                        }
                    }}
                >
                    <DialogContent
                        className={cn(
                            "flex w-[min(100vw-2rem,36rem)] flex-col gap-0 overflow-hidden p-0",
                            createParsedSymbols.length
                                ? "max-h-[min(100dvh-2rem,42rem)]"
                                : "max-h-[min(100dvh-2rem,26rem)]"
                        )}
                    >
                        <DialogHeader className="border-b border-border px-5 py-4 pr-14">
                            <DialogTitle>Create watchlist</DialogTitle>
                            <DialogDescription>Name your list, add symbols, then create.</DialogDescription>
                        </DialogHeader>

                        <div className="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto px-5 py-4">
                            <section className="grid gap-1.5">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    1 · Name
                                </p>
                                <Label className="sr-only" htmlFor="create-watchlist-name">
                                    Name
                                </Label>
                                <Input
                                    autoFocus
                                    className="h-10"
                                    id="create-watchlist-name"
                                    maxLength={128}
                                    onChange={(event) => setCreateName(event.target.value)}
                                    placeholder="e.g. Tech stocks"
                                    value={createName}
                                />
                                {createNameMissing ? (
                                    <p className="text-xs text-muted-foreground">Required to create the watchlist.</p>
                                ) : null}
                            </section>

                            <section className="space-y-3">
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        2 · Add symbols
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Optional now — you can add more after creating.
                                    </p>
                                </div>

                                <div className="flex min-w-0 gap-2">
                                    <div className="relative min-w-0 flex-1">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            aria-activedescendant={
                                                createActiveSuggestionIndex >= 0
                                                    ? `create-watchlist-symbol-suggestion-${createActiveSuggestionIndex}`
                                                    : undefined
                                            }
                                            aria-autocomplete="list"
                                            aria-controls="create-watchlist-symbol-suggestions"
                                            aria-expanded={
                                                showCreateSuggestions && createSearch.trim() ? "true" : "false"
                                            }
                                            aria-label="Search companies or tickers"
                                            className="h-10 min-w-0 pl-9 pr-9 font-mono text-sm uppercase"
                                            id="create-watchlist-search"
                                            inputClassName="px-0"
                                            onChange={(event) =>
                                                setCreateSearch(event.target.value.toUpperCase())
                                            }
                                            onFocus={() => {
                                                if (createSuggestions.length) setShowCreateSuggestions(true);
                                            }}
                                            onKeyDown={handleCreateSearchKeyDown}
                                            placeholder="Search companies (e.g. TCS, Reliance)"
                                            role="combobox"
                                            value={createSearch}
                                        />
                                        {createSearchLoading ? (
                                            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                                        ) : null}
                                    </div>
                                    <ExchangeSelect
                                        aria-label="Exchange"
                                        className="w-[5.75rem] shrink-0"
                                        id="create-watchlist-exchange"
                                        onValueChange={setExchange}
                                        value={exchange}
                                    />
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                    <p className="text-xs text-muted-foreground">
                                        ↑↓ browse results · Enter to add · Esc closes
                                    </p>
                                    <Button
                                        className="h-auto px-0 text-xs"
                                        disabled={isPending}
                                        onClick={() => createCsvInputRef.current?.click()}
                                        type="button"
                                        variant="link"
                                    >
                                        <Upload className="size-3.5" />
                                        Import CSV
                                    </Button>
                                    <Input
                                        accept=".csv,text/csv"
                                        className="hidden"
                                        onChange={(event) => importCreateCsv(event.target.files?.[0] ?? null)}
                                        ref={createCsvInputRef}
                                        type="file"
                                    />
                                </div>

                                {showCreateSuggestions && createSearch.trim() ? (
                                    <div
                                        className="max-h-48 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover"
                                        id="create-watchlist-symbol-suggestions"
                                        role="listbox"
                                    >
                                        {createSuggestions.map((row, index) => {
                                            const metadata =
                                                createSuggestionMetadata[row.symbol.trim().toUpperCase()];
                                            return (
                                                <Button
                                                    aria-selected={index === createActiveSuggestionIndex}
                                                    className={cn(
                                                        "w-full justify-between gap-4 rounded-none border-b px-3 py-2.5 text-left whitespace-normal last:border-b-0",
                                                        index === createActiveSuggestionIndex
                                                            ? "bg-muted"
                                                            : "hover:bg-muted/60"
                                                    )}
                                                    disabled={isPending}
                                                    id={`create-watchlist-symbol-suggestion-${index}`}
                                                    key={[
                                                        row.symbol,
                                                        row.exchange,
                                                        row.trading_symbol,
                                                        row.expiry
                                                    ].join(":")}
                                                    onClick={() => addCreateSearchedSymbol(row)}
                                                    onMouseEnter={() => setCreateActiveSuggestionIndex(index)}
                                                    role="option"
                                                    size="auto"
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    <span className="flex min-w-0 items-center gap-3">
                                                        <SymbolAvatar
                                                            className="size-8 rounded-md"
                                                            logo={metadata?.logo}
                                                            symbol={row.symbol}
                                                        />
                                                        <span className="min-w-0">
                                                            <span className="block font-mono text-sm font-semibold">
                                                                {row.symbol}
                                                            </span>
                                                            <span className="block truncate text-xs text-muted-foreground">
                                                                {[
                                                                    metadata?.company_name ?? row.name,
                                                                    row.trading_symbol,
                                                                    row.account_label
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join(" · ")}
                                                            </span>
                                                        </span>
                                                    </span>
                                                    <Badge size="sm" variant="outline">
                                                        {[row.exchange, row.instrument_type]
                                                            .filter(Boolean)
                                                            .join(" · ")}
                                                    </Badge>
                                                </Button>
                                            );
                                        })}
                                        {!createSuggestions.length && !createSearchLoading ? (
                                            <div className="px-3 py-4 text-sm text-muted-foreground">
                                                No matching instruments on {exchange}.
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}

                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium">Selected</p>
                                        <Badge
                                            className="gap-1"
                                            variant={createParsedSymbols.length ? "secondary" : "outline"}
                                        >
                                            <CandlestickChart aria-hidden className="size-3" />
                                            {createParsedSymbols.length}
                                        </Badge>
                                    </div>
                                    <div className="overflow-hidden rounded-lg border border-border">
                                        {createParsedSymbols.length ? (
                                            <div className="max-h-44 divide-y divide-border overflow-y-auto overflow-x-hidden">
                                                {createSelectedInstruments.map((row) => {
                                                    const metadata =
                                                        createSelectedMetadata[row.symbol.trim().toUpperCase()] ??
                                                        createSuggestionMetadata[row.symbol.trim().toUpperCase()];
                                                    const displayName =
                                                        metadata?.company_name ??
                                                        row.name ??
                                                        row.trading_symbol ??
                                                        row.symbol;
                                                    return (
                                                        <div
                                                            className="flex items-center justify-between gap-3 px-3 py-2"
                                                            key={createInstrumentKey(row)}
                                                        >
                                                            <span className="flex min-w-0 items-center gap-2.5">
                                                                <SymbolAvatar
                                                                    className="size-7 rounded-md"
                                                                    logo={metadata?.logo}
                                                                    symbol={row.symbol}
                                                                />
                                                                <span className="min-w-0">
                                                                    <span className="block truncate text-sm font-medium">
                                                                        {displayName}
                                                                    </span>
                                                                    <span className="block truncate font-mono text-xs text-muted-foreground">
                                                                        {row.symbol}
                                                                    </span>
                                                                </span>
                                                            </span>
                                                            <Button
                                                                aria-label={`Remove ${displayName}`}
                                                                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                                                                onClick={() => removeCreateSearchedSymbol(row)}
                                                                size="icon-xs"
                                                                type="button"
                                                                variant="ghost"
                                                            >
                                                                <X className="size-3.5" />
                                                            </Button>
                                                        </div>
                                                    );
                                                })}
                                                {parseSymbols(createSymbols).map((symbol) => (
                                                    <div
                                                        className="flex items-center gap-2.5 px-3 py-2"
                                                        key={`csv:${symbol}`}
                                                    >
                                                        <SymbolAvatar
                                                            className="size-7 rounded-md"
                                                            symbol={symbol}
                                                        />
                                                        <span className="truncate text-sm font-medium">{symbol}</span>
                                                        <Badge className="ml-auto" variant="outline">
                                                            CSV
                                                        </Badge>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="px-4 py-4 text-sm leading-relaxed text-muted-foreground">
                                                Search for companies like RELIANCE or TCS, or import a CSV to add
                                                multiple symbols. You can add as many as you need — duplicates are
                                                skipped and symbols can be removed before you create.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </section>
                        </div>

                        <DialogFooter className="flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
                            {createNameMissing ? (
                                <p className="w-full text-sm text-muted-foreground sm:mr-auto">
                                    Enter a watchlist name to continue.
                                </p>
                            ) : (
                                <p className="w-full text-sm text-muted-foreground sm:mr-auto">
                                    Step 3 · Review and create
                                </p>
                            )}
                            <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
                                <Button
                                    disabled={isPending}
                                    onClick={resetCreateModal}
                                    type="button"
                                    variant="outline"
                                >
                                    Cancel
                                </Button>
                                <Button disabled={!createCanSubmit} onClick={create} type="button">
                                    {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                                    Create watchlist
                                </Button>
                            </div>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <div className="flex min-h-0 flex-1 flex-col gap-6 min-[980px]:grid min-[980px]:grid-cols-[minmax(0,240px)_minmax(0,260px)_minmax(0,1fr)] min-[980px]:gap-6 min-[980px]:overflow-hidden">
                    <aside className="flex min-h-0 flex-col gap-3 min-[980px]:order-2 min-[980px]:overflow-hidden">
                        <div className="flex shrink-0 items-center justify-between gap-3">
                            <h2 className={typography.small}>Your watchlists</h2>
                            <Button
                                aria-label="Create watchlist"
                                disabled={isPending}
                                onClick={requestCreateWatchlist}
                                size="icon-sm"
                                type="button"
                                variant="outline"
                            >
                                <Plus className="size-4" />
                            </Button>
                        </div>

                        <nav
                            aria-label="Watchlists"
                            className="flex min-h-0 flex-col gap-2 overflow-y-auto max-[979px]:max-h-64 min-[760px]:max-[979px]:max-h-80 min-[980px]:flex-1"
                        >
                            {watchlists.map((item) => {
                                const active = item.id === selected?.id;
                                return (
                                    <Button
                                        className={cn(
                                            "w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left whitespace-normal",
                                            active
                                                ? "border-primary/50 bg-primary/5"
                                                : "border-border bg-card hover:bg-muted/40"
                                        )}
                                        key={item.id}
                                        onClick={() => {
                                            setSelectedId(item.id);
                                            setEditingName(false);
                                            setError("");
                                            setNotice("");
                                        }}
                                        size="auto"
                                        variant="ghost"
                                        type="button"
                                    >
                                        <span className="min-w-0 text-left">
                                            <span
                                                className={cn(
                                                    "block truncate text-sm leading-snug",
                                                    active ? "font-medium text-foreground" : typography.muted
                                                )}
                                            >
                                                {item.name}
                                            </span>
                                            <span className={cn(typography.muted, "mt-1 block leading-snug")}>
                                                {item.items.length} symbol{item.items.length === 1 ? "" : "s"}
                                            </span>
                                        </span>
                                        <span className={cn(typography.muted, "shrink-0 self-center text-xs leading-snug")}>
                                            {formatDate(item.updated_at).split(",")[0]}
                                        </span>
                                    </Button>
                                );
                            })}
                            {!watchlists.length ? (
                                <Card className="border-dashed shadow-none">
                                    <Empty className="py-8">
                                        <EmptyHeader>
                                            <EmptyTitle className="text-base">No watchlists yet</EmptyTitle>
                                            <EmptyDescription>
                                                Create a list or add an index preset to get started.
                                            </EmptyDescription>
                                        </EmptyHeader>
                                    </Empty>
                                </Card>
                            ) : null}
                        </nav>
                    </aside>

                    <aside className="flex min-h-0 flex-col gap-3 min-[980px]:order-1 min-[980px]:overflow-hidden">
                        <h2 className={cn(typography.small, "shrink-0")}>Index presets</h2>
                        <Input
                            className="h-9 shrink-0"
                            onChange={(event) => setPresetQuery(event.target.value)}
                            placeholder="Search Nifty indices"
                            value={presetQuery}
                        />
                        <div
                            className="min-h-0 space-y-2 overflow-y-auto max-[979px]:max-h-64 min-[760px]:max-[979px]:max-h-80 min-[980px]:flex-1"
                            onScroll={handlePresetScroll}
                            ref={presetListRef}
                        >
                            {presetResults.map((item) => (
                                <Card className="shadow-none" key={item.id}>
                                    <div className="flex items-start justify-between gap-3 p-3">
                                        <div className="min-w-0 flex-1">
                                            <p className={cn(typography.small, "break-words")}>{item.name}</p>
                                            <div className="mt-2">
                                                <span
                                                    className={cn(
                                                        typography.muted,
                                                        "inline-flex items-center gap-1 tabular-nums"
                                                    )}
                                                >
                                                    <CandlestickChart aria-hidden className="size-3.5 shrink-0" />
                                                    {item.constituent_count} symbol
                                                    {item.constituent_count === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                        </div>
                                        <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        item.is_added ? (
                                                            <span className="inline-flex">
                                                                <Button
                                                                    disabled
                                                                    size="icon-sm"
                                                                    type="button"
                                                                    variant="secondary"
                                                                >
                                                                    <Minus className="size-4" />
                                                                </Button>
                                                            </span>
                                                        ) : (
                                                            <Button
                                                                disabled={isPending}
                                                                onClick={() => addPreset(item)}
                                                                size="icon-sm"
                                                                type="button"
                                                                variant="outline"
                                                            >
                                                                <Plus className="size-4" />
                                                            </Button>
                                                        )
                                                    }
                                                />
                                                <TooltipPopup side="left">
                                                    {item.is_added
                                                        ? "Already in your watchlists"
                                                        : "Add this index preset to your watchlists"}
                                                </TooltipPopup>
                                            </Tooltip>
                                    </div>
                                </Card>
                            ))}
                            {presetLoadingMore ? (
                                <div className={cn(typography.muted, "flex items-center gap-2 px-1 py-2")}>
                                    <Loader2 className="size-3.5 animate-spin" />
                                    Loading more presets
                                </div>
                            ) : null}
                            {!presetResults.length ? (
                                <Card className="border-dashed shadow-none">
                                    <Empty className="py-8">
                                        <EmptyHeader>
                                            <EmptyTitle className="text-base">
                                                {presetLoading ? "Loading presets" : "No presets found"}
                                            </EmptyTitle>
                                            <EmptyDescription>
                                                {presetLoading
                                                    ? "Fetching index catalog…"
                                                    : "Try a different search term."}
                                            </EmptyDescription>
                                        </EmptyHeader>
                                    </Empty>
                                </Card>
                            ) : null}
                        </div>
                    </aside>

                    <main className="flex min-h-0 min-w-0 flex-1 flex-col min-[980px]:order-3 min-[980px]:overflow-hidden">
                        {selected ? (
                            <div className="flex min-h-0 flex-1 flex-col gap-4 min-[980px]:overflow-hidden">
                                <CardFrame className="shrink-0">
                                    <CardFrameHeader>
                                        {editingName ? (
                                            <div className="col-span-2 flex w-full max-w-2xl items-center gap-2">
                                                <Input
                                                    className="h-10 text-lg font-semibold"
                                                    maxLength={128}
                                                    onChange={(event) => setDraftName(event.target.value)}
                                                    value={draftName}
                                                />
                                                <Button
                                                    aria-label="Save watchlist name"
                                                    disabled={isPending || !draftName.trim()}
                                                    onClick={saveName}
                                                    size="icon-sm"
                                                    type="button"
                                                    variant="outline"
                                                >
                                                    <Check className="size-4" />
                                                </Button>
                                                <Button
                                                    aria-label="Cancel rename"
                                                    disabled={isPending}
                                                    onClick={() => {
                                                        setDraftName(selected.name);
                                                        setEditingName(false);
                                                    }}
                                                    size="icon-sm"
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    <X className="size-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <CardFrameTitle className={cn(typography.h3, "flex flex-wrap items-center gap-2")}>
                                                    <span className="min-w-0 break-words">{selected.name}</span>
                                                    {selected.kind === "preset" ? (
                                                        <Badge variant="outline">Preset</Badge>
                                                    ) : null}
                                                    <Badge variant={liveStateBadgeVariant(liveState)}>
                                                        <span
                                                            aria-hidden="true"
                                                            className={cn(
                                                                "size-1.5 rounded-full",
                                                                liveState === "connected"
                                                                    ? "bg-emerald-500"
                                                                    : liveState === "connecting"
                                                                      ? "bg-amber-500"
                                                                      : liveState === "error"
                                                                        ? "bg-red-500"
                                                                        : "bg-muted-foreground/64"
                                                            )}
                                                        />
                                                        {liveStateLabel(liveState)}
                                                    </Badge>
                                                </CardFrameTitle>
                                                <CardFrameDescription>
                                                    {selected.items.length} symbol
                                                    {selected.items.length === 1 ? "" : "s"}
                                                </CardFrameDescription>
                                            </>
                                        )}
                                        <CardFrameAction>
                                            <div className="flex items-center gap-1">
                                                {selected.kind === "preset" ? (
                                                    <Button
                                                        aria-label="Refresh preset watchlist"
                                                        disabled={isPending}
                                                        onClick={refreshSelectedPreset}
                                                        size="icon-sm"
                                                        type="button"
                                                        variant="ghost"
                                                    >
                                                        <RefreshCw className="size-4" />
                                                    </Button>
                                                ) : null}
                                                {canEditSelected ? (
                                                    <Button
                                                        aria-label="Rename watchlist"
                                                        disabled={isPending}
                                                        onClick={() => {
                                                            setDraftName(selected.name);
                                                            setEditingName(true);
                                                        }}
                                                        size="icon-sm"
                                                        type="button"
                                                        variant="ghost"
                                                    >
                                                        <Pencil className="size-4" />
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    aria-label="Delete watchlist"
                                                    disabled={isPending}
                                                    onClick={() => setConfirmDelete(true)}
                                                    size="icon-sm"
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </CardFrameAction>
                                    </CardFrameHeader>
                                </CardFrame>

                                {canEditSelected ? (
                                    <Card className="shrink-0 shadow-none">
                                        <div className="grid gap-4 p-4 min-[760px]:grid-cols-[minmax(0,1fr)_5.5rem_auto]">
                                            <div className="grid gap-1.5">
                                                <Label className="text-sm font-medium" htmlFor="watchlist-symbol-search">
                                                    Add symbol
                                                </Label>
                                                <div className="relative" ref={searchWrapRef}>
                                                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                                                    <Input
                                                        aria-activedescendant={
                                                            activeSuggestionIndex >= 0
                                                                ? `watchlist-symbol-suggestion-${activeSuggestionIndex}`
                                                                : undefined
                                                        }
                                                        aria-autocomplete="list"
                                                        aria-controls="watchlist-symbol-suggestions"
                                                        aria-expanded={
                                                            showSuggestions && symbolSearch.trim() ? "true" : "false"
                                                        }
                                                        className="h-10 pl-9 pr-9 font-mono text-sm uppercase"
                                                        id="watchlist-symbol-search"
                                                        inputClassName="px-0"
                                                        onChange={(event) =>
                                                            setSymbolSearch(event.target.value.toUpperCase())
                                                        }
                                                        onFocus={() => {
                                                            if (suggestions.length) setShowSuggestions(true);
                                                        }}
                                                        onKeyDown={handleSearchKeyDown}
                                                        placeholder="Search symbol or company"
                                                        role="combobox"
                                                        value={symbolSearch}
                                                    />
                                                    {searchLoading ? (
                                                        <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                                                    ) : null}
                                                    {showSuggestions && symbolSearch.trim() ? (
                                                        <div
                                                            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover shadow-md"
                                                            id="watchlist-symbol-suggestions"
                                                            role="listbox"
                                                        >
                                                            {suggestions.map((row, index) => {
                                                                const metadata =
                                                                    suggestionMetadata[row.symbol.trim().toUpperCase()];
                                                                return (
                                                                    <Button
                                                                        aria-selected={index === activeSuggestionIndex}
                                                                        className={cn(
                                                                            "w-full justify-between gap-4 rounded-none border-b px-3 py-2.5 text-left whitespace-normal last:border-b-0",
                                                                            index === activeSuggestionIndex
                                                                                ? "bg-muted"
                                                                                : "hover:bg-muted/60"
                                                                        )}
                                                                        disabled={isPending}
                                                                        id={`watchlist-symbol-suggestion-${index}`}
                                                                        key={[
                                                                            row.symbol,
                                                                            row.exchange,
                                                                            row.trading_symbol,
                                                                            row.expiry
                                                                        ].join(":")}
                                                                        onClick={() => addSearchedSymbol(row)}
                                                                        onMouseEnter={() =>
                                                                            setActiveSuggestionIndex(index)
                                                                        }
                                                                        role="option"
                                                                        size="auto"
                                                                        type="button"
                                                                        variant="ghost"
                                                                    >
                                                                        <span className="flex min-w-0 items-center gap-3">
                                                                            <SymbolAvatar
                                                                                className="size-8 rounded-md"
                                                                                logo={metadata?.logo}
                                                                                symbol={row.symbol}
                                                                            />
                                                                            <span className="min-w-0">
                                                                                <span className="block font-mono text-sm font-semibold">
                                                                                    {row.symbol}
                                                                                </span>
                                                                                <span className="block truncate text-xs text-muted-foreground">
                                                                                    {[
                                                                                        metadata?.company_name ??
                                                                                            row.name,
                                                                                        row.trading_symbol,
                                                                                        row.account_label
                                                                                    ]
                                                                                        .filter(Boolean)
                                                                                        .join(" · ")}
                                                                                </span>
                                                                            </span>
                                                                        </span>
                                                                        <Badge size="sm" variant="outline">
                                                                            {[row.exchange, row.instrument_type]
                                                                                .filter(Boolean)
                                                                                .join(" · ")}
                                                                        </Badge>
                                                                    </Button>
                                                                );
                                                            })}
                                                            {!suggestions.length && !searchLoading ? (
                                                                <div className="px-3 py-3 text-sm text-muted-foreground">
                                                                    No matching instruments found.
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="grid gap-1.5">
                                                <Label className="text-sm font-medium" htmlFor="watchlist-exchange">
                                                    Exchange
                                                </Label>
                                                <ExchangeSelect
                                                    id="watchlist-exchange"
                                                    onValueChange={setExchange}
                                                    value={exchange}
                                                />
                                            </div>
                                            <div className="grid gap-1.5">
                                                <Label className="text-sm font-medium">Import</Label>
                                                <Button
                                                    className="h-10 w-full"
                                                    disabled={isPending}
                                                    onClick={() => addCsvInputRef.current?.click()}
                                                    type="button"
                                                    variant="outline"
                                                >
                                                    <Upload className="size-4" />
                                                    CSV
                                                </Button>
                                                <Input
                                                    accept=".csv,text/csv"
                                                    className="hidden"
                                                    onChange={(event) =>
                                                        importSymbolsIntoSelected(event.target.files?.[0] ?? null)
                                                    }
                                                    ref={addCsvInputRef}
                                                    type="file"
                                                />
                                            </div>
                                        </div>
                                    </Card>
                                ) : null}

                                {selected.items.length ? (
                                    <CardFrame className="watchlist-table-scroll hidden min-h-0 min-[760px]:flex min-[760px]:flex-1 min-[760px]:flex-col min-[760px]:overflow-hidden">
                                        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
                                            <div className="flex min-h-0 min-w-[880px] flex-1 flex-col">
                                                <div className="shrink-0 border-b border-border/60 bg-muted/25">
                                                    <Table
                                                        className="table-fixed"
                                                        variant="card"
                                                        render={<div className="w-full" />}
                                                    >
                                                        <WatchlistTableColGroup hasActions={canEditSelected} />
                                                        <TableHeader className="[&_tr]:border-b-0">
                                                            <TableRow>
                                                                <TableHead>Ticker</TableHead>
                                                                <TableHead>Company</TableHead>
                                                                <TableHead>Exchange</TableHead>
                                                                <TableHead className="text-right">Price</TableHead>
                                                                <TableHead className="text-right">Change</TableHead>
                                                                <TableHead>Sector</TableHead>
                                                                <TableHead className="text-right">Mkt cap</TableHead>
                                                                {canEditSelected ? (
                                                                    <TableHead className="text-right">
                                                                        <span className="sr-only">Actions</span>
                                                                    </TableHead>
                                                                ) : null}
                                                            </TableRow>
                                                        </TableHeader>
                                                    </Table>
                                                </div>
                                                <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
                                                    <Table className="table-fixed" variant="card">
                                                        <WatchlistTableColGroup hasActions={canEditSelected} />
                                                        <TableBody>
                                                {selected.items.map((item) => {
                                                    const metadata =
                                                        watchlistMetadata[item.symbol.trim().toUpperCase()];
                                                    const price = livePrices[livePriceKey({ symbol: item.symbol })];
                                                    const change = toNumber(
                                                        price?.change_pct ?? price?.day_change_perc
                                                    );
                                                    const priceText = livePriceLabel(price);
                                                    const priceUnavailable =
                                                        priceText === "—" && Boolean(price?.unavailable_reason);
                                                    return (
                                                        <TableRow className="group" key={item.id}>
                                                            <TableCell className="font-medium">
                                                                <div className="flex items-center gap-3">
                                                                    <SymbolAvatar
                                                                        className="size-8 rounded-md"
                                                                        logo={metadata?.logo}
                                                                        symbol={item.symbol}
                                                                    />
                                                                    <div className="min-w-0">
                                                                        <div className="font-mono text-sm font-semibold">
                                                                            {item.symbol}
                                                                        </div>
                                                                        {metadata?.scrip_code ? (
                                                                            <div className="text-xs text-muted-foreground">
                                                                                BSE {metadata.scrip_code}
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="max-w-[240px]">
                                                                <div className="truncate font-medium">
                                                                    {metadata?.company_name ?? "—"}
                                                                </div>
                                                                <div className="truncate text-xs text-muted-foreground">
                                                                    {metadata?.basic_industry ??
                                                                        metadata?.theme ??
                                                                        "—"}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-muted-foreground">
                                                                {item.exchange ?? "—"}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {priceUnavailable ? (
                                                                    <Badge
                                                                        size="sm"
                                                                        title={price?.unavailable_reason ?? undefined}
                                                                        variant="outline"
                                                                    >
                                                                        Unavailable
                                                                    </Badge>
                                                                ) : (
                                                                    <span
                                                                        className="font-semibold"
                                                                        title={price?.unavailable_reason ?? undefined}
                                                                    >
                                                                        {priceText}
                                                                    </span>
                                                                )}
                                                            </TableCell>
                                                            <TableCell
                                                                className={cn(
                                                                    "text-right tabular-nums",
                                                                    change === null
                                                                        ? "text-muted-foreground"
                                                                        : change >= 0
                                                                          ? "text-[var(--success)]"
                                                                          : "text-[var(--danger)]"
                                                                )}
                                                            >
                                                                {formatLiveChange(change)}
                                                            </TableCell>
                                                            <TableCell className="max-w-[200px]">
                                                                <div className="truncate">
                                                                    {metadata?.sector ?? "—"}
                                                                </div>
                                                                <div className="truncate text-xs text-muted-foreground">
                                                                    {metadata?.industry ??
                                                                        metadata?.macro_economic_indicator ??
                                                                        ""}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums text-muted-foreground">
                                                                {formatMarketCap(metadata?.market_cap ?? null)}
                                                            </TableCell>
                                                            {canEditSelected ? (
                                                                <TableCell className="text-right">
                                                                    <Button
                                                                        aria-label={`Remove ${item.symbol}`}
                                                                        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                                                                        disabled={isPending}
                                                                        onClick={() =>
                                                                            removeSymbol(item.symbol, item.exchange)
                                                                        }
                                                                        size="icon-sm"
                                                                        type="button"
                                                                        variant="ghost"
                                                                    >
                                                                        <Trash2 className="size-4" />
                                                                    </Button>
                                                                </TableCell>
                                                            ) : null}
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                            <TableFooter>
                                                <TableRow>
                                                    <TableCell colSpan={canEditSelected ? 8 : 7}>
                                                        {selected.items.length} symbol
                                                        {selected.items.length === 1 ? "" : "s"} in this watchlist
                                                    </TableCell>
                                                </TableRow>
                                            </TableFooter>
                                        </Table>
                                                </ScrollArea>
                                            </div>
                                        </div>
                                    </CardFrame>
                                ) : (
                                    <Card className="hidden min-h-[280px] shadow-none min-[760px]:flex">
                                        <Empty className="py-16">
                                            <EmptyHeader>
                                                <EmptyMedia variant="icon">
                                                    <Search />
                                                </EmptyMedia>
                                                <EmptyTitle>No symbols yet</EmptyTitle>
                                                <EmptyDescription>
                                                    {canEditSelected
                                                        ? "Search above or import a CSV to add your first symbol."
                                                        : "This preset has no constituents yet. Try refreshing the watchlist."}
                                                </EmptyDescription>
                                            </EmptyHeader>
                                        </Empty>
                                    </Card>
                                )}

                                <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto min-[760px]:hidden">
                                    {selected.items.map((item) => {
                                        const metadata = watchlistMetadata[item.symbol.trim().toUpperCase()];
                                        const company = metadata?.company_name ?? "—";
                                        const price = livePrices[livePriceKey({ symbol: item.symbol })];
                                        const change = toNumber(price?.change_pct ?? price?.day_change_perc);
                                        const priceText = livePriceLabel(price);
                                        return (
                                            <Card className="shadow-none" key={item.id}>
                                                <div className="p-4">
                                                    <div className="flex min-w-0 items-start justify-between gap-3">
                                                        <div className="flex min-w-0 items-start gap-3">
                                                            <SymbolAvatar
                                                                className="size-9 rounded-md"
                                                                logo={metadata?.logo}
                                                                symbol={item.symbol}
                                                            />
                                                            <div className="min-w-0">
                                                                <div className="font-mono text-base font-semibold">
                                                                    {item.symbol}
                                                                </div>
                                                                <div className="mt-1 line-clamp-2 text-sm font-medium">
                                                                    {company}
                                                                </div>
                                                                <p className={cn(typography.muted, "mt-1")}>
                                                                    {[item.exchange, metadata?.sector]
                                                                        .filter(Boolean)
                                                                        .join(" · ") || "—"}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        {canEditSelected ? (
                                                            <Button
                                                                aria-label={`Remove ${item.symbol}`}
                                                                disabled={isPending}
                                                                onClick={() =>
                                                                    removeSymbol(item.symbol, item.exchange)
                                                                }
                                                                size="icon-sm"
                                                                type="button"
                                                                variant="ghost"
                                                            >
                                                                <Trash2 className="size-4" />
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4">
                                                        <div>
                                                            <dt className={typography.muted}>Price</dt>
                                                            <dd className="mt-1 font-semibold tabular-nums">
                                                                {priceText}
                                                            </dd>
                                                        </div>
                                                        <div>
                                                            <dt className={typography.muted}>Change</dt>
                                                            <dd
                                                                className={cn(
                                                                    "mt-1 font-semibold tabular-nums",
                                                                    change === null
                                                                        ? "text-foreground"
                                                                        : change >= 0
                                                                          ? "text-[var(--success)]"
                                                                          : "text-[var(--danger)]"
                                                                )}
                                                            >
                                                                {formatLiveChange(change)}
                                                            </dd>
                                                        </div>
                                                        <div>
                                                            <dt className={typography.muted}>Market cap</dt>
                                                            <dd className="mt-1 font-semibold tabular-nums">
                                                                {formatMarketCap(metadata?.market_cap ?? null)}
                                                            </dd>
                                                        </div>
                                                        <div>
                                                            <dt className={typography.muted}>Added</dt>
                                                            <dd className="mt-1 font-semibold">
                                                                {formatDate(item.created_at).split(",")[0]}
                                                            </dd>
                                                        </div>
                                                    </dl>
                                                </div>
                                            </Card>
                                        );
                                    })}
                                    {!selected.items.length ? (
                                        <Card className="border-dashed shadow-none">
                                            <Empty className="py-12">
                                                <EmptyHeader>
                                                    <EmptyTitle className="text-base">No symbols yet</EmptyTitle>
                                                    <EmptyDescription>
                                                        {canEditSelected
                                                            ? "Search above to add your first symbol."
                                                            : "Try refreshing this preset watchlist."}
                                                    </EmptyDescription>
                                                </EmptyHeader>
                                            </Empty>
                                        </Card>
                                    ) : null}
                                </div>
                            </div>
                        ) : (
                            <Card className="border-dashed shadow-none">
                                <Empty className="py-16">
                                    <EmptyHeader>
                                        <EmptyMedia variant="icon">
                                            <Plus />
                                        </EmptyMedia>
                                        <EmptyTitle>Create your first watchlist</EmptyTitle>
                                        <EmptyDescription>
                                            Use the plus button in the sidebar to name a list, then search the instrument
                                            cache to add symbols. You can also add an index preset from the left panel.
                                        </EmptyDescription>
                                    </EmptyHeader>
                                    <Button
                                        className="mt-2"
                                        onClick={requestCreateWatchlist}
                                        type="button"
                                        variant="outline"
                                    >
                                        <Plus className="size-4" />
                                        New watchlist
                                    </Button>
                                </Empty>
                            </Card>
                        )}
                    </main>
                </div>
        </section>
    );
}
