"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { addLiveSubscription, deleteLiveSubscriptions } from "@/service/actions/alerts";
import { searchBrokerInstruments } from "@/service/actions/broker";
import type { InstrumentRef, LiveSubscription } from "@/service/types/alerts";
import type { BrokerAccount, InstrumentSearchRow } from "@/service/types/broker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export function SubscriptionsManager({
 accounts,
 initialSubscriptions
}: {
 accounts: BrokerAccount[];
 initialSubscriptions: LiveSubscription[];
}) {
 const [items, setItems] = useState(initialSubscriptions);
 const [selectedIds, setSelectedIds] = useState<string[]>([]);
 const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
 const [symbolSearch, setSymbolSearch] = useState("");
 const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
 const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
 const [searchLoading, setSearchLoading] = useState(false);
 const [showSuggestions, setShowSuggestions] = useState(false);
 const [exchange, setExchange] = useState("NSE");
 const [error, setError] = useState("");
 const [isPending, startTransition] = useTransition();
 const searchWrapRef = useRef<HTMLDivElement | null>(null);

 const selectedAccount = accounts.find((item) => item.id === accountId);

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
 if (!query || !selectedAccount) {
 setSuggestions([]);
 setActiveSuggestionIndex(-1);
 setSearchLoading(false);
 return;
 }
 const handle = window.setTimeout(() => {
 setSearchLoading(true);
 startTransition(async () => {
 try {
 const result = await searchBrokerInstruments(selectedAccount.id, {
 q: query,
 exchange: exchange.trim() || undefined,
 limit: 20
 });
 setSuggestions(result);
 setActiveSuggestionIndex(result.length ? 0 : -1);
 setShowSuggestions(true);
 } catch {
 setSuggestions([]);
 setActiveSuggestionIndex(-1);
 } finally {
 setSearchLoading(false);
 }
 });
 }, 250);
 return () => window.clearTimeout(handle);
 }, [exchange, selectedAccount, startTransition, symbolSearch]);

 function addSearchedSymbol(row: InstrumentSearchRow) {
 if (!selectedAccount) return;
 const selectedExchange = row.exchange ?? (exchange.trim().toUpperCase() || null);
 setError("");
 startTransition(async () => {
 try {
 const next = await addLiveSubscription({
 account_id: selectedAccount.id,
 broker_code: selectedAccount.broker_code,
 symbol: row.symbol,
 exchange: selectedExchange,
 instrument_ref: { ...instrumentFromSearch(row) },
 source_kind: "manual"
 });
 setItems((current) => {
 const existing = new Map(current.map((item) => [item.id, item]));
 existing.set(next.id, next);
 return Array.from(existing.values()).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
 });
 setSymbolSearch("");
 setSuggestions([]);
 setActiveSuggestionIndex(-1);
 setShowSuggestions(false);
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not add subscription.");
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
 setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
 return;
 }
 if (event.key === "Enter") {
 event.preventDefault();
 const row = suggestions[Math.max(activeSuggestionIndex, 0)];
 if (row) addSearchedSymbol(row);
 }
 }

 function removeSelected() {
 if (!selectedIds.length) return;
 setError("");
 startTransition(async () => {
 try {
 await deleteLiveSubscriptions(selectedIds);
 setItems((current) => current.filter((item) => !selectedIds.includes(item.id)));
 setSelectedIds([]);
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not remove subscriptions.");
 }
 });
 }

 function toggleSelected(id: string, checked: boolean) {
 setSelectedIds((current) => {
 if (checked) return Array.from(new Set([...current, id]));
 return current.filter((item) => item !== id);
 });
 }

 return (
 <div className="grid gap-6">
 {error ? <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div> : null}
 <div className=" border border-border p-4">
 <div className="mb-3 flex items-center justify-between gap-3">
 <div>
 <div className="text-sm font-bold">Add subscribed symbols</div>
 <div className="text-xs text-muted-foreground">Search the selected broker instrument cache and pick a symbol to subscribe.</div>
 </div>
 <Button disabled={isPending || !selectedIds.length} onClick={removeSelected} type="button" variant="outline">
 Remove selected
 </Button>
 </div>
 <div className="grid gap-3 min-[960px]:grid-cols-[1fr_1.4fr_160px]">
 <select
 className={`${inputBase} h-11 text-sm`}
 onChange={(event) => {
 setAccountId(event.target.value);
 setSymbolSearch("");
 setSuggestions([]);
 setActiveSuggestionIndex(-1);
 }}
 value={accountId}
 >
 {accounts.map((account) => (
 <option key={account.id} value={account.id}>
 {account.label} · {account.broker_code}
 </option>
 ))}
 </select>
 <div className="relative" ref={searchWrapRef}>
 <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-primary" />
 <Input
 className={`${inputBase} h-11 pl-7 pr-9 font-mono text-sm uppercase`}
 aria-activedescendant={activeSuggestionIndex >= 0 ? `subscription-symbol-suggestion-${activeSuggestionIndex}` : undefined}
 aria-autocomplete="list"
 aria-expanded={showSuggestions && symbolSearch.trim() ? "true" : "false"}
 aria-controls="subscription-symbol-suggestions"
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
 <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto border border-border bg-popover" id="subscription-symbol-suggestions" role="listbox">
 {suggestions.map((row, index) => (
 <button
 aria-selected={index === activeSuggestionIndex}
 className={[
 "flex w-full items-center justify-between gap-4 border-b border-l-2 border-border px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)]",
 index === activeSuggestionIndex ? "border-l-primary bg-[var(--accent-glow)] text-foreground" : "border-l-transparent text-foreground"
 ].join(" ")}
 disabled={isPending}
 id={`subscription-symbol-suggestion-${index}`}
 key={[row.symbol, row.exchange, row.trading_symbol, row.expiry].join(":")}
 onClick={() => addSearchedSymbol(row)}
 onMouseEnter={() => setActiveSuggestionIndex(index)}
 role="option"
 type="button"
 >
 <span className="min-w-0">
 <span className="block font-mono text-sm font-semibold">{row.symbol}</span>
 <span className="block truncate text-xs text-muted-foreground">{[row.name, row.trading_symbol, row.account_label].filter(Boolean).join(" / ")}</span>
 </span>
 <span className="shrink-0 font-mono text-xs uppercase text-primary">{[row.exchange, row.instrument_type].filter(Boolean).join(" / ")}</span>
 </button>
 ))}
 {!suggestions.length && !searchLoading ? <div className="px-3 py-3 text-sm text-muted-foreground">No matching instruments found.</div> : null}
 </div>
 ) : null}
 </div>
 <Input className={`${inputBase} h-11 font-mono text-sm uppercase`} onChange={(event) => setExchange(event.target.value.toUpperCase())} placeholder="NSE" value={exchange} />
 </div>
 {!accounts.length ? <div className="mt-3 text-xs text-muted-foreground">Connect a broker account before adding subscriptions.</div> : null}
 </div>
 <div className="grid gap-3">
 {items.map((item) => (
 <label className="flex cursor-pointer flex-wrap items-center justify-between gap-3 border border-border p-4" key={item.id}>
 <div className="flex items-start gap-3">
 <input
 checked={selectedIds.includes(item.id)}
 onChange={(event) => toggleSelected(item.id, event.target.checked)}
 type="checkbox"
 />
 <div>
 <div className="text-sm font-bold">{item.symbol}</div>
 <div className="text-xs text-muted-foreground">
 {item.exchange ?? "-"} · {item.broker_code ?? "-"} · {item.source_kind}
 </div>
 </div>
 </div>
 <div className="text-xs text-muted-foreground">
 {item.last_received_at ? `Last tick ${new Date(item.last_received_at).toLocaleTimeString()}` : "Awaiting tick"}
 </div>
 </label>
 ))}
 {!items.length ? <div className="text-sm text-muted-foreground">No subscribed symbols yet.</div> : null}
 </div>
 </div>
 );
}
