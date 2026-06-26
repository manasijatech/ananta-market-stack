"use client";

import {
    Bell,
    IndianRupee,
    Info,
    Megaphone,
    MessageSquare,
    Newspaper,
    Search,
    type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { parseActionError } from "@/components/brokers/action-error";
import { PageHeader } from "@/components/brokers/ui";
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
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogPanel, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { getBrokerDataDefaultConfig } from "@/service/actions/broker";
import type { BrokerDataDefaultAccount } from "@/service/types/broker";
import { getAlphaCreditWarningMessage, notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";
import { cn } from "@/lib/utils";
import {
    ALPHA_SYMBOL_LIMIT,
    emptyMarketIntelligenceFeeds,
    marketIntelligenceProducts,
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
    const activeSection =
        marketIntelligenceSections.find((item) => item.id === activeSectionId) ?? marketIntelligenceSections[0];
    const selectedWatchlist = watchlistGroups.find((item) => item.id === selectedWatchlistId) ?? null;
    const activeSymbols = useMemo(
        () => (selectedWatchlist ? selectedWatchlist.symbols : streamSymbols),
        [selectedWatchlist, streamSymbols]
    );
    const selectedWatchlistLabel =
        selectedWatchlistId === ALL_WATCHLISTS_ID
            ? `All watchlists (${allSymbolsCount} symbols)`
            : selectedWatchlist
              ? `${selectedWatchlist.name} (${selectedWatchlist.symbols.length} symbols)`
              : "Select watchlist";

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
    }, [activeSymbols, initialFeeds, selectedWatchlistId, symbolMetadata]);

    return (
        <>
            <AlphaCreditWarningTrigger message={creditWarningMessage} />
            <PageHeader
                action={
                    !isLoadingBrokerConfig && !defaultBrokerAccount ? (
                        <Badge className="w-fit shrink-0" size="sm" variant="warning">
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
                    className="-mx-1 flex min-w-0 snap-x snap-mandatory gap-1 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] min-[920px]:flex-wrap min-[920px]:overflow-visible [&::-webkit-scrollbar]:hidden"
                    aria-label="Market intelligence sections"
                >
                    {marketIntelligenceSections.map((item) => {
                        const active = item.id === activeSection.id;
                        const Icon = sectionChrome[item.id].icon;
                        return (
                            <button
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                    "inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors sm:min-h-0",
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

                <div className="flex min-w-0 items-center gap-2 min-[920px]:w-[min(42vw,420px)] min-[920px]:shrink-0">
                    <Search className="hidden size-4 shrink-0 text-muted-foreground min-[480px]:block" />
                    <FeedSearchInput onChange={setFeedSearch} placeholder="Search symbol" value={feedSearch} />
                    <Dialog>
                        <DialogTrigger
                            render={
                                <button
                                    aria-label="Learn about market intelligence"
                                    className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
                                    type="button"
                                >
                                    <Info className="size-4" />
                                </button>
                            }
                        />
                        <DialogContent className="max-w-xl">
                            <DialogHeader>
                                <DialogTitle>Understanding Market Intelligence</DialogTitle>
                            </DialogHeader>
                            <DialogPanel>
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
                            </DialogPanel>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {watchlistGroups.length ? (
                <div className="mb-4 flex min-w-0 flex-col gap-2 text-xs text-muted-foreground min-[640px]:flex-row min-[640px]:flex-wrap min-[640px]:items-center min-[640px]:gap-x-3 min-[640px]:gap-y-2">
                    <WatchlistScopeTooltip historyLimit={ALPHA_SYMBOL_LIMIT} symbolCount={allSymbolsCount}>
                        <Select
                            disabled={isLoadingFilter}
                            onValueChange={(value) => {
                                if (value) setSelectedWatchlistId(value);
                            }}
                            value={selectedWatchlistId}
                        >
                            <SelectTrigger
                                aria-label="Filter market intelligence by watchlist"
                                className="h-9 w-full min-w-0 bg-background text-xs min-[640px]:h-8 min-[640px]:max-w-sm min-[640px]:w-auto"
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
                    </WatchlistScopeTooltip>

                    <span className="hidden text-border min-[640px]:inline">·</span>
                    <LiveStatusPill state={socketState} />
                    <span className="hidden text-border min-[640px]:inline">·</span>
                    <span className="min-w-0">
                        {marketIntelligenceProducts.length} products · {activeSymbols.length} symbols
                        {isLoadingFilter ? " · Loading…" : ""}
                    </span>
                </div>
            ) : null}

            {error ? <StateMessage message={error} tone="error" /> : null}
            {filterError ? <StateMessage message={filterError} tone="error" /> : null}
            {!error && !activeSymbols.length ? (
                <StateMessage message="Add symbols to a watchlist to view Alpha market intelligence." />
            ) : null}
            {!error && activeSymbols.length ? (
                <MarketIntelligenceLiveFeed
                    activeSection={activeSection.id}
                    feedSearch={feedSearch}
                    initialFeeds={feeds}
                    onFeedSearchSymbol={setFeedSearch}
                    onSocketStateChange={setSocketState}
                    symbolMetadata={activeMetadata}
                    symbols={activeSymbols}
                />
            ) : null}
            {children}
        </>
    );
}
