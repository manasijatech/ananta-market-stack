"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type UIEvent } from "react";
import {
    AlertTriangle,
    CandlestickChart,
    Check,
    Loader2,
    Minus,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    Upload,
    X
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { touchLiveDemandSubscriptions } from "@/service/actions/alerts";
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
import type { InstrumentRef, LivePriceTick, LiveSubscription } from "@/service/types/alerts";
import type { InstrumentSearchRow } from "@/service/types/broker";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { Watchlist, WatchlistPresetCatalogEntry, WatchlistSymbol } from "@/service/types/watchlist";
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
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogPanel,
    DialogTitle
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

function SymbolAvatar({ symbol, logo, className }: { symbol: string; logo?: string | null; className?: string }) {
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
    if (segment.includes("OPT") || segment.includes("FUT") || segment.includes("FNO") || segment.includes("DERIV")) {
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

function watchlistSymbolCount(watchlist: Watchlist): number {
    return watchlist.items.length || watchlist.symbols.length;
}

function watchlistKindLabel(watchlist: Watchlist): string {
    return watchlist.kind === "preset" ? "Preset" : "Manual";
}

function presetSyncVariant(status: string): NonNullable<BadgeProps["variant"]> {
    const normalized = status.trim().toLowerCase();
    if (normalized === "success" || normalized === "synced" || normalized === "ready") return "success";
    if (normalized === "error" || normalized === "failed") return "error";
    if (normalized === "syncing" || normalized === "pending") return "warning";
    return "outline";
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
                <SelectValue placeholder="Exchange" />
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
    // Symbols inserted optimistically that are still awaiting server confirmation
    // (keyed by uppercased symbol) — rendered as ghosted/pulsing rows.
    const [pendingSymbols, setPendingSymbols] = useState<Set<string>>(() => new Set());
    const [livePrices, setLivePrices] = useState<Record<string, LivePriceTick>>({});
    const [resolvedLiveDemand, setResolvedLiveDemand] = useState<LiveSubscription[]>([]);
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
                source_id: "watchlist_active_view",
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
            Array.from(
                new Map(
                    resolvedLiveDemand
                        .filter((row) => row.account_id && row.broker_code && row.symbol)
                        .map((row) => [
                            [row.account_id, row.broker_code, row.symbol].join(":"),
                            {
                                account_id: row.account_id,
                                broker_code: row.broker_code,
                                symbol: row.symbol
                            }
                        ])
                ).values()
            ),
        [resolvedLiveDemand]
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
                const userId = initialWatchlists[0]?.user_id;
                if (!userId) {
                    setLiveState("disconnected");
                    return;
                }
                const url = new URL("/api/v1/live-streams/prices/ws", window.location.origin);
                url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
                url.searchParams.set("user_id", userId);
                url.searchParams.set("scope", "client");
                if (cancelled) return;
                const socket = new WebSocket(url.toString());
                liveSocketRef.current = socket;
                socket.onopen = () => {
                    socket.send(
                        JSON.stringify({
                            type: "subscribe",
                            refs: livePriceRefs
                                .filter((ref) => ref.account_id && ref.broker_code && ref.symbol)
                                .map((ref) => `${ref.account_id}|${ref.broker_code}|${ref.symbol}`)
                        })
                    );
                    setLiveState("connected");
                };
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
                socket.onerror = () => {
                    setLiveState("connecting");
                    socket.close();
                };
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
        let cancelled = false;

        async function touchDemand() {
            try {
                const rows = await touchLiveDemandSubscriptions({
                    subscriptions: demand,
                    scopes: [
                        { source_type: "watchlist_view", source_id: "watchlist_active_view" },
                        { source_type: "symbol_search", source_id: "watchlist_symbol_search" }
                    ]
                });
                if (!cancelled) setResolvedLiveDemand(rows);
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
        const message = caught instanceof Error ? caught.message : fallback;
        setError(message);
        toast.error(message);
    }

    async function readSymbolsFromCsv(file: File): Promise<string[]> {
        return extractSymbolsFromCsv(await file.text());
    }

    function importCreateCsv(file: File | null) {
        if (!file) return;
        setError("");
        startTransition(async () => {
            try {
                const symbols = await readSymbolsFromCsv(file);
                if (!symbols.length) {
                    toast.info("No symbols found in the CSV.");
                    return;
                }
                setCreateSymbols((current) => Array.from(new Set([...parseSymbols(current), ...symbols])).join(", "));
                toast.success(`Loaded ${symbols.length} symbols from CSV.`);
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
        startTransition(async () => {
            try {
                const symbols = await readSymbolsFromCsv(file);
                if (!symbols.length) {
                    toast.info("No symbols found in the CSV.");
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
                toast.success(`Imported ${result.added_symbols.length} symbols from CSV.${skipped}`);
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
                toast.success(`Created ${finalWatchlist.name}.`);
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
        startTransition(async () => {
            try {
                const updated = await updateWatchlist(selected.id, { name });
                setWatchlists((current) => upsertWatchlist(current, updated));
                setSelectedId(updated.id);
                setEditingName(false);
                toast.success(`Renamed to ${updated.name}.`);
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
        const symbolKey = row.symbol.trim().toUpperCase();
        const watchlistId = selected.id;
        const alreadyPresent = selectedSymbols.includes(symbolKey);
        const optimisticId = `optimistic:${symbolKey}:${selectedExchange ?? ""}`;
        setError("");

        // Optimistically drop the symbol in so it appears instantly (ghosted)
        // while the server round-trip completes — reconciled or rolled back below.
        if (!alreadyPresent) {
            const optimisticItem: WatchlistSymbol = {
                id: optimisticId,
                symbol: row.symbol,
                exchange: selectedExchange,
                instrument_ref: instrumentFromSearch(row),
                sort_order: selected.items.length,
                created_at: new Date().toISOString()
            };
            setWatchlists((current) =>
                current.map((wl) =>
                    wl.id === watchlistId
                        ? { ...wl, items: [...wl.items, optimisticItem], symbols: [...wl.symbols, row.symbol] }
                        : wl
                )
            );
            setPendingSymbols((current) => new Set(current).add(symbolKey));
        }

        // Clear the search UI right away — the add feels immediate.
        setSymbolSearch("");
        setSuggestions([]);
        setActiveSuggestionIndex(-1);
        setShowSuggestions(false);

        startTransition(async () => {
            try {
                const result = await addSymbolsToWatchlist(watchlistId, {
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
                // Replace the optimistic row with the canonical server watchlist.
                setWatchlists((current) => upsertWatchlist(current, result.watchlist));
                setSelectedId(result.watchlist.id);
                if (result.added_symbols.length) {
                    toast.success(`Added ${row.symbol}.`);
                } else {
                    const skipped = result.skipped_symbols.length ? " Already in this watchlist." : "";
                    toast.info(
                        result.skipped_symbols.length
                            ? `${row.symbol} is already in this watchlist.`
                            : `${row.symbol} was not added.${skipped}`
                    );
                }
            } catch (caught) {
                // Roll back the optimistic insert so the UI matches the server.
                if (!alreadyPresent) {
                    setWatchlists((current) =>
                        current.map((wl) =>
                            wl.id === watchlistId
                                ? {
                                      ...wl,
                                      items: wl.items.filter((item) => item.id !== optimisticId),
                                      symbols: wl.symbols.filter((value) => value !== row.symbol)
                                  }
                                : wl
                        )
                    );
                }
                fail(caught, `Could not add ${row.symbol}.`);
            } finally {
                if (!alreadyPresent) {
                    setPendingSymbols((current) => {
                        const next = new Set(current);
                        next.delete(symbolKey);
                        return next;
                    });
                }
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
        startTransition(async () => {
            try {
                const updated = await removeSymbolFromWatchlist(selected.id, symbol, symbolExchange);
                setWatchlists((current) => upsertWatchlist(current, updated));
                setSelectedId(updated.id);
                toast.success(`Removed ${symbol}.`);
            } catch (caught) {
                fail(caught, "Could not remove symbol.");
            }
        });
    }

    function removeWatchlist() {
        if (!selected) return;
        const deletedId = selected.id;
        setError("");
        startTransition(async () => {
            try {
                await deleteWatchlist(deletedId);
                const next = watchlists.filter((item) => item.id !== deletedId);
                setWatchlists(next);
                setSelectedId(next[0]?.id ?? "");
                setConfirmDelete(false);
                toast.success("Watchlist deleted.", { id: "watchlist-deleted" });
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
                toast.success(`Added ${created.name}.`);
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
                toast.success(`Refreshed ${updated.name}.`);
            } catch (caught) {
                fail(caught, "Could not refresh preset watchlist.");
            }
        });
    }

    return (
        <section className="flex min-h-0 flex-1 flex-col min-[980px]:overflow-hidden">
            {error ? (
                <div className="mb-4 shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            <div className="shrink-0">
                <PageHeader
                    description="Search instruments, maintain focused symbol lists, and keep broker-native identifiers attached to every selected ticker."
                    title="Watchlists"
                />
            </div>

            <Dialog open={showAlphaConfigPrompt} onOpenChange={setShowAlphaConfigPrompt}>
                <DialogContent className="max-w-[425px]">
                    <DialogHeader>
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
                        <DialogClose
                            render={<Button className="normal-case tracking-normal" type="button" variant="ghost" />}
                        >
                            Cancel
                        </DialogClose>
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
                <DialogContent className="max-w-[425px]" showCloseButton={!isPending}>
                    <DialogHeader>
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center border border-destructive/40 bg-destructive/10 text-destructive">
                                <AlertTriangle className="size-5" />
                            </span>
                            <div className="min-w-0">
                                <DialogTitle>Delete watchlist?</DialogTitle>
                                <DialogDescription className="leading-6">
                                    This will permanently delete{" "}
                                    <span className="font-semibold text-foreground">
                                        {selected?.name ?? "this watchlist"}
                                    </span>
                                    {selected ? ` and its ${selected.items.length} saved symbols` : ""}. This action
                                    cannot be undone.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                    <DialogPanel>
                        <div className="border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            Any alert workflows using this watchlist may lose that source after deletion.
                        </div>
                    </DialogPanel>
                    <DialogFooter>
                        <DialogClose
                            disabled={isPending}
                            render={<Button className="normal-case tracking-normal" type="button" variant="ghost" />}
                        >
                            Cancel
                        </DialogClose>
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
                        "max-w-[36rem]",
                        createParsedSymbols.length ? "max-h-[min(100dvh-2rem,42rem)]" : "max-h-[min(100dvh-2rem,26rem)]"
                    )}
                >
                    <DialogHeader>
                        <DialogTitle>Create watchlist</DialogTitle>
                        <DialogDescription>Name your list, add symbols, then create.</DialogDescription>
                    </DialogHeader>

                    <DialogPanel className="space-y-6">
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
                                        aria-expanded={showCreateSuggestions && createSearch.trim() ? "true" : "false"}
                                        aria-label="Search companies or tickers"
                                        className="h-10 min-w-0 pl-9 pr-9 font-mono text-sm uppercase"
                                        id="create-watchlist-search"
                                        inputClassName="px-0"
                                        onChange={(event) => setCreateSearch(event.target.value.toUpperCase())}
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
                                        const metadata = createSuggestionMetadata[row.symbol.trim().toUpperCase()];
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
                                                key={[row.symbol, row.exchange, row.trading_symbol, row.expiry].join(
                                                    ":"
                                                )}
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
                                                    {[row.exchange, row.instrument_type].filter(Boolean).join(" · ")}
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
                                                    <SymbolAvatar className="size-7 rounded-md" symbol={symbol} />
                                                    <span className="truncate text-sm font-medium">{symbol}</span>
                                                    <Badge className="ml-auto" variant="outline">
                                                        CSV
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="px-4 py-4 text-sm leading-relaxed text-muted-foreground">
                                            Search for companies like RELIANCE or TCS, or import a CSV to add multiple
                                            symbols. You can add as many as you need — duplicates are skipped and
                                            symbols can be removed before you create.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>
                    </DialogPanel>

                    <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
                            <DialogClose disabled={isPending} render={<Button type="button" variant="ghost" />}>
                                Cancel
                            </DialogClose>
                            <Button disabled={!createCanSubmit} onClick={create} type="button">
                                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                                Create watchlist
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="flex min-h-0 flex-1 flex-col gap-4 min-[1080px]:grid min-[1080px]:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] min-[1080px]:overflow-hidden">
                <aside className="min-h-0 min-w-0 min-[1080px]:overflow-hidden">
                    <CardFrame className="min-h-0 min-[1080px]:h-full">
                        <CardFrameHeader className="gap-y-1.5 border-b px-4 py-3.5">
                            <CardFrameTitle className={cn(typography.small, "self-start leading-none")}>
                                Configuration
                            </CardFrameTitle>
                            <CardFrameDescription className="max-w-[15rem] self-start text-xs leading-5">
                                Choose a saved list or import an index preset.
                            </CardFrameDescription>
                            <CardFrameAction>
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
                            </CardFrameAction>
                        </CardFrameHeader>

                        <Tabs className="relative z-[1] min-h-0 flex-1 gap-0 overflow-hidden" defaultValue="watchlists">
                            <div className="border-b px-3 py-3">
                                <TabsList className="w-full">
                                    <TabsTrigger className="flex-1" value="watchlists">
                                        Watchlists
                                    </TabsTrigger>
                                    <TabsTrigger className="flex-1" value="presets">
                                        Presets
                                    </TabsTrigger>
                                </TabsList>
                            </div>

                            <TabsContent className="min-h-0 overflow-hidden p-3 pt-0" value="watchlists">
                                <nav
                                    aria-label="Watchlists"
                                    className="flex min-h-0 flex-col gap-2 overflow-y-auto max-[1079px]:max-h-72 min-[1080px]:h-full"
                                >
                                    {watchlists.map((item) => {
                                        const active = item.id === selected?.id;
                                        const symbolCount = watchlistSymbolCount(item);
                                        return (
                                            <Button
                                                aria-current={active ? "page" : undefined}
                                                className={cn(
                                                    "group relative w-full items-stretch justify-start overflow-hidden rounded-lg border p-0 text-left whitespace-normal",
                                                    "first:mt-3",
                                                    active
                                                        ? "border-primary/55 bg-primary/5 text-foreground"
                                                        : "border-border bg-card text-foreground hover:border-primary/25 hover:bg-muted/35"
                                                )}
                                                key={item.id}
                                                onClick={() => {
                                                    setSelectedId(item.id);
                                                    setEditingName(false);
                                                    setError("");
                                                }}
                                                size="auto"
                                                type="button"
                                                variant="ghost"
                                            >
                                                <span
                                                    className={cn(
                                                        "absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-primary opacity-0",
                                                        active && "opacity-100"
                                                    )}
                                                />
                                                <span className="flex min-w-0 flex-1 flex-col gap-3 px-3 py-3">
                                                    <span className="flex min-w-0 items-start justify-between gap-3">
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-sm font-medium leading-snug">
                                                                {item.name}
                                                            </span>
                                                            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                                                <Badge
                                                                    size="sm"
                                                                    variant={
                                                                        item.kind === "preset" ? "info" : "outline"
                                                                    }
                                                                >
                                                                    {watchlistKindLabel(item)}
                                                                </Badge>
                                                                {item.preset_sync_status ? (
                                                                    <Badge
                                                                        size="sm"
                                                                        variant={presetSyncVariant(
                                                                            item.preset_sync_status
                                                                        )}
                                                                    >
                                                                        {item.preset_sync_status}
                                                                    </Badge>
                                                                ) : null}
                                                            </span>
                                                        </span>
                                                        <span
                                                            className={cn(
                                                                "flex size-6 shrink-0 items-center justify-center rounded-md border",
                                                                active
                                                                    ? "border-primary/40 bg-primary text-primary-foreground"
                                                                    : "border-border bg-background text-muted-foreground group-hover:text-foreground"
                                                            )}
                                                        >
                                                            {active ? (
                                                                <Check aria-hidden className="size-3.5" />
                                                            ) : (
                                                                <CandlestickChart aria-hidden className="size-3.5" />
                                                            )}
                                                        </span>
                                                    </span>
                                                    <span className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                                                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                                                            <CandlestickChart aria-hidden className="size-3.5" />
                                                            {symbolCount} symbol{symbolCount === 1 ? "" : "s"}
                                                        </span>
                                                        <span className="shrink-0 tabular-nums">
                                                            {formatDate(item.updated_at).split(",")[0]}
                                                        </span>
                                                    </span>
                                                </span>
                                            </Button>
                                        );
                                    })}
                                    {!watchlists.length ? (
                                        <div className="mt-3 rounded-lg border border-dashed bg-card/40 px-3 py-8 text-center text-sm text-muted-foreground">
                                            Saved watchlists will appear here.
                                        </div>
                                    ) : null}
                                </nav>
                            </TabsContent>

                            <TabsContent className="min-h-0 overflow-hidden p-3" value="presets">
                                <div className="flex h-full min-h-0 flex-col gap-3">
                                    <div className="grid gap-1">
                                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                            Preset catalog
                                        </span>
                                        <div className="relative">
                                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                className="h-9 shrink-0 pl-9"
                                                onChange={(event) => setPresetQuery(event.target.value)}
                                                placeholder="Search Nifty indices"
                                                value={presetQuery}
                                            />
                                        </div>
                                    </div>
                                    <div
                                        className="min-h-0 flex-1 space-y-2 overflow-y-auto max-[1079px]:max-h-72"
                                        onScroll={handlePresetScroll}
                                        ref={presetListRef}
                                    >
                                        {presetResults.map((item) => (
                                            <Card
                                                className={cn(
                                                    "first:mt-3 shadow-none transition-colors",
                                                    item.is_added
                                                        ? "border-primary/25 bg-primary/5"
                                                        : "hover:border-primary/25"
                                                )}
                                                key={item.id}
                                            >
                                                <div className="flex items-start justify-between gap-3 p-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                                            <p className={cn(typography.small, "min-w-0 break-words")}>
                                                                {item.name}
                                                            </p>
                                                            {item.is_popular ? (
                                                                <Badge size="sm" variant="secondary">
                                                                    Popular
                                                                </Badge>
                                                            ) : null}
                                                            {item.is_added ? (
                                                                <Badge size="sm" variant="success">
                                                                    Added
                                                                </Badge>
                                                            ) : null}
                                                        </div>
                                                        <p className="mt-1 truncate text-xs text-muted-foreground">
                                                            {item.trading_index_name}
                                                        </p>
                                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                            <Badge className="tabular-nums" size="sm" variant="outline">
                                                                <CandlestickChart
                                                                    aria-hidden
                                                                    className="size-3.5 shrink-0"
                                                                />
                                                                {item.constituent_count} symbol
                                                                {item.constituent_count === 1 ? "" : "s"}
                                                            </Badge>
                                                            <Badge
                                                                size="sm"
                                                                variant={presetSyncVariant(item.sync_status)}
                                                            >
                                                                {item.sync_status}
                                                            </Badge>
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
                                            <Card className="mt-3 border-dashed shadow-none">
                                                <Empty className="py-8">
                                                    <EmptyHeader>
                                                        <EmptyTitle className="text-base">
                                                            {presetLoading ? "Loading presets" : "No presets found"}
                                                        </EmptyTitle>
                                                        <EmptyDescription>
                                                            {presetLoading
                                                                ? "Fetching index catalog..."
                                                                : "Try a different search term."}
                                                        </EmptyDescription>
                                                    </EmptyHeader>
                                                </Empty>
                                            </Card>
                                        ) : null}
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </CardFrame>
                </aside>

                <main className="flex min-h-0 min-w-0 flex-1 flex-col min-[1080px]:overflow-hidden">
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
                                            <CardFrameTitle
                                                className={cn(typography.h3, "flex flex-wrap items-center gap-2")}
                                            >
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
                                                                    onMouseEnter={() => setActiveSuggestionIndex(index)}
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
                                                            const price =
                                                                livePrices[livePriceKey({ symbol: item.symbol })];
                                                            const change = toNumber(
                                                                price?.change_pct ?? price?.day_change_perc
                                                            );
                                                            const priceText = livePriceLabel(price);
                                                            const priceUnavailable =
                                                                priceText === "—" && Boolean(price?.unavailable_reason);
                                                            const rowPending = pendingSymbols.has(
                                                                item.symbol.trim().toUpperCase()
                                                            );
                                                            return (
                                                                <TableRow
                                                                    className={cn(
                                                                        "group transition-opacity",
                                                                        rowPending &&
                                                                            "opacity-55 motion-safe:animate-pulse"
                                                                    )}
                                                                    key={item.id}
                                                                >
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
                                                                                title={
                                                                                    price?.unavailable_reason ??
                                                                                    undefined
                                                                                }
                                                                                variant="outline"
                                                                            >
                                                                                Unavailable
                                                                            </Badge>
                                                                        ) : (
                                                                            <span
                                                                                className="font-semibold"
                                                                                title={
                                                                                    price?.unavailable_reason ??
                                                                                    undefined
                                                                                }
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
                                                                                    removeSymbol(
                                                                                        item.symbol,
                                                                                        item.exchange
                                                                                    )
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
                                                                {selected.items.length === 1 ? "" : "s"} in this
                                                                watchlist
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
                                                    ? "Search above to add symbols and track them live."
                                                    : "This preset doesn't have any symbols yet."}
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
                                    const rowPending = pendingSymbols.has(item.symbol.trim().toUpperCase());
                                    return (
                                        <Card
                                            className={cn(
                                                "shadow-none transition-opacity",
                                                rowPending && "opacity-55 motion-safe:animate-pulse"
                                            )}
                                            key={item.id}
                                        >
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
                                                            onClick={() => removeSymbol(item.symbol, item.exchange)}
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
                                                        <dd className="mt-1 font-semibold tabular-nums">{priceText}</dd>
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
                                                <EmptyMedia variant="icon">
                                                    <Search />
                                                </EmptyMedia>
                                                <EmptyTitle className="text-base">No symbols yet</EmptyTitle>
                                                <EmptyDescription>
                                                    {canEditSelected
                                                        ? "Search above to add symbols and track them live."
                                                        : "This preset doesn't have any symbols yet."}
                                                </EmptyDescription>
                                            </EmptyHeader>
                                        </Empty>
                                    </Card>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <Card className="min-h-[22rem] border-dashed bg-card/45 shadow-none">
                            <Empty className="px-6 py-14 sm:py-16">
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
                                <EmptyContent>
                                    <Button onClick={requestCreateWatchlist} type="button" variant="outline">
                                        <Plus className="size-4" />
                                        New watchlist
                                    </Button>
                                </EmptyContent>
                            </Empty>
                        </Card>
                    )}
                </main>
            </div>
        </section>
    );
}
