"use client";

import { Bell, IndianRupee, Info, Megaphone, MessageSquare, Newspaper, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/brokers/ui";
import { MarketIntelligenceLiveFeed, StateMessage } from "@/components/market-intelligence/market-intelligence-live-feed";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import {
 marketIntelligenceSections,
 type AlphaSection,
 type MarketIntelligenceFeeds,
 type WatchlistCoverageGroup
} from "@/components/market-intelligence/market-intelligence-data";

const sectionChrome = {
 news: {
  icon: Newspaper,
  helpTitle: "Understanding News",
  helpBody: "Market news and company-specific coverage from media sources. Use it for external context around price action, sentiment, and public market narratives."
 },
 announcements: {
  icon: Megaphone,
  helpTitle: "Understanding Announcements",
  helpBody: "Official exchange and company disclosures, including board updates, corporate actions, regulatory filings, and other company-published events."
 },
 earnings: {
  icon: IndianRupee,
  helpTitle: "Understanding Earnings",
  helpBody: "Earnings-related disclosures and management guidance. These records highlight result updates and material financial context."
 },
 concalls: {
  icon: MessageSquare,
  helpTitle: "Understanding Concalls",
  helpBody: "Conference call summaries, transcripts, and management commentary from investor calls. Transcript and audio actions appear when the feed includes those links."
 },
 alerts: {
  icon: Bell,
  helpTitle: "Understanding Alerts",
  helpBody: "Signal-style market alerts for price moves, volume spikes, 52-week levels, earnings, announcements, and other notable events."
 }
} satisfies Record<AlphaSection, { icon: LucideIcon; helpTitle: string; helpBody: string }>;

export function MarketIntelligenceChrome({
 children,
 error,
 initialFeeds,
 symbolMetadata,
 symbols,
 streamSymbols
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
 return (
 <>
 <PageHeader
 eyebrow="Alpha intelligence"
 title={activeSection.label}
 description={activeSection.description}
 />

 <div className="mb-5 flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
 <nav className="flex flex-wrap gap-1.5" aria-label="Market intelligence sections">
 {marketIntelligenceSections.map((item) => {
 const active = item.id === activeSection.id;
 const Icon = sectionChrome[item.id].icon;
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
 <Icon className="size-3.5" />
 {item.label}
 </Button>
 );
 })}
 </nav>
 <Dialog>
 <DialogTrigger asChild>
 <button
 aria-label={`Learn about ${activeSection.label}`}
 className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
 type="button"
 >
 <Info className="size-4" />
 </button>
 </DialogTrigger>
 <DialogContent className="max-w-md p-6">
 <DialogHeader>
 <DialogTitle>{sectionChrome[activeSection.id].helpTitle}</DialogTitle>
 </DialogHeader>
 <p className="text-sm leading-6 text-muted-foreground">{sectionChrome[activeSection.id].helpBody}</p>
 </DialogContent>
 </Dialog>
 </div>

 {error ? <StateMessage tone="error" message={error} /> : null}
 {!error && !symbols.length ? (
 <StateMessage message="Add symbols to a watchlist to view Alpha market intelligence." />
 ) : null}
 {!error && symbols.length ? <MarketIntelligenceLiveFeed activeSection={activeSection.id} initialFeeds={initialFeeds} symbolMetadata={symbolMetadata} symbols={streamSymbols} /> : null}
 {children}
 </>
 );
}
