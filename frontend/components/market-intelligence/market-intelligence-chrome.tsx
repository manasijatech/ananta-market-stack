"use client";

import { Bell, Filter, IndianRupee, Info, Megaphone, MessageSquare, Newspaper, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parseActionError } from "@/components/brokers/action-error";
import { PageHeader } from "@/components/brokers/ui";
import {
    MarketIntelligenceLiveFeed,
    StateMessage
} from "@/components/market-intelligence/market-intelligence-live-feed";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { getAlphaAlerts } from "@/service/actions/alpha/alerts";
import { getAlphaAnnouncements } from "@/service/actions/alpha/announcements";
import { getAlphaConcalls } from "@/service/actions/alpha/concalls";
import { getAlphaEarnings } from "@/service/actions/alpha/earnings";
import { getAlphaNews } from "@/service/actions/alpha/news";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
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
        acc[item.symbol.trim().toUpperCase()] = item;
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
    error,
    initialFeeds,
    symbolMetadata,
    symbols,
    streamSymbols,
    watchlistGroups
}: {
    allSymbolsCount: number;
    children: React.ReactNode;
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
    const [filterError, setFilterError] = useState("");
    const [isLoadingFilter, setIsLoadingFilter] = useState(false);
    const activeSection =
        marketIntelligenceSections.find((item) => item.id === activeSectionId) ?? marketIntelligenceSections[0];
    const selectedWatchlist = watchlistGroups.find((item) => item.id === selectedWatchlistId) ?? null;
    const activeSymbols = useMemo(
        () => (selectedWatchlist ? selectedWatchlist.symbols : streamSymbols),
        [selectedWatchlist, streamSymbols]
    );
    const filterLabel = selectedWatchlist ? selectedWatchlist.name : "All watchlists";

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
            try {
                const [nextMetadata, nextFeeds] = await Promise.all([
                    getAlphaSymbolMetadata(activeSymbols),
                    loadFeeds(activeSymbols)
                ]);
                if (cancelled) return;
                setActiveMetadata(metadataBySymbol(nextMetadata));
                setFeeds(nextFeeds);
            } catch (caught) {
                if (!cancelled) setFilterError(parseActionError(caught).message);
            } finally {
                if (!cancelled) setIsLoadingFilter(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [activeSymbols, initialFeeds, selectedWatchlistId, symbolMetadata]);

    return (
        <>
            <PageHeader
                eyebrow="Alpha intelligence"
                title="Market Intelligence"
                description={activeSection.description}
            />

            <div className="mb-5 flex min-w-0 flex-col gap-3 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
                <nav
                    className="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-1 min-[760px]:mx-0 min-[760px]:flex-wrap min-[760px]:overflow-visible min-[760px]:px-0 min-[760px]:pb-0"
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
                <Dialog>
                    <DialogTrigger asChild>
                        <button
                            aria-label="Learn about market intelligence"
                            className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
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
                                    <h3 className="text-sm font-semibold leading-5 text-foreground">{item.title}</h3>
                                    <p>{item.body}</p>
                                </section>
                            ))}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {watchlistGroups.length ? (
                <div className="mb-5 flex flex-col gap-2 border-y border-border py-3 text-xs text-muted-foreground min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                        <Filter className="size-4 shrink-0 text-primary" />
                        <span className="shrink-0 font-semibold uppercase tracking-[0.16em] text-primary">
                            Watchlist
                        </span>
                        <Select
                            aria-label="Filter market intelligence by watchlist"
                            className="h-9 max-w-sm rounded-none text-xs"
                            disabled={isLoadingFilter}
                            onChange={(event) => setSelectedWatchlistId(event.target.value)}
                            value={selectedWatchlistId}
                        >
                            <option value={ALL_WATCHLISTS_ID}>All watchlists ({allSymbolsCount} symbols)</option>
                            {watchlistGroups.map((group) => (
                                <option key={group.id} value={group.id}>
                                    {group.name} ({group.symbols.length})
                                </option>
                            ))}
                        </Select>
                    </label>
                    <span>
                        {isLoadingFilter
                            ? "Loading watchlist feed..."
                            : `${filterLabel} / ${activeSymbols.length} symbols`}
                        {activeSymbols.length > ALPHA_SYMBOL_LIMIT
                            ? ` / first ${ALPHA_SYMBOL_LIMIT} used for history`
                            : ""}
                    </span>
                </div>
            ) : null}

            {error ? <StateMessage tone="error" message={error} /> : null}
            {filterError ? <StateMessage tone="error" message={filterError} /> : null}
            {!error && !symbols.length ? (
                <StateMessage message="Add symbols to a watchlist to view Alpha market intelligence." />
            ) : null}
            {!error && symbols.length ? (
                <MarketIntelligenceLiveFeed
                    activeSection={activeSection.id}
                    initialFeeds={feeds}
                    symbolMetadata={activeMetadata}
                    symbols={activeSymbols}
                />
            ) : null}
            {children}
        </>
    );
}
