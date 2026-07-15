"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Inbox, ListChecks, Loader2, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardPanel
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SimpleSelect } from "@/components/ui/simple-select";
import { INDIA_TIME_ZONE, formatIstDateTime, parseApiDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

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

const symbolPickerControlClassName =
    "h-10 rounded-lg border border-input bg-background/80 px-3 text-sm shadow-xs/5 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/24";
const exchangeOptions = [
    { value: "NSE", label: "NSE" },
    { value: "BSE", label: "BSE" }
];

type FeedConfigCategory = "products" | "scope" | "watchlists";

const feedConfigCategories: {
    key: FeedConfigCategory;
    label: string;
    description: string;
}[] = [
    {
        key: "products",
        label: "Products",
        description: "Choose websocket products from your account."
    },
    {
        key: "scope",
        label: "Symbol scope",
        description: "Pick how feed symbols are resolved."
    },
    {
        key: "watchlists",
        label: "Watchlists",
        description: "Include saved watchlists in the live scope."
    }
];

function scopeModeLabel(scopeMode: AlphaWebSocketConfig["scope_mode"]): string {
    if (scopeMode === "full_market") return "Full market";
    if (scopeMode === "alerts_and_watchlists") return "Alert subscriptions + watchlists";
    return "Alert subscriptions only";
}

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
    const [savedAlphaWsConfig, setSavedAlphaWsConfig] = useState(alphaWebSocketConfig);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
    const [symbolSearch, setSymbolSearch] = useState("");
    const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const [searchLoading, setSearchLoading] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [exchange, setExchange] = useState("NSE");
    const [error, setError] = useState("");
    const [feedConfigOpen, setFeedConfigOpen] = useState(false);
    const [activeFeedConfigCategory, setActiveFeedConfigCategory] = useState<FeedConfigCategory>("products");
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
                setSavedAlphaWsConfig(next);
                setFeedConfigOpen(false);
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
                setSavedAlphaWsConfig(next);
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

    const scopeSummary = scopeModeLabel(alphaWsConfig.scope_mode);
    const selectedWatchlists = watchlists.filter((watchlist) => alphaWsConfig.watchlist_ids.includes(watchlist.id));
    const selectedFeedItems =
        alphaWsConfig.products.length +
        1 +
        (alphaWsConfig.scope_mode === "alerts_and_watchlists"
            ? alphaWsConfig.include_all_watchlists
                ? 1
                : selectedWatchlists.length
            : 0);

    function closeFeedConfig() {
        setAlphaWsConfig(savedAlphaWsConfig);
        setFeedConfigOpen(false);
    }

    function handleFeedConfigOpenChange(open: boolean) {
        if (open) {
            setFeedConfigOpen(true);
            return;
        }
        closeFeedConfig();
    }

    function clearFeedConfig() {
        setAlphaWsConfig((current) => ({
            ...current,
            products: [],
            scope_mode: "alert_subscriptions",
            watchlist_ids: [],
            include_all_watchlists: false,
            full_market: false
        }));
    }

    return (
        <div className="grid w-full gap-4">
            {error ? (
                <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">
                    {error}
                </div>
            ) : null}
            <CardFrame>
                <CardFrameHeader>
                    <CardFrameTitle>Ananta websocket subscriptions</CardFrameTitle>
                    <CardFrameDescription>
                        <span className="block">
                            Backend worker status: {alphaWsConfig.status}
                            {alphaWsConfig.last_event_at
                                ? ` · last event ${formatIstDateTime(alphaWsConfig.last_event_at)}`
                                : ""}
                        </span>
                        <span className="mt-1 block text-xs">
                            Ananta plan: {alphaWsConfig.plan_name ?? alphaWsConfig.plan_id ?? "Unknown"} ·{" "}
                            {alphaWsConfig.scope_mode === "full_market"
                                ? "full market"
                                : `${activeLiveSymbols}${typeof liveSymbolLimit === "number" ? ` / ${liveSymbolLimit}` : ""} live symbols`}
                            {typeof alphaWsConfig.monthly_unique_symbol_limit === "number"
                                ? ` · ${alphaWsConfig.monthly_unique_symbol_limit} unique/month`
                                : ""}
                        </span>
                        <span className="mt-1 block text-xs">
                            Scope: {scopeSummary} · {alphaWsConfig.effective_products.length} products
                        </span>
                    </CardFrameDescription>
                    <CardFrameAction className="flex-wrap gap-2">
                        <Button disabled={isPending} onClick={refreshAlphaEntitlements} type="button" variant="outline">
                            <RefreshCw aria-hidden data-icon="inline-start" />
                            Refresh plan
                        </Button>
                        <Popover onOpenChange={handleFeedConfigOpenChange} open={feedConfigOpen}>
                            <PopoverTrigger className={cn(buttonVariants({ variant: "outline" }), "h-9")} type="button">
                                <SlidersHorizontal aria-hidden data-icon="inline-start" />
                                Configure feed
                                {selectedFeedItems ? (
                                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                                        {selectedFeedItems}
                                    </span>
                                ) : null}
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-[min(62rem,calc(100vw-2rem))] p-0">
                                <div className="grid min-h-[28rem] md:grid-cols-[16rem_minmax(20rem,1fr)_18rem]">
                                    <div className="border-b p-4 md:border-e md:border-b-0">
                                        <h2 className="px-2 text-lg font-semibold">Configure feed</h2>
                                        <Separator className="my-4" />
                                        <div className="flex flex-col gap-2">
                                            {feedConfigCategories.map((category) => {
                                                const isActive = activeFeedConfigCategory === category.key;
                                                const hasSelection =
                                                    category.key === "products"
                                                        ? Boolean(alphaWsConfig.products.length)
                                                        : category.key === "scope"
                                                          ? true
                                                          : alphaWsConfig.include_all_watchlists ||
                                                            Boolean(alphaWsConfig.watchlist_ids.length);
                                                return (
                                                    <Button
                                                        className={cn(
                                                            "min-h-16 justify-start gap-4 rounded-md text-left",
                                                            isActive && "bg-accent"
                                                        )}
                                                        key={category.key}
                                                        onClick={() => setActiveFeedConfigCategory(category.key)}
                                                        size="auto"
                                                        type="button"
                                                        variant="ghost"
                                                    >
                                                        <span className="min-w-0 flex-1 pr-1">
                                                            <span className="block truncate leading-5">
                                                                {category.label}
                                                            </span>
                                                            <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">
                                                                {category.description}
                                                            </span>
                                                        </span>
                                                        {hasSelection ? (
                                                            <span className="mr-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                                                        ) : null}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="border-b p-4 md:border-e md:border-b-0">
                                        {activeFeedConfigCategory === "products" ? (
                                            <div className="flex flex-col gap-3">
                                                <div>
                                                    <h3 className="text-sm font-semibold">Products from account</h3>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Select the websocket products this feed should request.
                                                    </p>
                                                </div>
                                                <div className="flex max-h-[21rem] flex-col gap-2 overflow-y-auto pr-1">
                                                    {enabledAddons.map((addon) => {
                                                        const checked = alphaWsConfig.products.includes(addon.product);
                                                        return (
                                                            <Label
                                                                className={cn(
                                                                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent",
                                                                    checked && "border-primary bg-accent"
                                                                )}
                                                                key={addon.product}
                                                            >
                                                                <Checkbox
                                                                    checked={checked}
                                                                    onCheckedChange={(next) =>
                                                                        toggleAlphaProduct(addon.product, Boolean(next))
                                                                    }
                                                                />
                                                                <span className="min-w-0">
                                                                    <span className="block truncate text-sm font-medium">
                                                                        {addon.product}
                                                                    </span>
                                                                    <span className="block truncate text-xs text-muted-foreground">
                                                                        {addon.tier ?? "tier unknown"}
                                                                    </span>
                                                                </span>
                                                            </Label>
                                                        );
                                                    })}
                                                    {!enabledAddons.length ? (
                                                        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                                                            No websocket addons were found for the saved key.
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}

                                        {activeFeedConfigCategory === "scope" ? (
                                            <div className="flex flex-col gap-3">
                                                <div>
                                                    <h3 className="text-sm font-semibold">Symbol scope</h3>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Choose which symbol universe powers the live feed.
                                                    </p>
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    {[
                                                        {
                                                            value: "alert_subscriptions",
                                                            label: "Alert subscriptions only",
                                                            detail: "Use only symbols added on this page.",
                                                            disabled: false
                                                        },
                                                        {
                                                            value: "alerts_and_watchlists",
                                                            label: "Alert subscriptions + watchlists",
                                                            detail: "Include selected watchlists with alert subscriptions.",
                                                            disabled: false
                                                        },
                                                        {
                                                            value: "full_market",
                                                            label: "Full market",
                                                            detail: "Use full-market products when your plan allows it.",
                                                            disabled: !alphaWsConfig.full_market_allowed
                                                        }
                                                    ].map((scope) => {
                                                        const selected = alphaWsConfig.scope_mode === scope.value;
                                                        return (
                                                            <button
                                                                className={cn(
                                                                    "rounded-lg border px-3 py-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                                                                    selected && "border-primary bg-accent"
                                                                )}
                                                                disabled={scope.disabled}
                                                                key={scope.value}
                                                                onClick={() =>
                                                                    setAlphaWsConfig((current) => ({
                                                                        ...current,
                                                                        scope_mode:
                                                                            scope.value as AlphaWebSocketConfig["scope_mode"],
                                                                        full_market: scope.value === "full_market"
                                                                    }))
                                                                }
                                                                type="button"
                                                            >
                                                                <span className="block text-sm font-medium">
                                                                    {scope.label}
                                                                </span>
                                                                <span className="mt-1 block text-xs text-muted-foreground">
                                                                    {scope.detail}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                                                    Effective: {alphaWsConfig.effective_products.length} products /{" "}
                                                    {alphaWsConfig.scope_mode === "full_market"
                                                        ? "full-feed"
                                                        : `${activeLiveSymbols} symbols`}
                                                    {fullMarketProducts.length ? (
                                                        <span className="mt-1 block">
                                                            Full-market products: {fullMarketProducts.join(", ")}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}

                                        {activeFeedConfigCategory === "watchlists" ? (
                                            <div className="flex flex-col gap-3">
                                                <div>
                                                    <h3 className="text-sm font-semibold">Watchlists</h3>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Watchlists are used when symbol scope includes watchlists.
                                                    </p>
                                                </div>
                                                <Label
                                                    className={cn(
                                                        "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent",
                                                        alphaWsConfig.scope_mode !== "alerts_and_watchlists" &&
                                                            "cursor-not-allowed opacity-50",
                                                        alphaWsConfig.include_all_watchlists &&
                                                            "border-primary bg-accent"
                                                    )}
                                                >
                                                    <Checkbox
                                                        checked={alphaWsConfig.include_all_watchlists}
                                                        disabled={alphaWsConfig.scope_mode !== "alerts_and_watchlists"}
                                                        onCheckedChange={(next) =>
                                                            setAlphaWsConfig((current) => ({
                                                                ...current,
                                                                include_all_watchlists: Boolean(next)
                                                            }))
                                                        }
                                                    />
                                                    <span className="text-sm font-medium">All watchlists</span>
                                                </Label>
                                                <div className="flex max-h-[18rem] flex-col gap-2 overflow-y-auto pr-1">
                                                    {watchlists.map((watchlist) => {
                                                        const checked = alphaWsConfig.watchlist_ids.includes(
                                                            watchlist.id
                                                        );
                                                        const disabled =
                                                            alphaWsConfig.scope_mode !== "alerts_and_watchlists" ||
                                                            alphaWsConfig.include_all_watchlists;
                                                        return (
                                                            <Label
                                                                className={cn(
                                                                    "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent",
                                                                    disabled && "cursor-not-allowed opacity-50",
                                                                    checked && "border-primary bg-accent"
                                                                )}
                                                                key={watchlist.id}
                                                            >
                                                                <Checkbox
                                                                    checked={checked}
                                                                    disabled={disabled}
                                                                    onCheckedChange={(next) =>
                                                                        toggleWatchlist(watchlist.id, Boolean(next))
                                                                    }
                                                                />
                                                                <span className="min-w-0">
                                                                    <span className="block truncate text-sm font-medium">
                                                                        {watchlist.name}
                                                                    </span>
                                                                    <span className="block truncate text-xs text-muted-foreground">
                                                                        {watchlist.items.length ||
                                                                            watchlist.symbols.length}{" "}
                                                                        symbols
                                                                    </span>
                                                                </span>
                                                            </Label>
                                                        );
                                                    })}
                                                    {!watchlists.length ? (
                                                        <Empty className="py-8">
                                                            <EmptyHeader>
                                                                <EmptyMedia variant="icon">
                                                                    <ListChecks />
                                                                </EmptyMedia>
                                                                <EmptyTitle>No watchlists available</EmptyTitle>
                                                                <EmptyDescription>
                                                                    Create a watchlist to include its symbols in the
                                                                    live scope.
                                                                </EmptyDescription>
                                                            </EmptyHeader>
                                                        </Empty>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="p-4">
                                        <p className="text-sm font-medium">
                                            {selectedFeedItems} feed settings selected
                                        </p>
                                        <Separator className="my-4" />
                                        <div className="flex flex-col gap-2.5">
                                            <div className="rounded-lg bg-muted/60 px-4 py-3">
                                                <p className="text-xs font-medium text-muted-foreground">Products</p>
                                                <p className="mt-1 truncate text-sm">
                                                    {alphaWsConfig.products.length
                                                        ? alphaWsConfig.products.join(", ")
                                                        : "No products selected"}
                                                </p>
                                            </div>
                                            <div className="rounded-lg bg-muted/60 px-4 py-3">
                                                <p className="text-xs font-medium text-muted-foreground">
                                                    Symbol scope
                                                </p>
                                                <p className="mt-1 truncate text-sm">
                                                    {scopeModeLabel(alphaWsConfig.scope_mode)}
                                                </p>
                                            </div>
                                            <div className="rounded-lg bg-muted/60 px-4 py-3">
                                                <p className="text-xs font-medium text-muted-foreground">Watchlists</p>
                                                <p className="mt-1 truncate text-sm">
                                                    {alphaWsConfig.scope_mode !== "alerts_and_watchlists"
                                                        ? "Not included"
                                                        : alphaWsConfig.include_all_watchlists
                                                          ? "All watchlists"
                                                          : selectedWatchlists.length
                                                            ? selectedWatchlists
                                                                  .map((watchlist) => watchlist.name)
                                                                  .join(", ")
                                                            : "No watchlists selected"}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                                    <Button onClick={clearFeedConfig} size="sm" type="button" variant="ghost">
                                        Clear feed
                                    </Button>
                                    <div className="flex items-center gap-2">
                                        <Button onClick={closeFeedConfig} size="sm" type="button" variant="outline">
                                            Cancel
                                        </Button>
                                        <Button
                                            disabled={isPending}
                                            onClick={saveAlphaWebSocketConfig}
                                            size="sm"
                                            type="button"
                                        >
                                            Apply
                                        </Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </CardFrameAction>
                </CardFrameHeader>
                {alphaWsConfig.last_error ? (
                    <Card>
                        <CardPanel>
                            <div className="border-l-2 border-destructive px-3 py-2 text-sm text-destructive">
                                {alphaWsConfig.last_error}
                            </div>
                        </CardPanel>
                    </Card>
                ) : null}
            </CardFrame>
            <CardFrame className="overflow-visible">
                <CardFrameHeader>
                    <CardFrameTitle>Add subscribed symbols</CardFrameTitle>
                    <CardFrameDescription>
                        Search the selected broker instrument cache and pick a symbol to subscribe.
                    </CardFrameDescription>
                    <CardFrameAction>
                        <Button
                            disabled={isPending || !selectedIds.length}
                            onClick={removeSelected}
                            type="button"
                            variant="outline"
                        >
                            Remove selected
                        </Button>
                    </CardFrameAction>
                </CardFrameHeader>
                <Card className="overflow-visible">
                    <CardPanel className="relative z-[60] grid gap-3 overflow-visible">
                        <div className="relative z-[70] grid items-start gap-3 min-[760px]:grid-cols-[minmax(13rem,15rem)_minmax(18rem,1fr)_6rem]">
                            <SimpleSelect
                                aria-label="Broker account"
                                className={symbolPickerControlClassName}
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
                            <div className="relative z-[80]" ref={searchWrapRef}>
                                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-primary" />
                                <Input
                                    aria-activedescendant={
                                        activeSuggestionIndex >= 0
                                            ? `subscription-symbol-suggestion-${activeSuggestionIndex}`
                                            : undefined
                                    }
                                    aria-autocomplete="list"
                                    aria-controls="subscription-symbol-suggestions"
                                    aria-expanded={showSuggestions && symbolSearch.trim() ? "true" : "false"}
                                    className={symbolPickerControlClassName}
                                    inputClassName="pl-8 pr-9 font-mono text-sm uppercase"
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
                                    <Loader2 className="absolute right-3 top-1/2 z-10 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                                ) : null}
                                {showSuggestions && symbolSearch.trim() ? (
                                    <div
                                        className="absolute z-[120] mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover shadow-xl ring-1 ring-black/20"
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
                                                key={[row.symbol, row.exchange, row.trading_symbol, row.expiry].join(
                                                    ":"
                                                )}
                                                onClick={() => addSearchedSymbol(row)}
                                                onMouseEnter={() => setActiveSuggestionIndex(index)}
                                                role="option"
                                                type="button"
                                                variant="ghost"
                                            >
                                                <span className="min-w-0">
                                                    <span className="block font-mono text-sm font-semibold">
                                                        {row.symbol}
                                                    </span>
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
                            <SimpleSelect
                                aria-label="Exchange"
                                className={`${symbolPickerControlClassName} font-mono uppercase`}
                                onValueChange={setExchange}
                                options={exchangeOptions}
                                value={exchange}
                            />
                        </div>
                        {!accounts.length ? (
                            <div className="type-help mt-3 text-muted-foreground">
                                Connect a broker account before adding subscriptions.
                            </div>
                        ) : null}
                    </CardPanel>
                </Card>
            </CardFrame>
            <div className="@container">
                <div className="grid gap-2 @2xl:grid-cols-2">
                    {items.map((item) => {
                        const metadata = symbolMetadata[item.symbol.toUpperCase()];
                        const companyName = metadata?.company_name?.trim();
                        return (
                            <Card
                                key={item.id}
                                render={<Label className="cursor-pointer transition-colors hover:bg-accent/40" />}
                            >
                                <CardPanel className="flex flex-wrap items-center justify-between gap-3 p-3">
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
                                            ? `Last tick ${parseApiDate(item.last_received_at).toLocaleTimeString(
                                                  "en-IN",
                                                  {
                                                      timeZone: INDIA_TIME_ZONE
                                                  }
                                              )}`
                                            : "Awaiting tick"}
                                    </div>
                                </CardPanel>
                            </Card>
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
