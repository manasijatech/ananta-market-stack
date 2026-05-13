import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { parseActionError } from "@/components/brokers/action-error";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getAlphaAlerts } from "@/service/actions/alpha/alerts";
import { getAlphaAnnouncements } from "@/service/actions/alpha/announcements";
import { getAlphaConcalls } from "@/service/actions/alpha/concalls";
import { generateAlphaDailySummary } from "@/service/actions/alpha/daily-summary";
import { getAlphaEarnings } from "@/service/actions/alpha/earnings";
import { getAlphaNews } from "@/service/actions/alpha/news";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getWatchlists } from "@/service/actions/watchlist";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { Watchlist } from "@/service/types/watchlist";

export const marketIntelligenceSections = [
 { id: "news", label: "News", description: "Latest company and market news for your watchlist symbols." },
 { id: "alerts", label: "Alerts", description: "Signal-style alerts produced by the Alpha API." },
 { id: "announcements", label: "Announcements", description: "Exchange announcements and corporate disclosures." },
 { id: "earnings", label: "Earnings", description: "Earnings-related announcements and management guidance." },
 { id: "concalls", label: "Concalls", description: "Conference call summaries, transcripts, and analysis." },
 { id: "summary", label: "Summary", description: "A generated daily brief for your watchlist symbols." }
] as const;

type AlphaSection = typeof marketIntelligenceSections[number]["id"];
type AlphaResult =
 | { kind: "news"; data: AlphaNewsItem[] }
 | { kind: "alerts"; data: AlphaAlert[] }
 | { kind: "announcements"; data: AlphaAnnouncementDetail[] }
 | { kind: "earnings"; data: AlphaAnnouncementDetail[] }
 | { kind: "concalls"; data: AlphaConcall[] }
 | { kind: "summary"; data: string };
type WatchlistCoverageGroup = {
 id: string;
 name: string;
 symbols: string[];
};

const ALPHA_SYMBOL_LIMIT = 20;

function formatDate(value?: string | null): string {
 if (!value) return "-";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return value;
 return new Intl.DateTimeFormat("en-IN", {
 dateStyle: "medium",
 timeStyle: "short"
 }).format(date);
}

function isoDateDaysAgo(days: number): string {
 const date = new Date();
 date.setDate(date.getDate() - days);
 return date.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
 return new Date().toISOString().slice(0, 10);
}

function stringifyInsight(value: unknown): string {
 if (!value) return "";
 if (typeof value === "string") return value;
 if (Array.isArray(value)) return value.map(stringifyInsight).filter(Boolean).join(" ");
 if (typeof value === "object") {
 const record = value as Record<string, unknown>;
 return stringifyInsight(record.summary ?? record.headline ?? record.text ?? record.analysis ?? JSON.stringify(value));
 }
 return String(value);
}

function watchlistCoverageGroups(watchlists: Watchlist[]): WatchlistCoverageGroup[] {
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

function symbolsFromCoverageGroups(groups: WatchlistCoverageGroup[]) {
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

function coverageGroupsForSymbols(groups: WatchlistCoverageGroup[], symbols: string[]) {
 const included = new Set(symbols);
 return groups
 .map((group) => ({
 ...group,
 symbols: group.symbols.filter((symbol) => included.has(symbol))
 }))
 .filter((group) => group.symbols.length > 0);
}

async function loadAlphaResult(section: AlphaSection, symbols: string[]): Promise<AlphaResult> {
 const params = {
 symbols,
 from: isoDateDaysAgo(30),
 to: todayIsoDate(),
 page: 1,
 limit: 20,
 detailed: true
 };

 if (section === "news") {
 const result = await getAlphaNews(params);
 return { kind: "news", data: result.data ?? [] };
 }
 if (section === "alerts") {
 const result = await getAlphaAlerts(params);
 return { kind: "alerts", data: result.data ?? [] };
 }
 if (section === "announcements") {
 const result = await getAlphaAnnouncements(params);
 return { kind: "announcements", data: result.data ?? [] };
 }
 if (section === "earnings") {
 const result = await getAlphaEarnings(params);
 return { kind: "earnings", data: result.data ?? [] };
 }
 if (section === "concalls") {
 const result = await getAlphaConcalls(params);
 return { kind: "concalls", data: result.data ?? [] };
 }

 const result = await generateAlphaDailySummary({
 portfolio: symbols.map((symbol) => ({ symbol, exposure: 0 }))
 });
 return { kind: "summary", data: result.summary ?? result.error ?? "No summary returned." };
}

export async function MarketIntelligencePage({ section }: { section: AlphaSection }) {
 const activeSection = marketIntelligenceSections.find((item) => item.id === section) ?? marketIntelligenceSections[0];
 let watchlists: Watchlist[] = [];
 let error = "";

 try {
 watchlists = await getWatchlists();
 } catch (caught) {
 error = parseActionError(caught).message;
 }

 const coverageGroups = watchlistCoverageGroups(watchlists);
 const allSymbols = symbolsFromCoverageGroups(coverageGroups);
 const symbols = allSymbols.slice(0, ALPHA_SYMBOL_LIMIT);
 const visibleCoverageGroups = coverageGroupsForSymbols(coverageGroups, symbols);
 let symbolMetadata: Record<string, AlphaSymbolMetadata> = {};
 let result: AlphaResult | null = null;

 if (!error && symbols.length) {
 try {
 const [alphaResult, metadata] = await Promise.all([
 loadAlphaResult(section, symbols),
 getAlphaSymbolMetadata(symbols)
 ]);
 result = alphaResult;
 symbolMetadata = metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
 acc[item.symbol.trim().toUpperCase()] = item;
 return acc;
 }, {});
 } catch (caught) {
 error = parseActionError(caught).message;
 }
 }

 return (
 <Shell>
 <PageHeader
 eyebrow="Alpha intelligence"
 title={activeSection.label}
 description={activeSection.description}
 />

 <nav className="mb-7 flex flex-wrap gap-2" aria-label="Market intelligence sections">
 {marketIntelligenceSections.map((item) => {
 const active = item.id === section;
 return (
 <Link
 className={[
 "px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors duration-100 ease-out",
 active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
 ].join(" ")}
 href={`/market-intelligence/${item.id}`}
 key={item.id}
 >
 {item.label}
 </Link>
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
 {allSymbols.length > symbols.length ? (
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
 {!error && symbols.length && result ? renderResult(result) : null}
 </Shell>
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

function StateMessage({
 message,
 action,
 tone = "neutral"
}: {
 message: string;
 action?: React.ReactNode;
 tone?: "neutral" | "error";
}) {
 return (
 <div className={tone === "error" ? "border-l-2 border-destructive px-4 py-3 text-sm text-destructive" : "border-l-2 border-primary px-4 py-3 text-sm text-muted-foreground"}>
 <div>{message}</div>
 {action ? <div className="mt-3">{action}</div> : null}
 </div>
 );
}

function renderResult(result: AlphaResult) {
 if (result.kind === "summary") {
 return result.data ? (
 <article className="max-w-none border-l-2 border-primary pl-4 text-sm leading-7 text-foreground">
 <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.data}</ReactMarkdown>
 </article>
 ) : <StateMessage message="No summary returned for these symbols." />;
 }

 if (!result.data.length) {
 return <StateMessage message="No Alpha records found for these watchlist symbols in the last 30 days." />;
 }

 if (result.kind === "news") return <NewsList items={result.data} />;
 if (result.kind === "alerts") return <AlertsList items={result.data} />;
 if (result.kind === "announcements") return <AnnouncementList items={result.data} fallbackTitle="Untitled announcement" />;
 if (result.kind === "earnings") return <AnnouncementList items={result.data} fallbackTitle="Earnings update" earnings />;
 return <ConcallList items={result.data} />;
}

function NewsList({ items }: { items: AlphaNewsItem[] }) {
 return (
 <div className="grid gap-4">
 {items.map((item) => (
 <article className="border-l-2 border-border pl-4" key={item.id}>
 <div className="flex items-start justify-between gap-4">
 <div className="min-w-0">
 <h2 className="truncate text-lg font-semibold text-foreground">{item.title ?? item.specific_title ?? "Untitled news"}</h2>
 <p className="mt-1 text-xs text-muted-foreground">{[item.symbol, item.source, item.sentiment, formatDate(item.date)].filter(Boolean).join(" / ")}</p>
 </div>
 {item.link ? <ExternalAnchor href={item.link} label="Open article" /> : null}
 </div>
 {item.summary ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.summary}</p> : null}
 </article>
 ))}
 </div>
 );
}

function AlertsList({ items }: { items: AlphaAlert[] }) {
 return (
 <div className="grid gap-4">
 {items.map((item) => (
 <article className="border-l-2 border-border pl-4" key={item.id}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <h2 className="font-mono text-lg font-semibold text-foreground">{item.symbol}</h2>
 <p className="text-xs text-muted-foreground">{formatDate(item.timestamp)}</p>
 </div>
 <p className="mt-2 text-sm font-medium text-foreground">{item.type ?? "Alert"}</p>
 {item.reason ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.reason}</p> : null}
 </article>
 ))}
 </div>
 );
}

function AnnouncementList({
 items,
 fallbackTitle,
 earnings = false
}: {
 items: AlphaAnnouncementDetail[];
 fallbackTitle: string;
 earnings?: boolean;
}) {
 return (
 <div className="grid gap-4">
 {items.map((item) => (
 <article className="border-l-2 border-border pl-4" key={item.id}>
 <div className="flex items-start justify-between gap-4">
 <div className="min-w-0">
 <h2 className="truncate text-lg font-semibold text-foreground">{item.headline ?? item.title ?? fallbackTitle}</h2>
 <p className="mt-1 text-xs text-muted-foreground">
 {[item.symbol, earnings && item.earnings_significant ? "significant" : item.category, formatDate(item.date)].filter(Boolean).join(" / ")}
 </p>
 </div>
 {item.attachment_url ? <ExternalAnchor href={item.attachment_url} label="Open attachment" /> : null}
 </div>
 <p className="mt-3 text-sm leading-6 text-muted-foreground">{earnings ? item.management_guidance ?? item.summary ?? "No summary provided." : item.summary ?? "No summary provided."}</p>
 </article>
 ))}
 </div>
 );
}

function ConcallList({ items }: { items: AlphaConcall[] }) {
 return (
 <div className="grid gap-4">
 {items.map((item) => {
 const href = item.transcript_pdf_links?.[0] ?? item.recording_links?.[0] ?? null;
 return (
 <article className="border-l-2 border-border pl-4" key={item.id}>
 <div className="flex items-start justify-between gap-4">
 <div className="min-w-0">
 <h2 className="font-mono text-lg font-semibold text-foreground">{item.symbol}</h2>
 <p className="mt-1 text-xs text-muted-foreground">{[item.quarter, item.month, item.concall_type, formatDate(item.date)].filter(Boolean).join(" / ")}</p>
 </div>
 {href ? <ExternalAnchor href={href} label="Open transcript" /> : null}
 </div>
 <p className="mt-3 text-sm leading-6 text-muted-foreground">{stringifyInsight(item.short_analysis ?? item.analysis ?? item.summary ?? item.completion_response) || "No analysis provided."}</p>
 </article>
 );
 })}
 </div>
 );
}

function ExternalAnchor({ href, label }: { href: string; label: string }) {
 return (
 <a className="flex size-9 shrink-0 items-center justify-center text-primary hover:bg-[var(--accent-glow)]" href={href} target="_blank" rel="noreferrer" aria-label={label}>
 <ExternalLink className="size-4" />
 </a>
 );
}
