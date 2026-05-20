import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import type { Watchlist } from "@/service/types/watchlist";

export const marketIntelligenceSections = [
    { id: "news", label: "News", description: "Market news and company-specific updates." },
    { id: "announcements", label: "Announcements", description: "Exchange announcements and corporate disclosures." },
    { id: "earnings", label: "Earnings", description: "Earnings-related announcements and management guidance." },
    { id: "concalls", label: "Concalls", description: "Conference call summaries, transcripts, and analysis." },
    { id: "alerts", label: "Alerts", description: "Signal-style alerts produced by the Alpha API." }
] as const;

export const marketIntelligenceProducts = ["news", "announcements", "earnings", "concalls", "alerts"] as const;

export type AlphaSection = (typeof marketIntelligenceSections)[number]["id"];
export type MarketIntelligenceProduct = (typeof marketIntelligenceProducts)[number];

export type WatchlistCoverageGroup = {
    id: string;
    name: string;
    symbols: string[];
};

export type MarketIntelligenceFeeds = {
    news: AlphaNewsItem[];
    announcements: AlphaAnnouncementDetail[];
    earnings: AlphaAnnouncementDetail[];
    concalls: AlphaConcall[];
    alerts: AlphaAlert[];
};

export const ALPHA_SYMBOL_LIMIT = 20;

export function emptyMarketIntelligenceFeeds(): MarketIntelligenceFeeds {
    return {
        news: [],
        announcements: [],
        earnings: [],
        concalls: [],
        alerts: []
    };
}

export function watchlistCoverageGroups(watchlists: Watchlist[]): WatchlistCoverageGroup[] {
    return watchlists.map((watchlist) => {
        const seen = new Set<string>();
        const source = watchlist.items.length ? watchlist.items.map((item) => item.symbol) : watchlist.symbols;
        return {
            id: watchlist.id,
            name: watchlist.name,
            symbols: source.reduce<string[]>((acc, value) => {
                const symbol = value.trim().toUpperCase();
                if (!symbol || seen.has(symbol)) return acc;
                seen.add(symbol);
                acc.push(symbol);
                return acc;
            }, [])
        };
    });
}

export function symbolsFromCoverageGroups(groups: WatchlistCoverageGroup[]) {
    const seen = new Set<string>();
    const symbols: string[] = [];

    for (const group of groups) {
        for (const symbol of group.symbols) {
            if (!symbol || seen.has(symbol)) continue;
            seen.add(symbol);
            symbols.push(symbol);
        }
    }

    return symbols;
}

export function coverageGroupsForSymbols(groups: WatchlistCoverageGroup[], symbols: string[]) {
    const included = new Set(symbols);
    return groups
        .map((group) => ({
            ...group,
            symbols: group.symbols.filter((symbol) => included.has(symbol))
        }))
        .filter((group) => group.symbols.length > 0);
}
