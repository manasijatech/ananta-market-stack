import { parseActionError } from "@/components/brokers/action-error";
import { MarketIntelligenceChrome } from "@/components/market-intelligence/market-intelligence-chrome";
import {
    ALPHA_METADATA_BATCH_SIZE,
    emptyMarketIntelligenceFeeds,
    emptyMarketIntelligenceHasMore,
    symbolsFromCoverageGroups,
    watchlistCoverageGroups,
    type MarketIntelligenceFeeds,
    type MarketIntelligenceHasMore,
} from "@/components/market-intelligence/market-intelligence-data";
import { getCachedAlphaFeed } from "@/service/actions/alpha/feeds";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getWatchlists } from "@/service/actions/watchlist";
import { getAlphaCreditWarningMessage } from "@/lib/alpha-credit-warning";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail, AlphaEarningsDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
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

type InitialFeedsResult = {
    creditWarningMessage: string | null;
    feeds: MarketIntelligenceFeeds;
    hasMoreBySection: MarketIntelligenceHasMore;
};

function hasMoreFromResponse(
    result: PromiseSettledResult<{ has_next?: boolean }>
): boolean {
    return result.status === "fulfilled" ? Boolean(result.value.has_next) : false;
}

async function loadAllSymbolMetadata(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
    if (!symbols.length) return [];
    const chunks: string[][] = [];
    for (let index = 0; index < symbols.length; index += ALPHA_METADATA_BATCH_SIZE) {
        chunks.push(symbols.slice(index, index + ALPHA_METADATA_BATCH_SIZE));
    }
    const batches = await Promise.allSettled(chunks.map((chunk) => getAlphaSymbolMetadata(chunk)));
    return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
}

async function loadInitialFeeds(symbols: string[]): Promise<InitialFeedsResult> {
    if (!symbols.length) {
        return {
            creditWarningMessage: null,
            feeds: emptyMarketIntelligenceFeeds(),
            hasMoreBySection: emptyMarketIntelligenceHasMore()
        };
    }
    const params = {
        // Full watchlist universe; backend refreshes every stale/missing symbol (batched).
        symbols,
        from: isoDateDaysAgo(30),
        to: todayIsoDate(),
        page: 1,
        limit: 20,
        detailed: true
    };
    const [news, announcements, earnings, concalls, alerts] = await Promise.allSettled([
        getCachedAlphaFeed<AlphaNewsItem>("news", params),
        getCachedAlphaFeed<AlphaAnnouncementDetail>("announcements", params),
        getCachedAlphaFeed<AlphaEarningsDetail>("earnings", params),
        getCachedAlphaFeed<AlphaConcall>("concalls", params),
        getCachedAlphaFeed<AlphaAlert>("alerts", params)
    ]);

    return {
        creditWarningMessage: getAlphaCreditWarningMessage(news, announcements, earnings, concalls, alerts),
        feeds: {
            news: news.status === "fulfilled" ? (news.value.data ?? []) : [],
            announcements: announcements.status === "fulfilled" ? (announcements.value.data ?? []) : [],
            earnings: earnings.status === "fulfilled" ? (earnings.value.data ?? []) : [],
            concalls: concalls.status === "fulfilled" ? (concalls.value.data ?? []) : [],
            alerts: alerts.status === "fulfilled" ? (alerts.value.data ?? []) : []
        },
        hasMoreBySection: {
            news: hasMoreFromResponse(news),
            announcements: hasMoreFromResponse(announcements),
            earnings: hasMoreFromResponse(earnings),
            concalls: hasMoreFromResponse(concalls),
            alerts: hasMoreFromResponse(alerts)
        }
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
    const symbols = allSymbols;
    let symbolMetadata: Record<string, AlphaSymbolMetadata> = {};
    let initialFeeds = emptyMarketIntelligenceFeeds();
    let initialHasMoreBySection = emptyMarketIntelligenceHasMore();
    let creditWarningMessage: string | null = null;

    if (!error && symbols.length) {
        const [metadataResult, feedsResult] = await Promise.allSettled([
            loadAllSymbolMetadata(symbols),
            loadInitialFeeds(symbols)
        ]);

        creditWarningMessage =
            getAlphaCreditWarningMessage(metadataResult, feedsResult) ??
            (feedsResult.status === "fulfilled" ? feedsResult.value.creditWarningMessage : null);

        if (metadataResult.status === "fulfilled") {
            const metadata = metadataResult.value;
            symbolMetadata = metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
                const symbol = item.symbol?.trim().toUpperCase();
                if (symbol) acc[symbol] = item;
                return acc;
            }, {});
        }

        if (feedsResult.status === "fulfilled") {
            initialFeeds = feedsResult.value.feeds;
            initialHasMoreBySection = feedsResult.value.hasMoreBySection;
        }
    }

    return (
        <>
            <MarketIntelligenceChrome
                allSymbolsCount={allSymbols.length}
                error={error}
                creditWarningMessage={creditWarningMessage}
                initialFeeds={initialFeeds}
                initialHasMoreBySection={initialHasMoreBySection}
                symbolMetadata={symbolMetadata}
                symbols={symbols}
                streamSymbols={allSymbols}
                watchlistGroups={groups}
            >
                {children}
            </MarketIntelligenceChrome>
        </>
    );
}
