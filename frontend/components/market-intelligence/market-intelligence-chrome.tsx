"use client";

import {
    Bell,
    Filter,
    IndianRupee,
    Info,
    Megaphone,
    MessageSquare,
    Newspaper,
    Search,
    X,
    type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { parseActionError } from "@/components/brokers/action-error";
import { brokerNames, PageHeader } from "@/components/brokers/ui";
import {
    FeedSearchInput,
    LiveStatusPill,
    WatchlistScopeTooltip
} from "@/components/market-intelligence/market-intelligence-feed-primitives";
import {
    MarketIntelligenceLiveFeed,
    StateMessage,
    type MarketIntelligenceSocketState
} from "@/components/market-intelligence/market-intelligence-live-feed";
import { MarketIntelligenceSymbolChart } from "@/components/market-intelligence/market-intelligence-symbol-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getAlphaAlerts } from "@/service/actions/alpha/alerts";
import { getAlphaAnnouncements } from "@/service/actions/alpha/announcements";
import { getAlphaConcalls } from "@/service/actions/alpha/concalls";
import { getAlphaEarnings } from "@/service/actions/alpha/earnings";
import { getAlphaNews } from "@/service/actions/alpha/news";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import { getBrokerDataDefaultConfig, getMarketChartData, searchBrokerInstruments } from "@/service/actions/broker";
import type {
    BrokerDataDefaultAccount,
    InstrumentRef,
    InstrumentSearchRow,
    MarketChartSnapshot
} from "@/service/types/broker";
import { getAlphaCreditWarningMessage, notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";
import { cn } from "@/lib/utils";
import {
    ALPHA_SYMBOL_LIMIT,
    marketIntelligenceProducts,
    emptyMarketIntelligenceFeeds,
    marketIntelligenceSections,
    type AlphaSection,
    type MarketIntelligenceFeeds,
    type WatchlistCoverageGroup
} from "@/components/market-intelligence/market-intelligence-data";

const sectionChrome = {
    news: {
        icon: Newspaper
    },
    announcements: {
        icon: Megaphone
    },
    earnings: {
        icon: IndianRupee
    },
    concalls: {
        icon: MessageSquare
    },
    alerts: {
        icon: Bell
    }
} satisfies Record<AlphaSection, { icon: LucideIcon }>;

const intelligenceHelpItems = [
    {
        title: "News",
        body: "Market news and company-specific coverage from media sources. Use it for external context around price action, sentiment, and public market narratives."
    },
    {
        title: "Announcements",
        body: "Official exchange and company disclosures, including board updates, corporate actions, regulatory filings, and other company-published events."
    },
    {
        title: "Earnings",
        body: "Earnings-related disclosures and management guidance. These records highlight result updates and material financial context."
    },
    {
        title: "Concalls",
        body: "Conference call summaries, transcripts, and management commentary from investor calls. Transcript and audio actions appear when the feed includes those links."
    },
    {
        title: "Alerts",
        body: "Signal-style market alerts for price moves, volume spikes, 52-week levels, earnings, announcements, and other notable events."
    }
];

const ALL_WATCHLISTS_ID = "__all_watchlists__";

type BrokerChartState = {
    error: string;
    isLoading: boolean;
    snapshot: MarketChartSnapshot | null;
};

function isoDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

function metadataBySymbol(items: AlphaSymbolMetadata[]) {
    return items.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
        const symbol = item.symbol?.trim().toUpperCase();
        if (symbol) acc[symbol] = item;
        return acc;
    }, {});
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

function manualInstrument(symbol: string): InstrumentRef {
    return { symbol: symbol.trim().toUpperCase() };
}

function defaultAccountLabel(account: BrokerDataDefaultAccount | null): string {
    if (!account) return "No default broker";
    const brokerCode = account.broker_code as keyof typeof brokerNames;
    const broker = brokerNames[brokerCode] ?? account.broker_code;
    return `${account.label} / ${broker}`;
}

async function loadFeeds(symbols: string[]): Promise<MarketIntelligenceFeeds> {
    if (!symbols.length) return emptyMarketIntelligenceFeeds();
    const params = {
        symbols: symbols.slice(0, ALPHA_SYMBOL_LIMIT),
        from: isoDateDaysAgo(30),
        to: todayIsoDate(),
        page: 1,
        limit: 20,
        detailed: true
    };
    const [news, announcements, earnings, concalls, alerts] = await Promise.allSettled([
        getAlphaNews(params),
        getAlphaAnnouncements(params),
        getAlphaEarnings(params),
        getAlphaConcalls(params),
        getAlphaAlerts(params)
    ]);

    const creditWarningMessage = getAlphaCreditWarningMessage(news, announcements, earnings, concalls, alerts);
    if (creditWarningMessage) notifyAlphaCreditWarning(creditWarningMessage);

    return {
        news: news.status === "fulfilled" ? (news.value.data ?? []) : [],
        announcements: announcements.status === "fulfilled" ? (announcements.value.data ?? []) : [],
        earnings: earnings.status === "fulfilled" ? (earnings.value.data ?? []) : [],
        concalls: concalls.status === "fulfilled" ? (concalls.value.data ?? []) : [],
        alerts: alerts.status === "fulfilled" ? (alerts.value.data ?? []) : []
    };
}

export function MarketIntelligenceChrome({
    allSymbolsCount,
    children,
    creditWarningMessage,
    error,
    initialFeeds,
    symbolMetadata,
    symbols,
    streamSymbols,
    watchlistGroups
}: {
    allSymbolsCount: number;
    children: React.ReactNode;
    creditWarningMessage?: string | null;
    error?: string;
    initialFeeds: MarketIntelligenceFeeds;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
    symbols: string[];
    streamSymbols: string[];
    watchlistGroups: WatchlistCoverageGroup[];
}) {
    const [activeSectionId, setActiveSectionId] = useState<AlphaSection>(marketIntelligenceSections[0].id);
    const [selectedWatchlistId, setSelectedWatchlistId] = useState(ALL_WATCHLISTS_ID);
    const [feeds, setFeeds] = useState(initialFeeds);
    const [activeMetadata, setActiveMetadata] = useState(symbolMetadata);
    const [defaultBrokerAccount, setDefaultBrokerAccount] = useState<BrokerDataDefaultAccount | null>(null);
    const [brokerConfigError, setBrokerConfigError] = useState("");
    const [isLoadingBrokerConfig, setIsLoadingBrokerConfig] = useState(true);
    const [filterError, setFilterError] = useState("");
    const [isLoadingFilter, setIsLoadingFilter] = useState(false);
    const [feedSearch, setFeedSearch] = useState("");
    const [socketState, setSocketState] = useState<MarketIntelligenceSocketState>("connecting");
    const [searchText, setSearchText] = useState("");
    const [committedSymbol, setCommittedSymbol] = useState("");
    const [committedInstrument, setCommittedInstrument] = useState<InstrumentRef | null>(null);
    const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [suggestionMetadata, setSuggestionMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [symbolError, setSymbolError] = useState("");
    const [isLoadingSymbolFeed, setIsLoadingSymbolFeed] = useState(false);
    const [chartState, setChartState] = useState<BrokerChartState>({
        error: "",
        isLoading: false,
        snapshot: null
    });
    const activeSection =
        marketIntelligenceSections.find((item) => item.id === activeSectionId) ?? marketIntelligenceSections[0];
    const selectedWatchlist = watchlistGroups.find((item) => item.id === selectedWatchlistId) ?? null;
    const activeSymbols = useMemo(
        () => (selectedWatchlist ? selectedWatchlist.symbols : streamSymbols),
        [selectedWatchlist, streamSymbols]
    );
    const filterLabel = selectedWatchlist ? selectedWatchlist.name : "All watchlists";
    const symbolModeActive = Boolean(committedSymbol);
    const visibleSymbols = useMemo(
        () => (symbolModeActive ? [committedSymbol] : activeSymbols),
        [activeSymbols, committedSymbol, symbolModeActive]
    );

    useEffect(() => {
        let cancelled = false;
        setIsLoadingBrokerConfig(true);
        setBrokerConfigError("");
        void (async () => {
            try {
                const config = await getBrokerDataDefaultConfig();
                if (cancelled) return;
                const effective =
                    config.accounts.find((account) => account.account_id === config.effective_default_account_id) ??
                    null;
                setDefaultBrokerAccount(effective);
            } catch (caught) {
                if (cancelled) return;
                setDefaultBrokerAccount(null);
                setBrokerConfigError(parseActionError(caught).message);
            } finally {
                if (!cancelled) setIsLoadingBrokerConfig(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (symbolModeActive) {
            setIsLoadingFilter(false);
            return;
        }
        if (selectedWatchlistId === ALL_WATCHLISTS_ID) {
            setFeeds(initialFeeds);
            setActiveMetadata(symbolMetadata);
            setFilterError("");
            setIsLoadingFilter(false);
            return;
        }

        let cancelled = false;
        setFilterError("");
        setIsLoadingFilter(true);
        void (async () => {
            const [nextMetadata, nextFeeds] = await Promise.allSettled([
                getAlphaSymbolMetadata(activeSymbols),
                loadFeeds(activeSymbols)
            ]);
            if (cancelled) return;
            if (nextMetadata.status === "fulfilled") {
                setActiveMetadata(metadataBySymbol(nextMetadata.value));
            } else {
                notifyAlphaCreditWarning(nextMetadata.reason);
                setActiveMetadata({});
            }
            if (nextFeeds.status === "fulfilled") {
                setFeeds(nextFeeds.value);
            } else {
                notifyAlphaCreditWarning(nextFeeds.reason);
                setFeeds(emptyMarketIntelligenceFeeds());
                setFilterError(parseActionError(nextFeeds.reason).message);
            }
            setIsLoadingFilter(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [activeSymbols, initialFeeds, selectedWatchlistId, symbolMetadata, symbolModeActive]);

    useEffect(() => {
        const query = searchText.trim();
        const accountId = defaultBrokerAccount?.account_id;
        if (!query || !accountId || query.toUpperCase() === committedSymbol) {
            setSuggestions([]);
            setSuggestionMetadata({});
            setIsLoadingSuggestions(false);
            return;
        }

        let cancelled = false;
        const handle = window.setTimeout(() => {
            setIsLoadingSuggestions(true);
            void (async () => {
                try {
                    const rows = await searchBrokerInstruments(accountId, { q: query, limit: 8 });
                    if (cancelled) return;
                    setSuggestions(rows);
                    setShowSuggestions(true);
                    const symbolsToLoad = Array.from(
                        new Set(rows.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))
                    );
                    if (!symbolsToLoad.length) {
                        setSuggestionMetadata({});
                        return;
                    }
                    try {
                        const metadata = await getAlphaSymbolMetadata(symbolsToLoad);
                        if (cancelled) return;
                        setSuggestionMetadata(metadataBySymbol(metadata));
                    } catch (caught) {
                        notifyAlphaCreditWarning(caught);
                        if (!cancelled) setSuggestionMetadata({});
                    }
                } catch {
                    if (cancelled) return;
                    setSuggestions([]);
                    setSuggestionMetadata({});
                } finally {
                    if (!cancelled) setIsLoadingSuggestions(false);
                }
            })();
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [committedSymbol, defaultBrokerAccount?.account_id, searchText]);

    useEffect(() => {
        if (!committedSymbol) return;

        let cancelled = false;
        setSymbolError("");
        setFilterError("");
        setIsLoadingSymbolFeed(true);
        void (async () => {
            const [nextMetadata, nextFeeds] = await Promise.allSettled([
                getAlphaSymbolMetadata([committedSymbol]),
                loadFeeds([committedSymbol])
            ]);
            if (cancelled) return;
            if (nextMetadata.status === "fulfilled") {
                setActiveMetadata(metadataBySymbol(nextMetadata.value));
            } else {
                notifyAlphaCreditWarning(nextMetadata.reason);
                setActiveMetadata({});
            }
            if (nextFeeds.status === "fulfilled") {
                setFeeds(nextFeeds.value);
            } else {
                notifyAlphaCreditWarning(nextFeeds.reason);
                setFeeds(emptyMarketIntelligenceFeeds());
                setSymbolError(parseActionError(nextFeeds.reason).message);
            }
            setIsLoadingSymbolFeed(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [committedSymbol]);

    useEffect(() => {
        if (!committedSymbol || !committedInstrument) {
            setChartState({ error: "", isLoading: false, snapshot: null });
            return;
        }
        if (isLoadingBrokerConfig) {
            setChartState({ error: "", isLoading: true, snapshot: null });
            return;
        }
        if (!defaultBrokerAccount) {
            setChartState({
                error: brokerConfigError || "No active default broker account is available for price data.",
                isLoading: false,
                snapshot: null
            });
            return;
        }
        if (!defaultBrokerAccount.session_active) {
            setChartState({
                error: "The default broker session is not active. Activate it to load price data.",
                isLoading: false,
                snapshot: null
            });
            return;
        }

        let cancelled = false;
        setChartState({ error: "", isLoading: true, snapshot: null });
        void (async () => {
            try {
                const snapshot = await getMarketChartData(defaultBrokerAccount.account_id, {
                    instrument: committedInstrument,
                    history_days: 90,
                    daily_interval: "day",
                    intraday_interval: "1minute",
                    include_live_quote: true
                });
                if (cancelled) return;
                setChartState({
                    error: snapshot.candles.length ? "" : "No broker chart data returned for this symbol.",
                    isLoading: false,
                    snapshot
                });
            } catch (caught) {
                if (cancelled) return;
                setChartState({
                    error: parseActionError(caught).message,
                    isLoading: false,
                    snapshot: null
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        brokerConfigError,
        committedInstrument,
        committedSymbol,
        defaultBrokerAccount,
        isLoadingBrokerConfig
    ]);

    function commitSymbol(symbol: string, instrument: InstrumentRef) {
        const normalized = symbol.trim().toUpperCase();
        if (!normalized) {
            setSymbolError("Enter a symbol to search market intelligence.");
            return;
        }
        setCommittedSymbol(normalized);
        setCommittedInstrument({ ...instrument, symbol: instrument.symbol?.trim().toUpperCase() || normalized });
        setSearchText(normalized);
        setShowSuggestions(false);
        setSymbolError("");
    }

    function submitSymbolSearch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const query = searchText.trim().toUpperCase();
        const exactSuggestion = suggestions.find((row) => {
            const symbol = row.symbol.trim().toUpperCase();
            const tradingSymbol = row.trading_symbol?.trim().toUpperCase();
            return symbol === query || tradingSymbol === query;
        });
        if (exactSuggestion) {
            commitSymbol(exactSuggestion.symbol, instrumentFromSearch(exactSuggestion));
            return;
        }
        commitSymbol(query, manualInstrument(query));
    }

    function clearSymbolSearch() {
        setSearchText("");
        setCommittedSymbol("");
        setCommittedInstrument(null);
        setSuggestions([]);
        setSuggestionMetadata({});
        setShowSuggestions(false);
        setSymbolError("");
        setChartState({ error: "", isLoading: false, snapshot: null });
        if (selectedWatchlistId === ALL_WATCHLISTS_ID) {
            setFeeds(initialFeeds);
            setActiveMetadata(symbolMetadata);
        }
    }

    function handleFeedSymbolClick(symbol: string) {
        commitSymbol(symbol, manualInstrument(symbol));
    }

    return (
        <>
            <AlphaCreditWarningTrigger message={creditWarningMessage} />
            <PageHeader
                action={
                    !isLoadingBrokerConfig && !defaultBrokerAccount ? (
                        <Badge size="sm" variant="warning">
                            No broker
                        </Badge>
                    ) : null
                }
                description={activeSection.description}
                eyebrow="Alpha intelligence"
                title="Market Intelligence"
            />

            <div className="mb-4 flex min-w-0 flex-col gap-3 border-b border-border/50 pb-3 min-[920px]:flex-row min-[920px]:items-center min-[920px]:justify-between">
                <nav
                    aria-label="Market intelligence sections"
                    className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 min-[920px]:flex-wrap min-[920px]:overflow-visible"
                >
                    {marketIntelligenceSections.map((item) => {
                        const active = item.id === activeSection.id;
                        const Icon = sectionChrome[item.id].icon;
                        return (
                            <button
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                    "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors",
                                    active
                                        ? "border-primary font-medium text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                                key={item.id}
                                onClick={() => setActiveSectionId(item.id)}
                                type="button"
                            >
                                <Icon className="size-3.5 opacity-70" />
                                {item.label}
                            </button>
                        );
                    })}
                </nav>

                <form
                    className="flex min-w-0 flex-col gap-2 min-[640px]:flex-row min-[640px]:items-center min-[920px]:w-[min(52vw,720px)] min-[920px]:shrink-0"
                    onSubmit={submitSymbolSearch}
                >
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {isLoadingBrokerConfig ? "Loading broker..." : defaultAccountLabel(defaultBrokerAccount)}
                    </span>
                    <label className="relative min-w-0 flex-1">
                        <span className="sr-only">Search a symbol chart</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            autoComplete="off"
                            className="pl-9"
                            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
                            onChange={(event) => {
                                setSearchText(event.target.value);
                                setShowSuggestions(true);
                            }}
                            onFocus={() => setShowSuggestions(true)}
                            placeholder="Search a symbol chart"
                            value={searchText}
                        />
                        {showSuggestions && searchText.trim() ? (
                            <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-y-auto border border-border bg-background shadow-lg">
                                {isLoadingSuggestions ? (
                                    <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
                                ) : null}
                                {!isLoadingSuggestions && suggestions.length
                                    ? suggestions.map((row) => {
                                          const metadata = suggestionMetadata[row.symbol.trim().toUpperCase()];
                                          const company = metadata?.company_name ?? row.name;
                                          const detail = [
                                              row.exchange,
                                              row.instrument_type,
                                              row.trading_symbol,
                                              metadata?.sector
                                          ].filter(Boolean);
                                          return (
                                              <button
                                                  className="flex w-full min-w-0 items-center gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-secondary"
                                                  key={`${row.account_id ?? "default"}-${row.exchange ?? ""}-${row.symbol}-${row.trading_symbol ?? ""}`}
                                                  onMouseDown={(event) => {
                                                      event.preventDefault();
                                                      commitSymbol(row.symbol, instrumentFromSearch(row));
                                                  }}
                                                  type="button"
                                              >
                                                  <SymbolSearchLogo metadata={metadata} symbol={row.symbol} />
                                                  <span className="min-w-0 flex-1">
                                                      <span className="block truncate text-sm font-semibold text-foreground">
                                                          {row.symbol}
                                                          {company ? (
                                                              <span className="font-normal text-muted-foreground">
                                                                  {" "}
                                                                  / {company}
                                                              </span>
                                                          ) : null}
                                                      </span>
                                                      <span className="block truncate text-xs text-muted-foreground">
                                                          {detail.join(" / ") || "Broker instrument"}
                                                      </span>
                                                  </span>
                                              </button>
                                          );
                                      })
                                    : null}
                                {!isLoadingSuggestions && !suggestions.length ? (
                                    <div className="px-3 py-2 text-sm text-muted-foreground">
                                        Press search to use this symbol.
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </label>
                    <Button className="shrink-0" disabled={isLoadingSymbolFeed} type="submit">
                        <Search className="size-4" />
                        {isLoadingSymbolFeed ? "Loading..." : "Search"}
                    </Button>
                    {symbolModeActive ? (
                        <Button className="shrink-0" onClick={clearSymbolSearch} type="button" variant="outline">
                            <X className="size-4" />
                            Clear
                        </Button>
                    ) : null}
                    <Dialog>
                        <DialogTrigger asChild>
                            <button
                                aria-label="Learn about market intelligence"
                                className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
                                type="button"
                            >
                                <Info className="size-4" />
                            </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-xl p-6">
                            <DialogHeader>
                                <DialogTitle>Understanding Market Intelligence</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 text-sm leading-6 text-muted-foreground">
                                {intelligenceHelpItems.map((item) => (
                                    <section className="grid gap-1" key={item.title}>
                                        <h3 className="text-sm font-semibold leading-5 text-foreground">
                                            {item.title}
                                        </h3>
                                        <p>{item.body}</p>
                                    </section>
                                ))}
                            </div>
                        </DialogContent>
                    </Dialog>
                </form>
            </div>

            {watchlistGroups.length ? (
                <div className="mb-4 flex min-w-0 flex-col gap-3 text-xs text-muted-foreground min-[920px]:flex-row min-[920px]:items-center min-[920px]:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                        <WatchlistScopeTooltip historyLimit={ALPHA_SYMBOL_LIMIT} symbolCount={allSymbolsCount}>
                            <label className="flex min-w-0 items-center gap-2">
                                <Filter className="size-4 shrink-0 text-primary" />
                                <span className="shrink-0 font-semibold uppercase tracking-[0.16em] text-primary">
                                    Watchlist
                                </span>
                                <Select
                                    aria-label="Filter market intelligence by watchlist"
                                    className="h-8 min-w-[min(100%,14rem)] max-w-sm bg-background text-xs"
                                    disabled={isLoadingFilter || symbolModeActive}
                                    onChange={(event) => setSelectedWatchlistId(event.target.value)}
                                    value={selectedWatchlistId}
                                >
                                    <option value={ALL_WATCHLISTS_ID}>All watchlists ({allSymbolsCount} symbols)</option>
                                    {watchlistGroups.map((group) => (
                                        <option key={group.id} value={group.id}>
                                            {group.name} ({group.symbols.length} symbols)
                                        </option>
                                    ))}
                                </Select>
                            </label>
                        </WatchlistScopeTooltip>
                        {!symbolModeActive ? <span className="text-border">·</span> : null}
                        {!symbolModeActive ? <LiveStatusPill state={socketState} /> : null}
                        {!symbolModeActive ? <span className="text-border">·</span> : null}
                        <span>
                            {symbolModeActive
                                ? "Single symbol mode active"
                                : `${marketIntelligenceProducts.length} products · ${activeSymbols.length} symbols`}
                            {isLoadingFilter ? " · Loading…" : ""}
                            {!symbolModeActive && activeSymbols.length > ALPHA_SYMBOL_LIMIT
                                ? ` · first ${ALPHA_SYMBOL_LIMIT} used for history`
                                : ""}
                        </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 min-[920px]:w-[min(36vw,320px)] min-[920px]:shrink-0">
                        <FeedSearchInput
                            onChange={setFeedSearch}
                            placeholder={symbolModeActive ? `Filter ${committedSymbol} feed` : `Filter ${filterLabel} feed`}
                            value={feedSearch}
                        />
                    </div>
                </div>
            ) : null}

            {symbolModeActive ? (
                <div className="mb-5">
                    <MarketIntelligenceSymbolChart
                        account={defaultBrokerAccount}
                        feeds={feeds}
                        instrument={committedInstrument}
                        state={chartState}
                        symbol={committedSymbol}
                        symbolMetadata={activeMetadata}
                    />
                </div>
            ) : null}

            {error ? <StateMessage message={error} tone="error" /> : null}
            {symbolError ? <StateMessage message={symbolError} tone="error" /> : null}
            {filterError ? <StateMessage message={filterError} tone="error" /> : null}
            {!error && !symbolModeActive && !symbols.length ? (
                <StateMessage message="Add symbols to a watchlist to view Alpha market intelligence." />
            ) : null}
            {!error && visibleSymbols.length ? (
                <MarketIntelligenceLiveFeed
                    activeSection={activeSection.id}
                    enableLiveUpdates={!symbolModeActive}
                    feedSearch={feedSearch}
                    initialFeeds={feeds}
                    onFeedSearchSymbol={handleFeedSymbolClick}
                    onSocketStateChange={setSocketState}
                    symbolMetadata={activeMetadata}
                    symbols={visibleSymbols}
                />
            ) : null}
            {children}
        </>
    );
}

function SymbolSearchLogo({ metadata, symbol }: { metadata?: AlphaSymbolMetadata; symbol: string }) {
    const [failed, setFailed] = useState(false);
    const logo = metadata?.logo && !failed ? metadata.logo : "";

    if (logo) {
        return (
            <img
                alt=""
                className="size-8 shrink-0 object-contain"
                loading="lazy"
                onError={() => setFailed(true)}
                referrerPolicy="no-referrer"
                src={logo}
            />
        );
    }

    return (
        <span className="flex size-8 shrink-0 items-center justify-center bg-secondary font-mono text-[10px] font-semibold text-muted-foreground">
            {symbol.slice(0, 2).toUpperCase()}
        </span>
    );
}
