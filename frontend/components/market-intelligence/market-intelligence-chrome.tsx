"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/brokers/ui";
import { MarketIntelligenceLiveFeed, StateMessage } from "@/components/market-intelligence/market-intelligence-live-feed";
import { Button } from "@/components/ui/button";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import {
 ALPHA_SYMBOL_LIMIT,
 coverageGroupsForSymbols,
 marketIntelligenceSections,
 type AlphaSection,
 type MarketIntelligenceFeeds,
 type WatchlistCoverageGroup
} from "@/components/market-intelligence/market-intelligence-data";

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
 const activeSection = marketIntelligenceSections.find((item) => item.id === activeSectionId) ?? marketIntelligenceSections[0];
 const visibleCoverageGroups = coverageGroupsForSymbols(watchlistGroups, symbols);

 return (
 <>
 <PageHeader
 eyebrow="Alpha intelligence"
 title={activeSection.label}
 description={activeSection.description}
 />

 <nav className="mb-7 flex flex-wrap gap-2" aria-label="Market intelligence sections">
 {marketIntelligenceSections.map((item) => {
 const active = item.id === activeSection.id;
 return (
 <Button
 className={[
 "px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]",
 active ? "" : "text-muted-foreground hover:text-foreground"
 ].join(" ")}
 key={item.id}
 onClick={() => setActiveSectionId(item.id)}
 size="sm"
 type="button"
 aria-pressed={active}
 variant={active ? "default" : "secondary"}
 >
 {item.label}
 </Button>
 );
 })}
 </nav>

 <section className="mb-7 border-y border-border py-5">
 <div className="flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
 <div>
 <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Watchlist Coverage</div>
 <div className="mt-1 text-sm text-muted-foreground">
 {symbols.length ? `${symbols.length} symbols / last 30 days / page size 20` : "No watchlist symbols available"}
 </div>
 </div>
 {allSymbolsCount > symbols.length ? (
 <div className="border-l-2 border-amber-500 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
 Alpha API requests are capped to the first {ALPHA_SYMBOL_LIMIT} symbols in watchlist order.
 </div>
 ) : null}
 </div>
 {symbols.length ? (
 <div className="mt-4 grid gap-2">
 {visibleCoverageGroups.map((group) => (
 <div className="flex flex-col gap-2 border-l-2 border-border pl-3 min-[760px]:flex-row min-[760px]:items-center" key={group.id}>
 <div className="min-w-0 shrink-0 min-[760px]:w-40">
 <div className="truncate text-sm font-semibold leading-5 text-foreground">{group.name}</div>
 <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
 {group.symbols.length} {group.symbols.length === 1 ? "symbol" : "symbols"}
 </div>
 </div>
 <div className="flex flex-wrap gap-x-5 gap-y-3">
 {group.symbols.map((symbol) => (
 <SymbolBadge key={`${group.id}:${symbol}`} metadata={symbolMetadata[symbol]} symbol={symbol} />
 ))}
 </div>
 </div>
 ))}
 </div>
 ) : null}
 </section>

 {error ? <StateMessage tone="error" message={error} /> : null}
 {!error && !symbols.length ? (
 <StateMessage message="Add symbols to a watchlist to view Alpha market intelligence." action={<Link className="font-semibold text-primary hover:underline" href="/watchlists">Open watchlists</Link>} />
 ) : null}
 {!error && symbols.length ? <MarketIntelligenceLiveFeed activeSection={activeSection.id} initialFeeds={initialFeeds} symbols={streamSymbols} /> : null}
 {children}
 </>
 );
}

function SymbolBadge({ symbol, metadata }: { symbol: string; metadata?: AlphaSymbolMetadata }) {
 const label = metadata?.company_name?.trim() || symbol;
 return (
 <span className="inline-flex max-w-[260px] items-center gap-2.5">
 {metadata?.logo ? (
 <img alt="" className="size-8 shrink-0 border border-border bg-background object-contain" src={metadata.logo} />
 ) : (
 <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
 {symbol.slice(0, 2)}
 </span>
 )}
 <span className="min-w-0">
 <span className="block truncate text-sm font-semibold leading-5 text-foreground">{label}</span>
 <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{symbol}</span>
 </span>
 </span>
 );
}
