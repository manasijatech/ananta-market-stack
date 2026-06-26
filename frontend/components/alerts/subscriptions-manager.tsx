"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, Inbox, ListChecks, Loader2, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { addLiveSubscription, deleteLiveSubscriptions } from "@/service/actions/alerts";
import {
    refreshAlphaWebSocketAccount,
    searchBrokerInstruments,
    updateAlphaWebSocketConfig
} from "@/service/actions/broker";
import type { InstrumentRef, LiveSubscription } from "@/service/types/alerts";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { AlphaWebSocketConfig, BrokerAccount, InstrumentSearchRow } from "@/service/types/broker";
import type { Watchlist } from "@/service/types/watchlist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { INDIA_TIME_ZONE, formatIstDateTime, parseApiDate } from "@/lib/datetime";

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

export function SubscriptionsManager({
    alphaWebSocketConfig,
    accounts,
    initialSubscriptions,
    symbolMetadata,
    watchlists
}: {
    alphaWebSocketConfig: AlphaWebSocketConfig;
    accounts: BrokerAccount[];
    initialSubscriptions: LiveSubscription[];
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
    watchlists: Watchlist[];
}) {
    const [items, setItems] = useState(initialSubscriptions);
    const [alphaWsConfig, setAlphaWsConfig] = useState(alphaWebSocketConfig);
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
    const enabledAddons = alphaWsConfig.entitled_addons.filter((item) => item.enabled);
    const fullMarketProducts = alphaWsConfig.full_market_products.length
        ? alphaWsConfig.full_market_products
        : enabledAddons.filter((item) => item.tier === "full_market").map((item) => item.product);
    const activeLiveSymbols = alphaWsConfig.effective_symbol_count ?? alphaWsConfig.effective_symbols.length;
    const liveSymbolLimit = alphaWsConfig.live_symbol_limit;

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

    function toggleAlphaProduct(product: string, checked: boolean) {
        setAlphaWsConfig((current) => ({
            ...current,
            products: checked
                ? Array.from(new Set([...current.products, product]))
                : current.products.filter((item) => item !== product)
        }));
    }

    function toggleWatchlist(id: string, checked: boolean) {
        setAlphaWsConfig((current) => ({
            ...current,
            watchlist_ids: checked
                ? Array.from(new Set([...current.watchlist_ids, id]))
                : current.watchlist_ids.filter((item) => item !== id)
        }));
    }

    function saveAlphaWebSocketConfig() {
        setError("");
        const nextSymbolCount = estimateConfiguredAlphaSymbolCount();
        if (
            alphaWsConfig.scope_mode !== "full_market" &&
            typeof liveSymbolLimit === "number" &&
            liveSymbolLimit >= 0 &&
            nextSymbolCount > liveSymbolLimit
        ) {
            setError(
                `This Ananta plan allows ${liveSymbolLimit} live symbols. Your selected scope currently resolves to about ${nextSymbolCount}.`
            );
            return;
        }
        startTransition(async () => {
            try {
                const next = await updateAlphaWebSocketConfig({
                    is_enabled: alphaWsConfig.is_enabled,
                    products: alphaWsConfig.products,
                    scope_mode: alphaWsConfig.scope_mode,
                    watchlist_ids: alphaWsConfig.watchlist_ids,
                    include_all_watchlists: alphaWsConfig.include_all_watchlists,
                    full_market: alphaWsConfig.full_market
                });
                setAlphaWsConfig(next);
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not save Alpha websocket config.");
            }
        });
    }

    function refreshAlphaEntitlements() {
        setError("");
        startTransition(async () => {
            try {
                const next = await refreshAlphaWebSocketAccount();
                setAlphaWsConfig(next);
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not refresh Alpha account plan.");
            }
        });
    }

    function estimateConfiguredAlphaSymbolCount() {
        const symbols = new Set<string>();
        if (
            alphaWsConfig.scope_mode === "alert_subscriptions" ||
            alphaWsConfig.scope_mode === "alerts_and_watchlists"
        ) {
            for (const item of items) {
                if (item.status === "active" && item.symbol) symbols.add(item.symbol.toUpperCase());
            }
        }
        if (alphaWsConfig.scope_mode === "alerts_and_watchlists") {
            for (const watchlist of watchlists) {
                if (!alphaWsConfig.include_all_watchlists && !alphaWsConfig.watchlist_ids.includes(watchlist.id))
                    continue;
                const rows = watchlist.symbols.length ? watchlist.symbols : watchlist.items.map((item) => item.symbol);
                for (const symbol of rows) {
                    if (symbol) symbols.add(symbol.toUpperCase());
                }
            }
        }
        return symbols.size;
    }

    const scopeSummary =
        alphaWsConfig.scope_mode === "full_market"
            ? "Full market"
            : alphaWsConfig.scope_mode === "alerts_and_watchlists"
              ? "Alert subscriptions + watchlists"
              : "Alert subscriptions only";

    return (
        <div className="grid w-full gap-4">
            {error ? (
                <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">
                    {error}
                </div>
            ) : null}
            <Collapsible className="border border-border p-3" defaultOpen={false}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-base font-semibold leading-5 text-foreground">
                            Ananta websocket subscriptions
                        </div>
                        <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
                            Backend worker status: {alphaWsConfig.status}
                            {alphaWsConfig.last_event_at
                                ? ` · last event ${formatIstDateTime(alphaWsConfig.last_event_at)}`
                                : ""}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                            Ananta plan: {alphaWsConfig.plan_name ?? alphaWsConfig.plan_id ?? "Unknown"} ·{" "}
                            {alphaWsConfig.scope_mode === "full_market"
                                ? "full market"
                                : `${activeLiveSymbols}${typeof liveSymbolLimit === "number" ? ` / ${liveSymbolLimit}` : ""} live symbols`}
                            {typeof alphaWsConfig.monthly_unique_symbol_limit === "number"
                                ? ` · ${alphaWsConfig.monthly_unique_symbol_limit} unique/month`
                                : ""}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                            Scope: {scopeSummary} · {alphaWsConfig.effective_products.length} products
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button disabled={isPending} onClick={refreshAlphaEntitlements} type="button" variant="outline">
                            <RefreshCw className="mr-2 size-4" />
                            Refresh plan
                        </Button>
                        <CollapsibleTrigger className="group inline-flex h-9 items-center gap-2 border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-[var(--accent-glow)]">
                            <SlidersHorizontal className="size-4" />
                            Configure feed
                            <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
                        </CollapsibleTrigger>
                    </div>
                </div>
                {alphaWsConfig.last_error ? (
                    <div className="mt-3 border-l-2 border-destructive px-3 py-2 text-sm text-destructive">
                        {alphaWsConfig.last_error}
                    </div>
                ) : null}
                <CollapsibleContent>
                    <div className="@container mt-4 border-t border-border pt-4">
                        <div className="grid gap-6 @lg:grid-cols-2 @3xl:grid-cols-3">
                            <div>
                                <div className="type-step-eyebrow">Products from account</div>
                                <div className="mt-3 grid gap-2">
                                    {enabledAddons.map((addon) => (
                                        <Label className="flex items-center gap-2 text-sm" key={addon.product}>
                                            <Checkbox
                                                checked={alphaWsConfig.products.includes(addon.product)}
                                                onCheckedChange={(checked) =>
                                                    toggleAlphaProduct(addon.product, Boolean(checked))
                                                }
                                            />
                                            <span>
                                                {addon.product} · {addon.tier ?? "tier unknown"}
                                            </span>
                                        </Label>
                                    ))}
                                    {!enabledAddons.length ? (
                                        <div className="type-body text-muted-foreground">
                                            No websocket addons were found for the saved key.
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            <div>
                                <div className="type-step-eyebrow">Symbol scope</div>
                                <div className="mt-3 grid gap-2 text-sm">
                                    <Label className="flex items-start gap-2">
                                        <input
                                            checked={alphaWsConfig.scope_mode === "alert_subscriptions"}
                                            className="mt-1 accent-[var(--primary)]"
                                            name="alpha-symbol-scope"
                                            onChange={() =>
                                                setAlphaWsConfig((current) => ({
                                                    ...current,
                                                    scope_mode: "alert_subscriptions",
                                                    full_market: false
                                                }))
                                            }
                                            type="radio"
                                        />
                                        <span>
                                            <span className="block font-semibold text-foreground">
                                                Alert subscriptions only
                                            </span>
                                            <span className="block text-[12px] leading-5 text-muted-foreground">
                                                Use only symbols added on this page.
                                            </span>
                                        </span>
                                    </Label>
                                    <Label className="flex items-start gap-2">
                                        <input
                                            checked={alphaWsConfig.scope_mode === "alerts_and_watchlists"}
                                            className="mt-1 accent-[var(--primary)]"
                                            name="alpha-symbol-scope"
                                            onChange={() =>
                                                setAlphaWsConfig((current) => ({
                                                    ...current,
                                                    scope_mode: "alerts_and_watchlists",
                                                    full_market: false
                                                }))
                                            }
                                            type="radio"
                                        />
                                        <span>
                                            <span className="block font-semibold text-foreground">
                                                Alert subscriptions + watchlists
                                            </span>
                                            <span className="block text-[12px] leading-5 text-muted-foreground">
                                                Include selected watchlists below with alert subscriptions.
                                            </span>
                                        </span>
                                    </Label>
                                    <Label
                                        className={`flex items-start gap-2 ${alphaWsConfig.full_market_allowed ? "" : "opacity-50"}`}
                                    >
                                        <input
                                            checked={alphaWsConfig.scope_mode === "full_market"}
                                            className="mt-1 accent-[var(--primary)]"
                                            disabled={!alphaWsConfig.full_market_allowed}
                                            name="alpha-symbol-scope"
                                            onChange={() =>
                                                setAlphaWsConfig((current) => ({
                                                    ...current,
                                                    scope_mode: "full_market",
                                                    full_market: true
                                                }))
                                            }
                                            type="radio"
                                        />
                                        <span>
                                            <span className="block font-semibold text-foreground">Full market</span>
                                            <span className="block text-[12px] leading-5 text-muted-foreground">
                                                Use full-market products when your plan allows it.
                                            </span>
                                        </span>
                                    </Label>
                                </div>
                                <div className="mt-3 text-xs text-muted-foreground">
                                    Effective: {alphaWsConfig.effective_products.length} products /{" "}
                                    {alphaWsConfig.scope_mode === "full_market"
                                        ? "full-feed"
                                        : `${activeLiveSymbols} symbols`}
                                </div>
                                {fullMarketProducts.length ? (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        Full-market products: {fullMarketProducts.join(", ")}
                                    </div>
                                ) : null}
                            </div>
                            <div>
                                <div className="type-step-eyebrow">Watchlists</div>
                                <Label className="mt-3 flex items-center gap-2 text-sm">
                                    <Checkbox
                                        checked={alphaWsConfig.include_all_watchlists}
                                        disabled={alphaWsConfig.scope_mode !== "alerts_and_watchlists"}
                                        onCheckedChange={(checked) =>
                                            setAlphaWsConfig((current) => ({
                                                ...current,
                                                include_all_watchlists: Boolean(checked)
                                            }))
                                        }
                                    />
                                    All watchlists
                                </Label>
                                <div className="mt-2 grid max-h-64 gap-2 overflow-auto">
                                    {watchlists.map((watchlist) => (
                                        <Label className="flex items-center gap-2 text-sm" key={watchlist.id}>
                                            <Checkbox
                                                checked={alphaWsConfig.watchlist_ids.includes(watchlist.id)}
                                                disabled={
                                                    alphaWsConfig.scope_mode !== "alerts_and_watchlists" ||
                                                    alphaWsConfig.include_all_watchlists
                                                }
                                                onCheckedChange={(checked) =>
                                                    toggleWatchlist(watchlist.id, Boolean(checked))
                                                }
                                            />
                                            <span>
                                                {watchlist.name} · {watchlist.items.length || watchlist.symbols.length}
                                            </span>
                                        </Label>
                                    ))}
                                    {!watchlists.length ? (
                                        <Empty className="py-8">
                                            <EmptyHeader>
                                                <EmptyMedia variant="icon">
                                                    <ListChecks />
                                                </EmptyMedia>
                                                <EmptyTitle>No watchlists available</EmptyTitle>
                                                <EmptyDescription>
                                                    Create a watchlist to include its symbols in the live scope.
                                                </EmptyDescription>
                                            </EmptyHeader>
                                        </Empty>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <div className="mt-5 border-t border-border pt-3">
                            <Button disabled={isPending} onClick={saveAlphaWebSocketConfig} type="button">
                                Save websocket config
                            </Button>
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>
            <div className=" border border-border p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <div className="text-base font-semibold leading-5 text-foreground">Add subscribed symbols</div>
                        <div className="text-[13px] leading-5 text-muted-foreground">
                            Search the selected broker instrument cache and pick a symbol to subscribe.
                        </div>
                    </div>
                    <Button
                        disabled={isPending || !selectedIds.length}
                        onClick={removeSelected}
                        type="button"
                        variant="outline"
                    >
                        Remove selected
                    </Button>
                </div>
                <div className="grid gap-3 min-[760px]:grid-cols-[240px_minmax(0,1fr)_96px]">
                    <SimpleSelect
                        className={`${inputBase} h-9 text-sm`}
                        onValueChange={(nextAccountId) => {
                            setAccountId(nextAccountId);
                            setSymbolSearch("");
                            setSuggestions([]);
                            setActiveSuggestionIndex(-1);
                        }}
                        options={accounts.map((account) => ({
                            value: account.id,
                            label: `${account.label} · ${account.broker_code}`
                        }))}
                        value={accountId}
                    />
                    <div className="relative" ref={searchWrapRef}>
                        <Search className="pointer-events-none absolute left-0 top-1/2 size-4 -translate-y-1/2 text-primary" />
                        <Input
                            className={`${inputBase} h-9 pl-7 pr-9 font-mono text-sm uppercase`}
                            aria-activedescendant={
                                activeSuggestionIndex >= 0
                                    ? `subscription-symbol-suggestion-${activeSuggestionIndex}`
                                    : undefined
                            }
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
                        {searchLoading ? (
                            <Loader2 className="absolute right-0 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                        ) : null}
                        {showSuggestions && symbolSearch.trim() ? (
                            <div
                                className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover"
                                id="subscription-symbol-suggestions"
                                role="listbox"
                            >
                                {suggestions.map((row, index) => (
                                    <Button
                                        aria-selected={index === activeSuggestionIndex}
                                        className={[
                                            "h-auto w-full justify-between gap-4 rounded-none border-b border-l-2 border-border px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-[var(--accent-glow)]",
                                            index === activeSuggestionIndex
                                                ? "border-l-primary bg-[var(--accent-glow)] text-foreground"
                                                : "border-l-transparent text-foreground"
                                        ].join(" ")}
                                        disabled={isPending}
                                        id={`subscription-symbol-suggestion-${index}`}
                                        key={[row.symbol, row.exchange, row.trading_symbol, row.expiry].join(":")}
                                        onClick={() => addSearchedSymbol(row)}
                                        onMouseEnter={() => setActiveSuggestionIndex(index)}
                                        role="option"
                                        variant="ghost"
                                        type="button"
                                    >
                                        <span className="min-w-0">
                                            <span className="block font-mono text-sm font-semibold">{row.symbol}</span>
                                            <span className="type-meta block truncate">
                                                {[row.name, row.trading_symbol, row.account_label]
                                                    .filter(Boolean)
                                                    .join(" / ")}
                                            </span>
                                        </span>
                                        <span className="type-meta shrink-0 font-mono uppercase text-primary">
                                            {[row.exchange, row.instrument_type].filter(Boolean).join(" / ")}
                                        </span>
                                    </Button>
                                ))}
                                {!suggestions.length && !searchLoading ? (
                                    <div className="type-body px-3 py-3 text-muted-foreground">
                                        No matching instruments found.
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    <Input
                        className={`${inputBase} h-9 font-mono text-sm uppercase`}
                        onChange={(event) => setExchange(event.target.value.toUpperCase())}
                        placeholder="NSE"
                        value={exchange}
                    />
                </div>
                {!accounts.length ? (
                    <div className="type-help mt-3 text-muted-foreground">
                        Connect a broker account before adding subscriptions.
                    </div>
                ) : null}
            </div>
            <div className="@container">
                <div className="grid gap-2 @2xl:grid-cols-2">
                {items.map((item) => {
                    const metadata = symbolMetadata[item.symbol.toUpperCase()];
                    const companyName = metadata?.company_name?.trim();
                    return (
                        <Label
                            className="flex cursor-pointer flex-wrap items-center justify-between gap-3 border border-border px-3 py-2.5"
                            key={item.id}
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                <Checkbox
                                    checked={selectedIds.includes(item.id)}
                                    onCheckedChange={(checked) => toggleSelected(item.id, Boolean(checked))}
                                />
                                <SymbolLogo metadata={metadata} symbol={item.symbol} />
                                <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                                        <div className="font-mono text-base font-bold leading-5 text-foreground">
                                            {item.symbol}
                                        </div>
                                        {companyName ? (
                                            <div className="truncate text-sm font-semibold text-muted-foreground">
                                                {companyName}
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="text-[12px] leading-5 text-muted-foreground">
                                        {[
                                            item.exchange ?? "-",
                                            item.broker_code ?? "-",
                                            item.source_kind,
                                            metadata?.sector,
                                            metadata?.industry
                                        ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                    </div>
                                </div>
                            </div>
                            <div className="text-[12px] leading-5 text-muted-foreground">
                                {item.last_received_at
                                    ? `Last tick ${parseApiDate(item.last_received_at).toLocaleTimeString("en-IN", {
                                          timeZone: INDIA_TIME_ZONE
                                      })}`
                                    : "Awaiting tick"}
                            </div>
                        </Label>
                    );
                })}
                {!items.length ? (
                    <Empty className="py-10 @2xl:col-span-2">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <Inbox />
                            </EmptyMedia>
                            <EmptyTitle>No subscribed symbols yet</EmptyTitle>
                            <EmptyDescription>
                                Search a broker instrument above to subscribe a symbol to live data.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : null}
                </div>
            </div>
        </div>
    );
}

function SymbolLogo({ metadata, symbol }: { metadata?: AlphaSymbolMetadata; symbol: string }) {
    if (metadata?.logo) {
        return <img alt="" className="size-9 shrink-0 object-contain" src={metadata.logo} />;
    }
    return (
        <span className="flex size-9 shrink-0 items-center justify-center font-mono text-[11px] font-semibold text-muted-foreground">
            {symbol.slice(0, 2)}
        </span>
    );
}
