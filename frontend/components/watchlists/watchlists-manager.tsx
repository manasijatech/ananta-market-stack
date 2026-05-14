"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";

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
 if (!value) return "-";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return value;
 return new Intl.DateTimeFormat("en-IN", {
 dateStyle: "medium",
 timeStyle: "short"
}).format(date);
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
 zerodha_instrument_token: row.identifiers.zerodha_instrument_token ? Number(row.identifiers.zerodha_instrument_token) : null,
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

export function WatchlistsManager({ initialWatchlists }: { initialWatchlists: Watchlist[] }) {
 const [watchlists, setWatchlists] = useState(() => sortWatchlists(initialWatchlists));
 const [selectedId, setSelectedId] = useState(initialWatchlists[0]?.id ?? "");
 const [createName, setCreateName] = useState("");
 const [createSymbols, setCreateSymbols] = useState("");
 const [showCreateForm, setShowCreateForm] = useState(false);
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
 const [editingName, setEditingName] = useState(false);
 const [draftName, setDraftName] = useState("");
 const [confirmDelete, setConfirmDelete] = useState(false);
 const [error, setError] = useState("");
 const [notice, setNotice] = useState("");
 const [isPending, startTransition] = useTransition();
 const searchWrapRef = useRef<HTMLDivElement | null>(null);
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
 const alphaSymbols = useMemo(() => selectedSymbols.slice(0, 20), [selectedSymbols]);
 const alphaSymbolKey = alphaSymbols.join(",");
 const createParsedSymbols = useMemo(() => parseSymbols(createSymbols), [createSymbols]);
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
 .catch(() => {
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
 const symbols = Array.from(new Set(result.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))).slice(0, 20);
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
 } catch {
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
 startTransition(async () => {
 try {
 const result = await searchWatchlistPresets(presetQuery, 24);
 if (!cancelled) setPresetResults(result);
 } catch {
 if (!cancelled) setPresetResults([]);
 } finally {
 if (!cancelled) setPresetLoading(false);
 }
 });
 }, 180);
 return () => {
 cancelled = true;
 window.clearTimeout(handle);
 };
 }, [presetQuery, startTransition]);

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
 const skipped = result.skipped_symbols.length ? ` Skipped ${result.skipped_symbols.length} duplicates already in this watchlist.` : "";
 setNotice(`Imported ${result.added_symbols.length} symbols from CSV.${skipped}`);
 } catch (caught) {
 fail(caught, "Could not import CSV symbols.");
 } finally {
 if (addCsvInputRef.current) addCsvInputRef.current.value = "";
 }
 });
}

function create() {
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
 const created = await createWatchlist({ name, symbols: createParsedSymbols });
 setWatchlists((current) => upsertWatchlist(current, created));
 setSelectedId(created.id);
 setCreateName("");
 setCreateSymbols("");
 setShowCreateForm(false);
 setNotice(`Created ${created.name}.`);
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
 setNotice(result.added_symbols.length ? `Added ${row.symbol}.` : `${row.symbol} was not added.${skipped}`);
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
 setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
 return;
 }
 if (event.key === "ArrowUp") {
 event.preventDefault();
 setShowSuggestions(true);
 setActiveSuggestionIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
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
 setError("");
 setNotice("");
 startTransition(async () => {
 try {
 const created = await addPresetWatchlist(entry.id);
 setWatchlists((current) => upsertWatchlist(current, created));
 setSelectedId(created.id);
 setPresetResults((current) =>
 current.map((item) =>
 item.id === entry.id ? { ...item, is_added: true, user_watchlist_id: created.id, constituent_count: created.items.length } : item
 )
 );
 setNotice(`Added ${created.name}.`);
 } catch (caught) {
 fail(caught, "Could not add preset watchlist.");
 }
 });
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
 ? { ...item, constituent_count: updated.items.length, sync_status: updated.preset_sync_status ?? item.sync_status, last_constituents_sync_at: updated.preset_last_synced_at ?? item.last_constituents_sync_at }
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
 className="-mx-5 -my-8 min-h-[calc(100vh-73px)] bg-background text-foreground min-[760px]:-mx-8 min-[980px]:-mx-10 min-[980px]:-my-10"
 style={{ fontFamily: '"DM Sans", "Suisse Intl", Inter, ui-sans-serif, system-ui, sans-serif' }}
 >
 <style>{`
 @keyframes watchlist-row-fade {
 from { opacity: 0; transform: translateY(3px); }
 to { opacity: 1; transform: translateY(0); }
 }
 .watchlist-data-row { animation: watchlist-row-fade 120ms ease-out both; }
 `}</style>
 <div className="px-5 py-5 min-[760px]:px-8 min-[980px]:px-10">
 {error ? <div className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div> : null}
 {notice ? <div className="mb-3 border-l-2 border-primary bg-[var(--accent-glow)] px-3 py-2 text-sm text-primary">{notice}</div> : null}

 <header className="mb-7 flex flex-col gap-3 border-b border-border pb-5 min-[760px]:flex-row min-[760px]:items-end min-[760px]:justify-between">
 <div>
 <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Market Workspace</div>
 <h1 className="mt-2 text-3xl font-semibold text-foreground min-[760px]:text-5xl">Watchlists</h1>
 </div>
 <p className="max-w-xl text-sm leading-6 text-muted-foreground">
 Search instruments, maintain focused symbol lists, and keep broker-native identifiers attached to every selected ticker.
 </p>
 </header>

 <div className="flex flex-col gap-8 min-[980px]:flex-row min-[980px]:gap-10">
 <aside className="w-full shrink-0 border-b border-border pb-6 min-[980px]:w-[292px] min-[980px]:border-b-0 min-[980px]:border-r min-[980px]:pb-0 min-[980px]:pr-6">
 <div className="mb-4 flex items-center justify-between gap-3">
 <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Your Watchlists</div>
 <button
 aria-label={showCreateForm ? "Close create watchlist form" : "Create watchlist"}
 className="flex size-8 items-center justify-center border border-transparent text-primary transition-colors duration-100 ease-out hover:border-primary disabled:opacity-40"
 disabled={isPending}
 onClick={() => setShowCreateForm((current) => !current)}
 type="button"
 >
 {showCreateForm ? <X className="size-4" /> : <Plus className="size-4" />}
 </button>
 </div>

 {showCreateForm ? (
 <div className="mb-5 border-l-2 border-primary pl-3">
 <Input
 className={`${inputBase} h-9 text-sm`}
 maxLength={128}
 onChange={(event) => setCreateName(event.target.value)}
 placeholder="Watchlist name"
 value={createName}
 />
 <Input
 className={`${inputBase} mt-2 h-9 text-xs uppercase`}
 onChange={(event) => setCreateSymbols(event.target.value.toUpperCase())}
 placeholder="Optional seed: RELIANCE, TCS"
 value={createSymbols}
 />
 <div className="mt-3 flex items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{createParsedSymbols.length} seed</span>
 <button
 className="inline-flex items-center gap-1 border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-opacity duration-100 ease-out hover:opacity-70 disabled:opacity-30"
 disabled={isPending}
 onClick={() => createCsvInputRef.current?.click()}
 type="button"
 >
 <Upload className="size-3" />
 CSV
 </button>
 <input accept=".csv,text/csv" className="hidden" onChange={(event) => importCreateCsv(event.target.files?.[0] ?? null)} ref={createCsvInputRef} type="file" />
 </div>
 <button
 className="border-b border-primary pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary transition-opacity duration-100 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
 disabled={isPending || !createName.trim()}
 onClick={create}
 type="button"
 >
 Create
 </button>
 </div>
 </div>
 ) : null}

 <div className="mt-8 border-t border-border pt-5">
 <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Index Presets</div>
 <Input
 className={`${inputBase} h-9 text-xs`}
 onChange={(event) => setPresetQuery(event.target.value)}
 placeholder="Search Nifty indices"
 value={presetQuery}
 />
 <div className="mt-3 space-y-2">
 {presetResults.map((item) => (
 <div className="border-l-2 border-transparent px-3 py-2 transition-colors duration-100 ease-out hover:border-primary hover:bg-[var(--accent-glow)]" key={item.id}>
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0">
 <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
 <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
 {[item.trading_index_name, `${item.constituent_count} symbols`, item.sync_status].filter(Boolean).join(" / ")}
 </div>
 </div>
 <button
 className="border-b border-primary pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary transition-opacity duration-100 ease-out hover:opacity-70 disabled:cursor-default disabled:opacity-40"
 disabled={isPending || item.is_added}
 onClick={() => addPreset(item)}
 type="button"
 >
 {item.is_added ? "Added" : "Add"}
 </button>
 </div>
 </div>
 ))}
 {!presetResults.length ? (
 <div className="px-3 py-3 text-sm text-muted-foreground">
 {presetLoading ? "Loading preset indices..." : "No matching preset indices found."}
 </div>
 ) : null}
 </div>
 </div>

 <nav aria-label="Watchlists" className="flex flex-col">
 {watchlists.map((item) => {
 const active = item.id === selected?.id;
 return (
 <button
 className={[
 "group relative flex min-h-11 w-full items-center justify-between gap-4 border-l-2 px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)]",
 active ? "border-primary bg-[var(--accent-glow)]" : "border-transparent"
 ].join(" ")}
 key={item.id}
 onClick={() => {
 setSelectedId(item.id);
 setEditingName(false);
 setError("");
 setNotice("");
 }}
 type="button"
 >
 <span
 className={[
 "absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-primary transition-transform duration-100 ease-out group-hover:scale-y-100",
 active ? "scale-y-100" : ""
 ].join(" ")}
 />
 <span className="min-w-0">
 <span className={active ? "block truncate text-sm font-semibold text-foreground" : "block truncate text-sm font-medium text-muted-foreground"}>
 {item.name}
 </span>
 <span className="mt-0.5 block font-mono text-[11px] uppercase text-muted-foreground">
 {item.items.length.toString().padStart(2, "0")} symbols
 </span>
 </span>
 <span className="font-mono text-[10px] uppercase text-muted-foreground">{formatDate(item.updated_at).split(",")[0]}</span>
 </button>
 );
 })}
 {!watchlists.length ? <div className="border-l-2 border-primary px-3 py-4 text-sm text-muted-foreground">No watchlists yet.</div> : null}
 </nav>
 </aside>

 <main className="min-w-0 flex-1">
 {selected ? (
 <>
 <div className="mb-7 flex flex-col gap-4 pb-5 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
 <div className="min-w-0 flex-1">
 {editingName ? (
 <div className="flex max-w-2xl items-end gap-3">
 <Input className={`${inputBase} h-11 text-2xl font-semibold`} maxLength={128} onChange={(event) => setDraftName(event.target.value)} value={draftName} />
 <button aria-label="Save watchlist name" className="flex size-9 items-center justify-center text-primary transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)] disabled:opacity-40" disabled={isPending || !draftName.trim()} onClick={saveName} type="button">
 <Check className="size-4" />
 </button>
 <button
 aria-label="Cancel rename"
 className="flex size-9 items-center justify-center text-muted-foreground transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)] disabled:opacity-40"
 disabled={isPending}
 onClick={() => {
 setDraftName(selected.name);
 setEditingName(false);
 }}
 type="button"
 >
 <X className="size-4" />
 </button>
 </div>
 ) : (
 <>
 <div className="flex items-center gap-3">
 <h2 className="truncate text-2xl font-semibold text-foreground min-[760px]:text-4xl">{selected.name}</h2>
 {selected.kind === "preset" ? <span className="border border-primary/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Preset</span> : null}
 </div>
 <div className="mt-2 font-mono text-xs uppercase text-muted-foreground">
 {selected.items.length} symbols / updated {formatDate(selected.updated_at)}
 </div>
 {selected.kind === "preset" ? (
 <div className="mt-2 text-xs text-muted-foreground">
 System-managed Nifty index constituents. This watchlist is read-only and refreshes daily in the background.
 </div>
 ) : null}
 </>
 )}
 </div>
 <div className="flex items-center gap-2">
 {selected.kind === "preset" ? (
 <button
 aria-label="Refresh preset watchlist"
 className="flex size-9 items-center justify-center text-muted-foreground transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)] hover:text-primary disabled:opacity-40"
 disabled={isPending}
 onClick={refreshSelectedPreset}
 type="button"
 >
 <RefreshCw className="size-4" />
 </button>
 ) : null}
 {canEditSelected ? (
 <button
 aria-label="Rename watchlist"
 className="flex size-9 items-center justify-center text-muted-foreground transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)] hover:text-primary disabled:opacity-40"
 disabled={isPending}
 onClick={() => {
 setDraftName(selected.name);
 setEditingName(true);
 }}
 type="button"
 >
 <Pencil className="size-4" />
 </button>
 ) : null}
 {confirmDelete ? (
 <>
 <button className="border-b border-destructive pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-destructive disabled:opacity-40" disabled={isPending} onClick={removeWatchlist} type="button">
 Confirm
 </button>
 <button className="border-b border-border pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground disabled:opacity-40" disabled={isPending} onClick={() => setConfirmDelete(false)} type="button">
 Cancel
 </button>
 </>
 ) : (
 <button aria-label="Delete watchlist" className="flex size-9 items-center justify-center text-muted-foreground transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)] hover:text-destructive disabled:opacity-40" disabled={isPending} onClick={() => setConfirmDelete(true)} type="button">
 <Trash2 className="size-4" />
 </button>
 )}
 </div>
 </div>

 {canEditSelected ? (
 <div className="mb-7">
 <div className="mb-3 flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-end">
 <div className="min-w-0 flex-1">
 <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Add Symbol</label>
 <div className="relative" ref={searchWrapRef}>
 <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-primary" />
 <Input
 className={`${inputBase} h-11 pl-7 pr-9 font-mono text-sm uppercase`}
 aria-activedescendant={activeSuggestionIndex >= 0 ? `watchlist-symbol-suggestion-${activeSuggestionIndex}` : undefined}
 aria-autocomplete="list"
 aria-expanded={showSuggestions && symbolSearch.trim() ? "true" : "false"}
 aria-controls="watchlist-symbol-suggestions"
 onChange={(event) => setSymbolSearch(event.target.value.toUpperCase())}
 onFocus={() => {
 if (suggestions.length) setShowSuggestions(true);
 }}
 onKeyDown={handleSearchKeyDown}
 placeholder="SEARCH SYMBOL, TRADING SYMBOL, COMPANY"
 role="combobox"
 value={symbolSearch}
 />
 {searchLoading ? <Loader2 className="absolute right-0 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
 {showSuggestions && symbolSearch.trim() ? (
 <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto border border-border bg-popover" id="watchlist-symbol-suggestions" role="listbox">
 {suggestions.map((row, index) => {
 const metadata = suggestionMetadata[row.symbol.trim().toUpperCase()];
 return (
 <button
 aria-selected={index === activeSuggestionIndex}
 className={[
 "flex w-full items-center justify-between gap-4 border-b border-l-2 border-border px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)]",
 index === activeSuggestionIndex ? "border-l-primary bg-[var(--accent-glow)] text-foreground" : "border-l-transparent text-foreground"
 ].join(" ")}
 disabled={isPending}
 id={`watchlist-symbol-suggestion-${index}`}
 key={[row.symbol, row.exchange, row.trading_symbol, row.expiry].join(":")}
 onClick={() => addSearchedSymbol(row)}
 onMouseEnter={() => setActiveSuggestionIndex(index)}
 role="option"
 type="button"
 >
 <span className="flex min-w-0 items-center gap-3">
 {metadata?.logo ? (
 <img alt="" className="size-8 shrink-0 rounded border border-border bg-background object-contain" src={metadata.logo} />
 ) : (
 <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-background font-mono text-[10px] font-semibold text-muted-foreground">
 {row.symbol.slice(0, 2)}
 </span>
 )}
 <span className="min-w-0">
 <span className="block font-mono text-sm font-semibold">{row.symbol}</span>
 <span className="block truncate text-xs text-muted-foreground">{[metadata?.company_name ?? row.name, row.trading_symbol, row.account_label].filter(Boolean).join(" / ")}</span>
 </span>
 </span>
 <span className="shrink-0 font-mono text-xs uppercase text-primary">{[row.exchange, row.instrument_type].filter(Boolean).join(" / ")}</span>
 </button>
 );
 })}
 {!suggestions.length && !searchLoading ? <div className="px-3 py-3 text-sm text-muted-foreground">No matching instruments found.</div> : null}
 </div>
 ) : null}
 </div>
 </div>
 <div className="w-full min-[760px]:w-32">
 <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Exchange</label>
 <Input className={`${inputBase} h-11 font-mono text-sm uppercase`} onChange={(event) => setExchange(event.target.value.toUpperCase())} placeholder="NSE" value={exchange} />
 </div>
 <div className="w-full min-[760px]:w-auto">
 <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">CSV</label>
 <button
 className="inline-flex h-11 items-center gap-2 border-b border-border pb-1 font-mono text-xs uppercase text-muted-foreground transition-opacity duration-100 ease-out hover:opacity-70 disabled:opacity-30"
 disabled={isPending}
 onClick={() => addCsvInputRef.current?.click()}
 type="button"
 >
 <Upload className="size-4" />
 Import CSV
 </button>
 <input accept=".csv,text/csv" className="hidden" onChange={(event) => importSymbolsIntoSelected(event.target.files?.[0] ?? null)} ref={addCsvInputRef} type="file" />
 </div>
 </div>
 </div>
 ) : null}

 <div className="overflow-x-auto">
 <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
 <thead>
 <tr className="border-y border-border text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
 <th className="py-2 pr-4 font-semibold">Ticker</th>
 <th className="px-4 py-2 font-semibold">Company</th>
 <th className="px-4 py-2 font-semibold">Exchange</th>
 <th className="px-4 py-2 font-semibold">Sector</th>
 <th className="px-4 py-2 text-right font-semibold">Market cap</th>
 <th className="px-4 py-2 text-right font-semibold">Order</th>
 <th className="px-4 py-2 font-semibold">Added</th>
 <th className="w-20 py-2 pl-4 text-right font-semibold">Actions</th>
 </tr>
 </thead>
 <tbody>
 {selected.items.map((item, index) => {
 const metadata = watchlistMetadata[item.symbol.trim().toUpperCase()];
 return (
 <tr className="watchlist-data-row group border-b border-border text-foreground odd:bg-muted/40 hover:bg-[var(--bg-hover)]" key={item.id} style={{ animationDelay: `${Math.min(index * 18, 120)}ms` }}>
 <td className="py-3 pr-4">
 <div className="flex items-center gap-3">
 {metadata?.logo ? (
 <img alt="" className="size-8 shrink-0 rounded border border-border bg-background object-contain" src={metadata.logo} />
 ) : (
 <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-background font-mono text-[10px] font-semibold text-muted-foreground">
 {item.symbol.slice(0, 2)}
 </span>
 )}
 <div className="min-w-0">
 <div className="font-mono text-[15px] font-semibold text-foreground">{item.symbol}</div>
 {metadata?.scrip_code ? <div className="font-mono text-[10px] uppercase text-muted-foreground">BSE {metadata.scrip_code}</div> : null}
 </div>
 </div>
 </td>
 <td className="max-w-[260px] px-4 py-3">
 <div className="truncate text-sm font-medium text-foreground">{metadata?.company_name ?? "-"}</div>
 <div className="truncate text-xs text-muted-foreground">{metadata?.basic_industry ?? metadata?.theme ?? ""}</div>
 </td>
 <td className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground">{item.exchange ?? "-"}</td>
 <td className="max-w-[220px] px-4 py-3">
 <div className="truncate text-xs font-medium text-foreground">{metadata?.sector ?? "-"}</div>
 <div className="truncate text-xs text-muted-foreground">{metadata?.industry ?? metadata?.macro_economic_indicator ?? ""}</div>
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{formatMarketCap(metadata?.market_cap ?? null)}</td>
 <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{item.sort_order + 1}</td>
 <td className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground">{formatDate(item.created_at)}</td>
 <td className="w-20 py-3 pl-4 text-right">
 {canEditSelected ? (
 <button aria-label={`Remove ${item.symbol}`} className="inline-flex size-8 items-center justify-center text-muted-foreground opacity-0 transition-all duration-100 ease-out hover:bg-[var(--accent-glow)] hover:text-destructive focus:opacity-100 group-hover:opacity-100 disabled:opacity-30" disabled={isPending} onClick={() => removeSymbol(item.symbol, item.exchange)} type="button">
 <Trash2 className="size-4" />
 </button>
 ) : null}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 {!selected.items.length ? <div className="border-b border-border py-10 text-center text-sm text-muted-foreground">Search above to add the first symbol.</div> : null}
 </div>
 </>
 ) : (
 <div className="border-l-2 border-primary px-5 py-12">
 <div className="text-2xl font-semibold text-foreground">Create your first watchlist</div>
 <p className="mt-3 max-w-xl text-sm text-muted-foreground">Use the plus button in the sidebar to name a list, then search the instrument cache to add symbols.</p>
 </div>
 )}
 </main>
 </div>
 </div>
 </section>
 );
}
