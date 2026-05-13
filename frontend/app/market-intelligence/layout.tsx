import { parseActionError } from "@/components/brokers/action-error";
import { Shell } from "@/components/brokers/ui";
import { MarketIntelligenceChrome } from "@/components/market-intelligence/market-intelligence-chrome";
import {
 ALPHA_SYMBOL_LIMIT,
 symbolsFromCoverageGroups,
 watchlistCoverageGroups
} from "@/components/market-intelligence/market-intelligence-page";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getWatchlists } from "@/service/actions/watchlist";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { Watchlist } from "@/service/types/watchlist";

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

 if (!error && symbols.length) {
 try {
 const metadata = await getAlphaSymbolMetadata(symbols);
 symbolMetadata = metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
 acc[item.symbol.trim().toUpperCase()] = item;
 return acc;
 }, {});
 } catch {
 symbolMetadata = {};
 }
 }

 return (
 <Shell>
 <MarketIntelligenceChrome
 allSymbolsCount={allSymbols.length}
 error={error}
 symbolMetadata={symbolMetadata}
 symbols={symbols}
 watchlistGroups={groups}
 >
 {children}
 </MarketIntelligenceChrome>
 </Shell>
 );
}
