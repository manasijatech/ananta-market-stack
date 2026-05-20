import { parseActionError } from "@/components/brokers/action-error";
import { Shell } from "@/components/brokers/ui";
import { MarketIntelligenceChrome } from "@/components/market-intelligence/market-intelligence-chrome";
import {
    ALPHA_SYMBOL_LIMIT,
    emptyMarketIntelligenceFeeds,
    symbolsFromCoverageGroups,
    watchlistCoverageGroups,
    type MarketIntelligenceFeeds
} from "@/components/market-intelligence/market-intelligence-data";
import { getAlphaAlerts } from "@/service/actions/alpha/alerts";
import { getAlphaAnnouncements } from "@/service/actions/alpha/announcements";
import { getAlphaConcalls } from "@/service/actions/alpha/concalls";
import { getAlphaEarnings } from "@/service/actions/alpha/earnings";
import { getAlphaNews } from "@/service/actions/alpha/news";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getWatchlists } from "@/service/actions/watchlist";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { Watchlist } from "@/service/types/watchlist";

function isoDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

async function loadInitialFeeds(symbols: string[]): Promise<MarketIntelligenceFeeds> {
    if (!symbols.length) return emptyMarketIntelligenceFeeds();
    const params = {
        symbols,
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

export default async function MarketIntelligenceLayout({ children }: { children: React.ReactNode }) {
    let watchlists: Watchlist[] = [];
    let error = "";

    try {
        watchlists = await getWatchlists();
    } catch (caught) {
        error = parseActionError(caught).message;
    }

    const groups = watchlistCoverageGroups(watchlists);
    const allSymbols = symbolsFromCoverageGroups(groups);
    const symbols = allSymbols.slice(0, ALPHA_SYMBOL_LIMIT);
    let symbolMetadata: Record<string, AlphaSymbolMetadata> = {};
    let initialFeeds = emptyMarketIntelligenceFeeds();

    if (!error && symbols.length) {
        try {
            const [metadata, feeds] = await Promise.all([getAlphaSymbolMetadata(symbols), loadInitialFeeds(symbols)]);
            symbolMetadata = metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
                acc[item.symbol.trim().toUpperCase()] = item;
                return acc;
            }, {});
            initialFeeds = feeds;
        } catch {
            symbolMetadata = {};
        }
    }

    return (
        <Shell>
            <MarketIntelligenceChrome
                allSymbolsCount={allSymbols.length}
                error={error}
                initialFeeds={initialFeeds}
                symbolMetadata={symbolMetadata}
                symbols={symbols}
                streamSymbols={allSymbols}
                watchlistGroups={groups}
            >
                {children}
            </MarketIntelligenceChrome>
        </Shell>
    );
}
