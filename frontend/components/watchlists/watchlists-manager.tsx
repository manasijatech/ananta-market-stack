"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type UIEvent } from "react";
import { AlertTriangle, Check, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
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
import type { InstrumentSearchRow } from "@/service/types/broker";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { Watchlist, WatchlistPresetCatalogEntry } from "@/service/types/watchlist";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";
import { formatIstDateTime } from "@/lib/datetime";

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

function formatMarketCap(value?: number | null): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
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

const inputBase =
    " border-0 border-b border-input bg-transparent px-0 text-foreground outline-none ring-0 placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-0";
const PRESET_PAGE_SIZE = 24;

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
    const [exchange, setExchange] = useState("NSE");
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
    const [isPending, startTransition] = useTransition();
    const searchWrapRef = useRef<HTMLDivElement | null>(null);
    const presetListRef = useRef<HTMLDivElement | null>(null);
    const createCsvInputRef = useRef<HTMLInputElement | null>(null);
    const addCsvInputRef = useRef<HTMLInputElement | null>(null);

    const selected = useMemo(
        () => watchlists.find((item) => item.id === selectedId) ?? watchlists[0] ?? null,
        [selectedId, watchlists]
    );
    const selectedSymbols = useMemo(
        () => selected?.items.map((item) => item.symbol.trim().toUpperCase()).filter(Boolean) ?? [],
        [selected]
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
        <section
            className="-mx-4 -my-6 min-h-[calc(100dvh-67px)] bg-background text-foreground min-[760px]:-mx-8 min-[760px]:-my-8 min-[980px]:-mx-10 min-[980px]:-my-10 min-[980px]:h-[calc(100vh-80px)] min-[980px]:overflow-hidden"
            style={{ fontFamily: '"DM Sans", "Suisse Intl", Inter, ui-sans-serif, system-ui, sans-serif' }}
        >
            <style>{`
 @keyframes watchlist-row-fade {
 from { opacity: 0; transform: translateY(3px); }
 to { opacity: 1; transform: translateY(0); }
 }
 .watchlist-data-row { animation: watchlist-row-fade 120ms ease-out both; }
 `}</style>
            <div className="flex min-h-0 flex-col px-4 py-5 min-[760px]:h-full min-[760px]:px-8 min-[980px]:px-10">
                {error ? (
                    <div className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--danger)]">
                        {error}
                    </div>
                ) : null}
                {notice ? (
                    <div className="mb-3 border-l-2 border-primary bg-[var(--accent-glow)] px-3 py-2 text-sm text-primary">
                        {notice}
                    </div>
                ) : null}

                <header className="mb-6 flex min-w-0 flex-col gap-3 border-b border-border pb-5 min-[760px]:mb-7 min-[760px]:flex-row min-[760px]:items-end min-[760px]:justify-between">
                    <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                            Market Workspace
                        </div>
                        <h1 className="mt-2 text-3xl font-semibold text-foreground min-[760px]:text-5xl">Watchlists</h1>
                    </div>
                    <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                        Search instruments, maintain focused symbol lists, and keep broker-native identifiers attached
                        to every selected ticker.
                    </p>
                </header>

                <Dialog open={showAlphaConfigPrompt} onOpenChange={setShowAlphaConfigPrompt}>
                    <DialogContent className="w-[calc(100vw-2rem)] max-w-[425px] gap-4 p-6">
                        <DialogHeader className="pr-8">
                            <DialogTitle>Manasija Alpha API required</DialogTitle>
                            <DialogDescription>
                                Add a Manasija Alpha API key in System Config before creating watchlists.
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
                                    router.push("/system-config");
                                }}
                                type="button"
                            >
                                Go to System Config
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
                    <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto p-0 min-[760px]:w-full min-[760px]:max-h-[calc(100vh-2.5rem)]">
                        <DialogHeader className="border-b border-border px-4 py-5 pr-16 min-[760px]:px-8">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                                New Watchlist
                            </div>
                            <DialogTitle className="mt-1 text-2xl font-semibold">Create Watchlist</DialogTitle>
                        </DialogHeader>

                        <div className="space-y-7 px-4 py-5 min-[760px]:px-8 min-[760px]:py-6">
                            <div>
                                <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Watchlist Name
                                </Label>
                                <Input
                                    className={`${inputBase} h-12 text-lg`}
                                    maxLength={128}
                                    onChange={(event) => setCreateName(event.target.value)}
                                    placeholder="Name"
                                    value={createName}
                                />
                            </div>

                            <div className="grid gap-8 min-[980px]:grid-cols-[minmax(0,1fr)_22rem]">
                                <div className="min-w-0">
                                    <div className="grid gap-4 min-[760px]:grid-cols-[1fr_8rem]">
                                        <div className="min-w-0">
                                            <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                Search Symbols
                                            </Label>
                                            <div>
                                                <div className="relative">
                                                    <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-primary" />
                                                    <Input
                                                        aria-activedescendant={
                                                            createActiveSuggestionIndex >= 0
                                                                ? `create-watchlist-symbol-suggestion-${createActiveSuggestionIndex}`
                                                                : undefined
                                                        }
                                                        aria-autocomplete="list"
                                                        aria-controls="create-watchlist-symbol-suggestions"
                                                        aria-expanded={
                                                            showCreateSuggestions && createSearch.trim()
                                                                ? "true"
                                                                : "false"
                                                        }
                                                        className={`${inputBase} h-12 pl-7 pr-9 font-mono text-base uppercase`}
                                                        onChange={(event) =>
                                                            setCreateSearch(event.target.value.toUpperCase())
                                                        }
                                                        onFocus={() => {
                                                            if (createSuggestions.length)
                                                                setShowCreateSuggestions(true);
                                                        }}
                                                        onKeyDown={handleCreateSearchKeyDown}
                                                        placeholder="SEARCH SYMBOL, TRADING SYMBOL, COMPANY"
                                                        role="combobox"
                                                        value={createSearch}
                                                    />
                                                    {createSearchLoading ? (
                                                        <Loader2 className="absolute right-0 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                                                    ) : null}
                                                </div>
                                                {showCreateSuggestions && createSearch.trim() ? (
                                                    <div
                                                        className="mt-3 max-h-[28rem] w-full overflow-auto border border-border bg-popover"
                                                        id="create-watchlist-symbol-suggestions"
                                                        role="listbox"
                                                    >
                                                        {createSuggestions.map((row, index) => {
                                                            const metadata =
                                                                createSuggestionMetadata[
                                                                    row.symbol.trim().toUpperCase()
                                                                ];
                                                            return (
                                                                <Button
                                                                    aria-selected={
                                                                        index === createActiveSuggestionIndex
                                                                    }
                                                                    className={[
                                                                        "h-auto w-full justify-between gap-5 rounded-none border-b border-l-2 border-border px-4 py-3 text-left transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)]",
                                                                        index === createActiveSuggestionIndex
                                                                            ? "border-l-primary bg-[var(--accent-glow)] text-foreground"
                                                                            : "border-l-transparent bg-background/70 text-foreground"
                                                                    ].join(" ")}
                                                                    disabled={isPending}
                                                                    id={`create-watchlist-symbol-suggestion-${index}`}
                                                                    key={[
                                                                        row.symbol,
                                                                        row.exchange,
                                                                        row.trading_symbol,
                                                                        row.expiry
                                                                    ].join(":")}
                                                                    onClick={() => addCreateSearchedSymbol(row)}
                                                                    onMouseEnter={() =>
                                                                        setCreateActiveSuggestionIndex(index)
                                                                    }
                                                                    role="option"
                                                                    variant="ghost"
                                                                    type="button"
                                                                >
                                                                    <span className="flex min-w-0 items-center gap-4">
                                                                        {metadata?.logo ? (
                                                                            <img
                                                                                alt=""
                                                                                className="size-10 shrink-0 object-contain"
                                                                                src={metadata.logo}
                                                                            />
                                                                        ) : (
                                                                            <span className="flex size-10 shrink-0 items-center justify-center font-mono text-[10px] font-semibold text-muted-foreground">
                                                                                {row.symbol.slice(0, 2)}
                                                                            </span>
                                                                        )}
                                                                        <span className="min-w-0">
                                                                            <span className="block font-mono text-base font-semibold">
                                                                                {row.symbol}
                                                                            </span>
                                                                            <span className="block truncate text-xs text-muted-foreground">
                                                                                {[
                                                                                    metadata?.company_name ?? row.name,
                                                                                    row.trading_symbol,
                                                                                    row.account_label
                                                                                ]
                                                                                    .filter(Boolean)
                                                                                    .join(" / ")}
                                                                            </span>
                                                                        </span>
                                                                    </span>
                                                                    <span className="shrink-0 font-mono text-xs uppercase text-primary">
                                                                        {[row.exchange, row.instrument_type]
                                                                            .filter(Boolean)
                                                                            .join(" / ")}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        })}
                                                        {!createSuggestions.length && !createSearchLoading ? (
                                                            <div className="px-3 py-3 text-sm text-muted-foreground">
                                                                No matching instruments found.
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div>
                                            <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                Exchange
                                            </Label>
                                            <Input
                                                className={`${inputBase} h-12 font-mono text-base uppercase`}
                                                onChange={(event) => setExchange(event.target.value.toUpperCase())}
                                                placeholder="NSE"
                                                value={exchange}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="min-w-0 border-l-0 border-border min-[980px]:border-l min-[980px]:pl-8">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                            Selected Symbols
                                        </div>
                                        <Button
                                            className="inline-flex items-center gap-1 border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-opacity duration-100 ease-out hover:opacity-70 disabled:opacity-30"
                                            disabled={isPending}
                                            onClick={() => createCsvInputRef.current?.click()}
                                            size="sm"
                                            type="button"
                                            variant="ghost"
                                        >
                                            <Upload className="size-3" />
                                            CSV
                                        </Button>
                                        <Input
                                            accept=".csv,text/csv"
                                            className="hidden"
                                            onChange={(event) => importCreateCsv(event.target.files?.[0] ?? null)}
                                            ref={createCsvInputRef}
                                            type="file"
                                        />
                                    </div>
                                    <div className="min-h-72 border border-border">
                                        {createParsedSymbols.length ? (
                                            <div className="max-h-[32rem] divide-y divide-border overflow-auto">
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
                                                            className="flex items-start justify-between gap-4 px-4 py-3"
                                                            key={createInstrumentKey(row)}
                                                        >
                                                            <span className="flex min-w-0 items-center gap-3">
                                                                {metadata?.logo ? (
                                                                    <img
                                                                        alt=""
                                                                        className="size-9 shrink-0 object-contain"
                                                                        src={metadata.logo}
                                                                    />
                                                                ) : (
                                                                    <span className="flex size-9 shrink-0 items-center justify-center font-mono text-[10px] font-semibold text-muted-foreground">
                                                                        {displayName.slice(0, 2)}
                                                                    </span>
                                                                )}
                                                                <span className="block truncate text-sm font-semibold text-foreground">
                                                                    {displayName}
                                                                </span>
                                                            </span>
                                                            <Button
                                                                aria-label={`Remove ${displayName}`}
                                                                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                                                                onClick={() => removeCreateSearchedSymbol(row)}
                                                                size="icon"
                                                                type="button"
                                                                variant="ghost"
                                                            >
                                                                <X className="size-4" />
                                                            </Button>
                                                        </div>
                                                    );
                                                })}
                                                {parseSymbols(createSymbols).map((symbol) => (
                                                    <div
                                                        className="flex items-center justify-between gap-4 px-4 py-3"
                                                        key={`csv:${symbol}`}
                                                    >
                                                        <span className="flex min-w-0 items-center gap-3">
                                                            <span className="flex size-9 shrink-0 items-center justify-center font-mono text-[10px] font-semibold text-muted-foreground">
                                                                {symbol.slice(0, 2)}
                                                            </span>
                                                            <span className="block truncate text-sm font-semibold text-foreground">
                                                                {symbol}
                                                            </span>
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="px-4 py-12 text-sm text-muted-foreground">
                                                Search and select symbols to seed this watchlist.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <DialogFooter className="items-stretch justify-between gap-4 border-t border-border px-4 py-5 min-[760px]:flex-row min-[760px]:items-center min-[760px]:px-8">
                            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                {createParsedSymbols.length} symbols selected
                            </span>
                            <div className="flex items-center justify-end gap-3">
                                <Button
                                    className="h-auto border-b border-border px-0 pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-opacity duration-100 ease-out hover:opacity-70"
                                    disabled={isPending}
                                    onClick={resetCreateModal}
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    className="border-b border-primary pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary transition-opacity duration-100 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
                                    disabled={isPending || !createName.trim()}
                                    onClick={create}
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                >
                                    Create
                                </Button>
                            </div>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <div className="flex min-h-0 flex-1 flex-col gap-6 min-[760px]:gap-8 min-[980px]:grid min-[980px]:grid-cols-[320px_260px_minmax(0,1fr)] min-[980px]:gap-8">
                    <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-border pb-6 min-[980px]:order-2 min-[980px]:border-b-0 min-[980px]:border-r min-[980px]:pb-0 min-[980px]:pr-5">
                        <div className="mb-4 flex items-center justify-between gap-3 shrink-0">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Your Watchlists
                            </div>
                            <Button
                                aria-label="Create watchlist"
                                className="size-8 border-transparent text-primary hover:border-primary"
                                disabled={isPending}
                                onClick={requestCreateWatchlist}
                                size="icon"
                                type="button"
                                variant="ghost"
                            >
                                <Plus className="size-4" />
                            </Button>
                        </div>

                        <nav
                            aria-label="Watchlists"
                            className="flex max-h-64 min-h-0 flex-1 flex-col overflow-y-auto pr-1 min-[760px]:max-h-80 min-[980px]:max-h-none"
                        >
                            {watchlists.map((item) => {
                                const active = item.id === selected?.id;
                                return (
                                    <Button
                                        className={[
                                            "group relative h-auto min-h-11 w-full justify-between gap-4 border-l-2 px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)]",
                                            active ? "border-primary bg-[var(--accent-glow)]" : "border-transparent"
                                        ].join(" ")}
                                        key={item.id}
                                        onClick={() => {
                                            setSelectedId(item.id);
                                            setEditingName(false);
                                            setError("");
                                            setNotice("");
                                        }}
                                        variant="ghost"
                                        type="button"
                                    >
                                        <span
                                            className={[
                                                "absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-primary transition-transform duration-100 ease-out group-hover:scale-y-100",
                                                active ? "scale-y-100" : ""
                                            ].join(" ")}
                                        />
                                        <span className="min-w-0">
                                            <span
                                                className={
                                                    active
                                                        ? "block truncate text-sm font-semibold text-foreground"
                                                        : "block truncate text-sm font-medium text-muted-foreground"
                                                }
                                            >
                                                {item.name}
                                            </span>
                                            <span className="mt-0.5 block font-mono text-[11px] uppercase text-muted-foreground">
                                                {item.items.length.toString().padStart(2, "0")} symbols
                                            </span>
                                        </span>
                                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                                            {formatDate(item.updated_at).split(",")[0]}
                                        </span>
                                    </Button>
                                );
                            })}
                            {!watchlists.length ? (
                                <div className="border-l-2 border-primary px-3 py-4 text-sm text-muted-foreground">
                                    No watchlists yet.
                                </div>
                            ) : null}
                        </nav>
                    </aside>

                    <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-border pb-6 min-[980px]:order-1 min-[980px]:border-b-0 min-[980px]:border-r min-[980px]:pb-0 min-[980px]:pr-5">
                        <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-5 min-[980px]:border-t-0 min-[980px]:pt-0">
                            <div className="mb-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Index Presets
                            </div>
                            <Input
                                className={`${inputBase} h-9 text-xs`}
                                onChange={(event) => setPresetQuery(event.target.value)}
                                placeholder="Search Nifty indices"
                                value={presetQuery}
                            />
                            <div
                                className="mt-3 max-h-64 min-h-0 overflow-y-auto pr-1 min-[760px]:max-h-80 min-[980px]:max-h-none"
                                onScroll={handlePresetScroll}
                                ref={presetListRef}
                            >
                                <div className="space-y-2">
                                    {presetResults.map((item) => (
                                        <div
                                            className="border-l-2 border-transparent px-3 py-2 transition-colors duration-100 ease-out hover:border-primary hover:bg-[var(--accent-glow)]"
                                            key={item.id}
                                        >
                                            <div className="flex flex-col gap-2">
                                                <div className="break-words text-sm font-medium leading-5 text-foreground">
                                                    {item.name}
                                                </div>
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                                            {[
                                                                item.trading_index_name,
                                                                `${item.constituent_count} symbols`,
                                                                item.sync_status
                                                            ]
                                                                .filter(Boolean)
                                                                .join(" / ")}
                                                        </div>
                                                    </div>
                                                    <Button
                                                        className="shrink-0 border-b border-primary pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary transition-opacity duration-100 ease-out hover:opacity-70 disabled:cursor-default disabled:opacity-40"
                                                        disabled={isPending || item.is_added}
                                                        onClick={() => addPreset(item)}
                                                        size="sm"
                                                        type="button"
                                                        variant="ghost"
                                                    >
                                                        {item.is_added ? "Added" : "Add"}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {presetLoadingMore ? (
                                    <div className="flex items-center gap-2 px-3 py-3 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                                        <Loader2 className="size-3 animate-spin" />
                                        Loading more presets
                                    </div>
                                ) : null}
                                {!presetResults.length ? (
                                    <div className="px-3 py-3 text-sm text-muted-foreground">
                                        {presetLoading
                                            ? "Loading preset indices..."
                                            : "No matching preset indices found."}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </aside>

                    <main className="flex min-h-0 min-w-0 flex-1 flex-col min-[980px]:order-3">
                        {selected ? (
                            <>
                                <div className="mb-6 flex shrink-0 flex-col gap-4 border-b border-border pb-5 min-[760px]:mb-7 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between min-[760px]:border-b-0">
                                    <div className="min-w-0 flex-1">
                                        {editingName ? (
                                            <div className="flex max-w-2xl items-end gap-3">
                                                <Input
                                                    className={`${inputBase} h-11 text-2xl font-semibold`}
                                                    maxLength={128}
                                                    onChange={(event) => setDraftName(event.target.value)}
                                                    value={draftName}
                                                />
                                                <Button
                                                    aria-label="Save watchlist name"
                                                    className="size-9 text-primary hover:bg-[var(--accent-glow)]"
                                                    disabled={isPending || !draftName.trim()}
                                                    onClick={saveName}
                                                    size="icon"
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    <Check className="size-4" />
                                                </Button>
                                                <Button
                                                    aria-label="Cancel rename"
                                                    className="size-9 text-muted-foreground hover:bg-[var(--accent-glow)]"
                                                    disabled={isPending}
                                                    onClick={() => {
                                                        setDraftName(selected.name);
                                                        setEditingName(false);
                                                    }}
                                                    size="icon"
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    <X className="size-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex min-w-0 flex-wrap items-center gap-3">
                                                    <h2 className="min-w-0 break-words text-2xl font-semibold text-foreground min-[760px]:truncate min-[760px]:text-4xl">
                                                        {selected.name}
                                                    </h2>
                                                    {selected.kind === "preset" ? (
                                                        <span className="border border-primary/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                                                            Preset
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="mt-2 font-mono text-xs uppercase text-muted-foreground">
                                                    {selected.items.length} symbols / updated{" "}
                                                    {formatDate(selected.updated_at)}
                                                </div>
                                                {selected.kind === "preset" ? (
                                                    <div className="mt-2 text-xs text-muted-foreground">
                                                        System-managed Nifty index constituents. This watchlist is
                                                        read-only and refreshes daily in the background.
                                                    </div>
                                                ) : null}
                                            </>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {selected.kind === "preset" ? (
                                            <Button
                                                aria-label="Refresh preset watchlist"
                                                className="size-9 text-muted-foreground hover:bg-[var(--accent-glow)] hover:text-primary"
                                                disabled={isPending}
                                                onClick={refreshSelectedPreset}
                                                size="icon"
                                                type="button"
                                                variant="ghost"
                                            >
                                                <RefreshCw className="size-4" />
                                            </Button>
                                        ) : null}
                                        {canEditSelected ? (
                                            <Button
                                                aria-label="Rename watchlist"
                                                className="size-9 text-muted-foreground hover:bg-[var(--accent-glow)] hover:text-primary"
                                                disabled={isPending}
                                                onClick={() => {
                                                    setDraftName(selected.name);
                                                    setEditingName(true);
                                                }}
                                                size="icon"
                                                type="button"
                                                variant="ghost"
                                            >
                                                <Pencil className="size-4" />
                                            </Button>
                                        ) : null}
                                        <Button
                                            aria-label="Delete watchlist"
                                            className="size-9 text-muted-foreground hover:bg-[var(--accent-glow)] hover:text-destructive"
                                            disabled={isPending}
                                            onClick={() => setConfirmDelete(true)}
                                            size="icon"
                                            type="button"
                                            variant="ghost"
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                </div>

                                {canEditSelected ? (
                                    <div className="mb-7 shrink-0">
                                        <div className="mb-3 flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-end">
                                            <div className="min-w-0 flex-1">
                                                <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    Add Symbol
                                                </Label>
                                                <div className="relative" ref={searchWrapRef}>
                                                    <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-primary" />
                                                    <Input
                                                        className={`${inputBase} h-11 pl-7 pr-9 font-mono text-sm uppercase`}
                                                        aria-activedescendant={
                                                            activeSuggestionIndex >= 0
                                                                ? `watchlist-symbol-suggestion-${activeSuggestionIndex}`
                                                                : undefined
                                                        }
                                                        aria-autocomplete="list"
                                                        aria-expanded={
                                                            showSuggestions && symbolSearch.trim() ? "true" : "false"
                                                        }
                                                        aria-controls="watchlist-symbol-suggestions"
                                                        onChange={(event) =>
                                                            setSymbolSearch(event.target.value.toUpperCase())
                                                        }
                                                        onFocus={() => {
                                                            if (suggestions.length) setShowSuggestions(true);
                                                        }}
                                                        onKeyDown={handleSearchKeyDown}
                                                        placeholder="SEARCH SYMBOL, TRADING SYMBOL, COMPANY"
                                                        role="combobox"
                                                        value={symbolSearch}
                                                    />
                                                    {searchLoading ? (
                                                        <Loader2 className="absolute right-0 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                                                    ) : null}
                                                    {showSuggestions && symbolSearch.trim() ? (
                                                        <div
                                                            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto border border-border bg-popover"
                                                            id="watchlist-symbol-suggestions"
                                                            role="listbox"
                                                        >
                                                            {suggestions.map((row, index) => {
                                                                const metadata =
                                                                    suggestionMetadata[row.symbol.trim().toUpperCase()];
                                                                return (
                                                                    <Button
                                                                        aria-selected={index === activeSuggestionIndex}
                                                                        className={[
                                                                            "h-auto w-full justify-between gap-4 rounded-none border-b border-l-2 border-border px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)]",
                                                                            index === activeSuggestionIndex
                                                                                ? "border-l-primary bg-[var(--accent-glow)] text-foreground"
                                                                                : "border-l-transparent bg-background/70 text-foreground"
                                                                        ].join(" ")}
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
                                                                        variant="ghost"
                                                                        type="button"
                                                                    >
                                                                        <span className="flex min-w-0 items-center gap-3">
                                                                            {metadata?.logo ? (
                                                                                <img
                                                                                    alt=""
                                                                                    className="size-8 shrink-0 object-contain"
                                                                                    src={metadata.logo}
                                                                                />
                                                                            ) : (
                                                                                <span className="flex size-8 shrink-0 items-center justify-center font-mono text-[10px] font-semibold text-muted-foreground">
                                                                                    {row.symbol.slice(0, 2)}
                                                                                </span>
                                                                            )}
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
                                                                                        .join(" / ")}
                                                                                </span>
                                                                            </span>
                                                                        </span>
                                                                        <span className="shrink-0 font-mono text-xs uppercase text-primary">
                                                                            {[row.exchange, row.instrument_type]
                                                                                .filter(Boolean)
                                                                                .join(" / ")}
                                                                        </span>
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
                                            <div className="w-full min-[760px]:w-32">
                                                <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    Exchange
                                                </Label>
                                                <Input
                                                    className={`${inputBase} h-11 font-mono text-sm uppercase`}
                                                    onChange={(event) => setExchange(event.target.value.toUpperCase())}
                                                    placeholder="NSE"
                                                    value={exchange}
                                                />
                                            </div>
                                            <div className="w-full min-[760px]:w-auto">
                                                <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    CSV
                                                </Label>
                                                <Button
                                                    className="inline-flex h-11 items-center gap-2 border-b border-border pb-1 font-mono text-xs uppercase text-muted-foreground transition-opacity duration-100 ease-out hover:opacity-70 disabled:opacity-30"
                                                    disabled={isPending}
                                                    onClick={() => addCsvInputRef.current?.click()}
                                                    size="sm"
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    <Upload className="size-4" />
                                                    Import CSV
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
                                    </div>
                                ) : null}

                                <div className="hidden min-h-0 flex-1 overflow-auto min-[760px]:block">
                                    <Table className="min-w-[1040px] border-collapse text-left text-sm">
                                        <TableHeader>
                                            <TableRow className="border-y border-border text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                                <TableHead className="py-2 pr-4 font-semibold">Ticker</TableHead>
                                                <TableHead className="px-4 py-2 font-semibold">Company</TableHead>
                                                <TableHead className="px-4 py-2 font-semibold">Exchange</TableHead>
                                                <TableHead className="px-4 py-2 font-semibold">Sector</TableHead>
                                                <TableHead className="px-4 py-2 text-right font-semibold">
                                                    Market cap
                                                </TableHead>
                                                <TableHead className="px-4 py-2 text-right font-semibold">
                                                    Order
                                                </TableHead>
                                                <TableHead className="px-4 py-2 font-semibold">Added</TableHead>
                                                <TableHead className="w-20 py-2 pl-4 text-right font-semibold">
                                                    Actions
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selected.items.map((item, index) => {
                                                const metadata = watchlistMetadata[item.symbol.trim().toUpperCase()];
                                                return (
                                                    <TableRow
                                                        className="watchlist-data-row group border-b border-border text-foreground odd:bg-muted/40 hover:bg-[var(--bg-hover)]"
                                                        key={item.id}
                                                        style={{ animationDelay: `${Math.min(index * 18, 120)}ms` }}
                                                    >
                                                        <TableCell className="py-3 pr-4">
                                                            <div className="flex items-center gap-3">
                                                                {metadata?.logo ? (
                                                                    <img
                                                                        alt=""
                                                                        className="size-8 shrink-0 object-contain"
                                                                        src={metadata.logo}
                                                                    />
                                                                ) : (
                                                                    <span className="flex size-8 shrink-0 items-center justify-center font-mono text-[10px] font-semibold text-muted-foreground">
                                                                        {item.symbol.slice(0, 2)}
                                                                    </span>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <div className="font-mono text-[15px] font-semibold text-foreground">
                                                                        {item.symbol}
                                                                    </div>
                                                                    {metadata?.scrip_code ? (
                                                                        <div className="font-mono text-[10px] uppercase text-muted-foreground">
                                                                            BSE {metadata.scrip_code}
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="max-w-[260px] px-4 py-3">
                                                            <div className="truncate text-sm font-medium text-foreground">
                                                                {metadata?.company_name ?? "-"}
                                                            </div>
                                                            <div className="truncate text-xs text-muted-foreground">
                                                                {metadata?.basic_industry ?? metadata?.theme ?? ""}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground">
                                                            {item.exchange ?? "-"}
                                                        </TableCell>
                                                        <TableCell className="max-w-[220px] px-4 py-3">
                                                            <div className="truncate text-xs font-medium text-foreground">
                                                                {metadata?.sector ?? "-"}
                                                            </div>
                                                            <div className="truncate text-xs text-muted-foreground">
                                                                {metadata?.industry ??
                                                                    metadata?.macro_economic_indicator ??
                                                                    ""}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                                                            {formatMarketCap(metadata?.market_cap ?? null)}
                                                        </TableCell>
                                                        <TableCell className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                                                            {item.sort_order + 1}
                                                        </TableCell>
                                                        <TableCell className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground">
                                                            {formatDate(item.created_at)}
                                                        </TableCell>
                                                        <TableCell className="w-20 py-3 pl-4 text-right">
                                                            {canEditSelected ? (
                                                                <Button
                                                                    aria-label={`Remove ${item.symbol}`}
                                                                    className="size-8 text-muted-foreground opacity-0 transition-all duration-100 ease-out hover:bg-[var(--accent-glow)] hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                                                                    disabled={isPending}
                                                                    onClick={() =>
                                                                        removeSymbol(item.symbol, item.exchange)
                                                                    }
                                                                    size="icon"
                                                                    type="button"
                                                                    variant="ghost"
                                                                >
                                                                    <Trash2 className="size-4" />
                                                                </Button>
                                                            ) : null}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                                <div className="grid gap-3 min-[760px]:hidden">
                                    {selected.items.map((item, index) => {
                                        const metadata = watchlistMetadata[item.symbol.trim().toUpperCase()];
                                        const company = metadata?.company_name ?? "-";
                                        return (
                                            <article
                                                className="watchlist-data-row border border-border bg-card p-3"
                                                key={item.id}
                                                style={{ animationDelay: `${Math.min(index * 18, 120)}ms` }}
                                            >
                                                <div className="flex min-w-0 items-start justify-between gap-3">
                                                    <div className="flex min-w-0 items-start gap-3">
                                                        {metadata?.logo ? (
                                                            <img
                                                                alt=""
                                                                className="size-9 shrink-0 object-contain"
                                                                src={metadata.logo}
                                                            />
                                                        ) : (
                                                            <span className="flex size-9 shrink-0 items-center justify-center font-mono text-[10px] font-semibold text-muted-foreground">
                                                                {item.symbol.slice(0, 2)}
                                                            </span>
                                                        )}
                                                        <div className="min-w-0">
                                                            <div className="font-mono text-base font-semibold text-foreground">
                                                                {item.symbol}
                                                            </div>
                                                            <div className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-foreground">
                                                                {company}
                                                            </div>
                                                            <div className="mt-1 font-mono text-[11px] uppercase text-muted-foreground">
                                                                {[
                                                                    item.exchange ?? "-",
                                                                    metadata?.sector ?? metadata?.industry
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join(" / ")}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {canEditSelected ? (
                                                        <Button
                                                            aria-label={`Remove ${item.symbol}`}
                                                            className="size-8 shrink-0 text-muted-foreground hover:bg-[var(--accent-glow)] hover:text-destructive"
                                                            disabled={isPending}
                                                            onClick={() => removeSymbol(item.symbol, item.exchange)}
                                                            size="icon"
                                                            type="button"
                                                            variant="ghost"
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    ) : null}
                                                </div>
                                                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
                                                    <div>
                                                        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                            Market cap
                                                        </dt>
                                                        <dd className="mt-1 font-mono font-semibold text-foreground">
                                                            {formatMarketCap(metadata?.market_cap ?? null)}
                                                        </dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                            Added
                                                        </dt>
                                                        <dd className="mt-1 font-mono font-semibold text-foreground">
                                                            {formatDate(item.created_at).split(",")[0]}
                                                        </dd>
                                                    </div>
                                                </dl>
                                            </article>
                                        );
                                    })}
                                </div>
                                {!selected.items.length ? (
                                    <div className="border-b border-border py-10 text-center text-sm text-muted-foreground">
                                        Search above to add the first symbol.
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <div className="border-l-2 border-primary px-5 py-12">
                                <div className="text-2xl font-semibold text-foreground">
                                    Create your first watchlist
                                </div>
                                <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                                    Use the plus button in the sidebar to name a list, then search the instrument cache
                                    to add symbols.
                                </p>
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </section>
    );
}
