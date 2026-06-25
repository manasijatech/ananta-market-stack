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
    MarketIntelligenceLiveFeed,
    StateMessage
} from "@/components/market-intelligence/market-intelligence-live-feed";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { getAlphaAlerts } from "@/service/actions/alpha/alerts";
import { getAlphaAnnouncements } from "@/service/actions/alpha/announcements";
import { getAlphaConcalls } from "@/service/actions/alpha/concalls";
import { getAlphaEarnings } from "@/service/actions/alpha/earnings";
import { getAlphaNews } from "@/service/actions/alpha/news";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import { getBrokerDataDefaultConfig, getDataQuotes, searchBrokerInstruments } from "@/service/actions/broker";
import type {
    BrokerDataDefaultAccount,
    InstrumentRef,
    InstrumentSearchRow,
    JsonObject,
    JsonValue,
    QuoteResponse
} from "@/service/types/broker";
import { getAlphaCreditWarningMessage, notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";
import {
    ALPHA_SYMBOL_LIMIT,
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

type BrokerQuoteState = {
    error: string;
    isLoading: boolean;
    quote: QuoteResponse | null;
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

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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

function displayValue(value: JsonValue | undefined): string {
    if (typeof value === "string" || typeof value === "number") return String(value);
    return "-";
}

function displayRaw(raw: JsonObject, keys: string[]): string {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === "string" || typeof value === "number") return String(value);
    }
    const ohlc = raw.ohlc;
    if (isJsonObject(ohlc)) {
        for (const key of keys) {
            const value = ohlc[key];
            if (typeof value === "string" || typeof value === "number") return String(value);
        }
    }
    return "-";
}

function quoteRaw(row: QuoteResponse): JsonObject {
    return isJsonObject(row.detail.raw) ? row.detail.raw : row.detail;
}

function quoteFieldRows(row: QuoteResponse) {
    const raw = quoteRaw(row);
    return [
        ["Open", displayRaw(raw, ["open", "open_price"])],
        ["High", displayRaw(raw, ["high", "high_price"])],
        ["Low", displayRaw(raw, ["low", "low_price"])],
        ["Close", displayRaw(raw, ["close", "close_price"])],
        ["Volume", displayRaw(raw, ["volume", "volume_traded"])],
        ["Time", displayRaw(raw, ["timestamp", "last_trade_time"])]
    ] as const;
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
    const [searchText, setSearchText] = useState("");
    const [committedSymbol, setCommittedSymbol] = useState("");
    const [committedInstrument, setCommittedInstrument] = useState<InstrumentRef | null>(null);
    const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [suggestionMetadata, setSuggestionMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [symbolError, setSymbolError] = useState("");
    const [isLoadingSymbolFeed, setIsLoadingSymbolFeed] = useState(false);
    const [quoteState, setQuoteState] = useState<BrokerQuoteState>({
        error: "",
        isLoading: false,
        quote: null
    });
    const activeSection =
        marketIntelligenceSections.find((item) => item.id === activeSectionId) ?? marketIntelligenceSections[0];
    const selectedWatchlist = watchlistGroups.find((item) => item.id === selectedWatchlistId) ?? null;
    const activeSymbols = useMemo(
        () => (selectedWatchlist ? selectedWatchlist.symbols : streamSymbols),
        [selectedWatchlist, streamSymbols]
    );
    const filterLabel = selectedWatchlist ? selectedWatchlist.name : "All watchlists";
    const selectedWatchlistLabel =
        selectedWatchlistId === ALL_WATCHLISTS_ID
            ? `All watchlists (${allSymbolsCount} symbols)`
            : selectedWatchlist
              ? `${selectedWatchlist.name} (${selectedWatchlist.symbols.length})`
              : "Select watchlist";
    const symbolModeActive = Boolean(committedSymbol);
    const visibleSymbols = symbolModeActive ? [committedSymbol] : activeSymbols;

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
                    const symbols = Array.from(
                        new Set(rows.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))
                    );
                    if (!symbols.length) {
                        setSuggestionMetadata({});
                        return;
                    }
                    try {
                        const metadata = await getAlphaSymbolMetadata(symbols);
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
            setQuoteState({ error: "", isLoading: false, quote: null });
            return;
        }
        if (isLoadingBrokerConfig) {
            setQuoteState({ error: "", isLoading: true, quote: null });
            return;
        }
        if (!defaultBrokerAccount) {
            setQuoteState({
                error: brokerConfigError || "No active default broker account is available for price data.",
                isLoading: false,
                quote: null
            });
            return;
        }
        if (!defaultBrokerAccount.session_active) {
            setQuoteState({
                error: "The default broker session is not active. Activate it to load price data.",
                isLoading: false,
                quote: null
            });
            return;
        }

        let cancelled = false;
        setQuoteState({ error: "", isLoading: true, quote: null });
        void (async () => {
            try {
                const rows = await getDataQuotes(defaultBrokerAccount.account_id, { instruments: [committedInstrument] });
                if (cancelled) return;
                setQuoteState({
                    error: rows.length ? "" : "No broker quote returned for this symbol.",
                    isLoading: false,
                    quote: rows[0] ?? null
                });
            } catch (caught) {
                if (cancelled) return;
                setQuoteState({
                    error: parseActionError(caught).message,
                    isLoading: false,
                    quote: null
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
        setQuoteState({ error: "", isLoading: false, quote: null });
        if (selectedWatchlistId === ALL_WATCHLISTS_ID) {
            setFeeds(initialFeeds);
            setActiveMetadata(symbolMetadata);
        }
    }

    return (
        <>
            <AlphaCreditWarningTrigger message={creditWarningMessage} />
            <PageHeader
                eyebrow="Alpha intelligence"
                title="Market Intelligence"
                description={activeSection.description}
            />

            <div className="mb-5 flex min-w-0 flex-col gap-3 min-[920px]:flex-row min-[920px]:items-center min-[920px]:justify-between">
                <nav
                    className="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-1 min-[920px]:mx-0 min-[920px]:flex-wrap min-[920px]:overflow-visible min-[920px]:px-0 min-[920px]:pb-0"
                    aria-label="Market intelligence sections"
                >
                    {marketIntelligenceSections.map((item) => {
                        const active = item.id === activeSection.id;
                        const Icon = sectionChrome[item.id].icon;
                        return (
                            <Button
                                className={[
                                    "shrink-0 whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]",
                                    active ? "" : "text-muted-foreground hover:text-foreground"
                                ].join(" ")}
                                key={item.id}
                                onClick={() => setActiveSectionId(item.id)}
                                size="sm"
                                type="button"
                                aria-pressed={active}
                                variant={active ? "default" : "secondary"}
                            >
                                <Icon className="size-3.5" />
                                {item.label}
                            </Button>
                        );
                    })}
                </nav>
                <form
                    className="flex min-w-0 flex-col gap-2 min-[540px]:flex-row min-[540px]:items-center min-[920px]:w-[min(50vw,720px)] min-[920px]:shrink-0"
                    onSubmit={submitSymbolSearch}
                >
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {isLoadingBrokerConfig ? "Loading broker..." : defaultAccountLabel(defaultBrokerAccount)}
                    </span>
                    <label className="relative min-w-0 flex-1">
                        <span className="sr-only">Search symbol</span>
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
                            placeholder="Search a symbol"
                            value={searchText}
                        />
                        {showSuggestions && searchText.trim() ? (
                            <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-y-auto border border-border bg-background shadow-lg">
                                {isLoadingSuggestions ? (
                                    <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
                                ) : null}
                                {!isLoadingSuggestions && suggestions.length ? (
                                    suggestions.map((row) => {
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
                                ) : null}
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
                                className="flex size-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
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

            {symbolModeActive ? (
                <div className="mb-5">
                    <BrokerQuotePanel account={defaultBrokerAccount} state={quoteState} symbol={committedSymbol} />
                </div>
            ) : null}

            {watchlistGroups.length ? (
                <div className="mb-5 flex flex-col gap-2 text-xs text-muted-foreground min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Filter className="size-4 shrink-0 text-primary" />
                        <span className="shrink-0 font-semibold uppercase tracking-[0.16em] text-primary">
                            Watchlist
                        </span>
                        <Select
                            disabled={isLoadingFilter || symbolModeActive}
                            onValueChange={(value) => {
                                if (value) setSelectedWatchlistId(value);
                            }}
                            value={selectedWatchlistId}
                        >
                            <SelectTrigger
                                aria-label="Filter market intelligence by watchlist"
                                className="h-9 min-w-[min(100%,14rem)] max-w-sm bg-background text-xs"
                                size="sm"
                            >
                                <SelectValue placeholder="Select watchlist">{selectedWatchlistLabel}</SelectValue>
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false} className="min-w-[var(--anchor-width)]">
                                <SelectItem className="group py-2" value={ALL_WATCHLISTS_ID}>
                                    <span className="flex min-w-0 flex-col gap-0.5">
                                        <span className="truncate font-medium">All watchlists</span>
                                        <span className="truncate text-xs text-muted-foreground group-data-[highlighted]:text-accent-foreground/80">
                                            {allSymbolsCount} symbols
                                        </span>
                                    </span>
                                </SelectItem>
                                {watchlistGroups.map((group) => (
                                    <SelectItem className="group py-2" key={group.id} value={group.id}>
                                        <span className="flex min-w-0 flex-col gap-0.5">
                                            <span className="truncate font-medium">{group.name}</span>
                                            <span className="truncate text-xs text-muted-foreground group-data-[highlighted]:text-accent-foreground/80">
                                                {group.symbols.length} symbol{group.symbols.length === 1 ? "" : "s"}
                                            </span>
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <span>
                        {symbolModeActive
                            ? "Single symbol mode active"
                            : isLoadingFilter
                              ? "Loading watchlist feed..."
                              : `${filterLabel} / ${activeSymbols.length} symbols`}
                        {!symbolModeActive && activeSymbols.length > ALPHA_SYMBOL_LIMIT
                            ? ` / first ${ALPHA_SYMBOL_LIMIT} used for history`
                            : ""}
                    </span>
                </div>
            ) : null}

            {error ? <StateMessage tone="error" message={error} /> : null}
            {symbolError ? <StateMessage tone="error" message={symbolError} /> : null}
            {filterError ? <StateMessage tone="error" message={filterError} /> : null}
            {!error && !symbolModeActive && !symbols.length ? (
                <StateMessage message="Add symbols to a watchlist to view Alpha market intelligence." />
            ) : null}
            {!error && visibleSymbols.length ? (
                <MarketIntelligenceLiveFeed
                    activeSection={activeSection.id}
                    initialFeeds={feeds}
                    symbolMetadata={activeMetadata}
                    symbols={visibleSymbols}
                />
            ) : null}
            {children}
        </>
    );
}

function BrokerQuotePanel({
    account,
    state,
    symbol
}: {
    account: BrokerDataDefaultAccount | null;
    state: BrokerQuoteState;
    symbol: string;
}) {
    const quote = state.quote;
    return (
        <section className="border-l-2 border-primary px-4 py-3">
            <div className="flex min-w-0 flex-col gap-2 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Broker price</p>
                    <h2 className="mt-1 truncate text-lg font-semibold text-foreground">{symbol}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{defaultAccountLabel(account)}</p>
                </div>
                <div className="text-left min-[760px]:text-right">
                    <p className="text-xs text-muted-foreground">{state.isLoading ? "Fetching quote..." : "LTP"}</p>
                    <strong className="block text-3xl font-semibold text-foreground">
                        {quote ? displayValue(quote.ltp) : "-"}
                    </strong>
                </div>
            </div>
            {state.error ? <p className="mt-3 text-sm text-destructive">{state.error}</p> : null}
            {quote ? (
                <dl className="mt-4 grid gap-2 text-sm text-muted-foreground min-[620px]:grid-cols-3">
                    {quoteFieldRows(quote).map(([label, value]) => (
                        <div className="min-w-0" key={label}>
                            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {label}
                            </dt>
                            <dd className="mt-1 truncate text-foreground">{value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </section>
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
