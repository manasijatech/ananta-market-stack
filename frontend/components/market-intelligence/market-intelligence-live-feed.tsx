"use client";

import {
 AlertCircle,
 Bell,
 Check,
 ExternalLink,
 FileText,
 GlassWater,
 IndianRupee,
 Megaphone,
 MessageSquare,
 Newspaper,
 Phone,
 Play,
 TrendingDown,
 TrendingUp,
 type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAlphaWebSocketConfig } from "@/service/actions/alpha/websocket";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { JsonValue } from "@/service/types/broker";
import {
 marketIntelligenceProducts,
 type AlphaSection,
 type MarketIntelligenceFeeds,
 type MarketIntelligenceProduct
} from "@/components/market-intelligence/market-intelligence-data";

const MAX_FEED_ITEMS = 50;

const emptyLiveUpdateCounts = {
 news: 0,
 announcements: 0,
 earnings: 0,
 concalls: 0,
 alerts: 0
} satisfies Record<AlphaSection, number>;

type SocketState = "connecting" | "live" | "offline";

type IncomingEnvelope = {
 channel?: string;
 data?: unknown;
 error?: string;
 status?: string;
 product?: string;
};

type RecordValue = Record<string, unknown>;

type AlertTypeConfig = {
 name: string;
 icon: LucideIcon;
 color: string;
};

const alertTypeConfig = {
 earnings: {
  name: "Earnings / Results",
  icon: IndianRupee,
  color: "#FFC107"
 },
 high_growth_concalls: {
  name: "Concall Alerts",
  icon: Phone,
  color: "#6F42C1"
 },
 corp_announcement: {
  name: "Announcements",
  icon: Megaphone,
  color: "#F97316"
 },
 price_alert: {
  name: "Price Alert",
  icon: AlertCircle,
  color: "#17A2B8"
 },
 "52w_high_60": {
  name: "52w High",
  icon: TrendingUp,
  color: "#28A745"
 },
 volume_alert: {
  name: "Volume Alert",
  icon: GlassWater,
  color: "#007AFF"
 },
 rvol_alert: {
  name: "Volume Alert",
  icon: GlassWater,
  color: "#007AFF"
 },
 "52w_low_60": {
  name: "52w Low",
  icon: TrendingDown,
  color: "#28A745"
 }
} satisfies Record<string, AlertTypeConfig>;

const fallbackAlertTypeConfig = {
 name: "Alert",
 icon: Bell,
 color: "#6C757D"
} satisfies AlertTypeConfig;

const sectionVisuals = {
 news: {
  icon: Newspaper,
  title: "No News Found",
  description: "No Alpha news records matched these watchlist symbols in the last 30 days."
 },
 announcements: {
  icon: Megaphone,
  title: "No Announcements Found",
  description: "No exchange announcement records matched these watchlist symbols in the last 30 days."
 },
 earnings: {
  icon: IndianRupee,
  title: "No Earnings Found",
  description: "No earnings-related announcement records matched these watchlist symbols in the last 30 days."
 },
 concalls: {
  icon: MessageSquare,
  title: "No Concalls Found",
  description: "No conference call summaries or transcript records matched these watchlist symbols in the last 30 days."
 },
 alerts: {
  icon: Bell,
  title: "No Alerts Found",
  description: "No signal-style alert records matched these watchlist symbols in the last 30 days."
 }
} satisfies Record<AlphaSection, { icon: LucideIcon; title: string; description: string }>;

function isRecord(value: unknown): value is RecordValue {
 return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMarketProduct(value: unknown): value is MarketIntelligenceProduct {
 return typeof value === "string" && marketIntelligenceProducts.includes(value as MarketIntelligenceProduct);
}

function sectionFromProduct(product: MarketIntelligenceProduct): AlphaSection {
 return product === "announcements" ? "announcements" : product;
}

function formatDate(value?: string | null): string {
 if (!value) return "-";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return value;
 return new Intl.DateTimeFormat("en-IN", {
 dateStyle: "medium",
 timeStyle: "short"
 }).format(date);
}

function labelFromInsightKey(key: string): string {
 return key
 .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
 .replace(/[_-]+/g, " ")
 .replace(/\s+/g, " ")
 .trim()
 .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseJsonInsight(value: string): JsonValue | null {
 const trimmed = value.trim();
 if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;

 try {
 return JSON.parse(trimmed) as JsonValue;
 } catch {
 return null;
 }
}

function insightToMarkdown(value: JsonValue | undefined | null): string {
 if (!value) return "";
 if (typeof value === "string") {
 const parsed = parseJsonInsight(value);
 if (parsed) return insightToMarkdown(parsed);
 return value.replace(/\\n/g, "\n").trim();
 }
 if (Array.isArray(value)) return value.map(insightToMarkdown).filter(Boolean).join("\n\n");
 if (typeof value === "object") {
 const record = value as Record<string, JsonValue>;
 const preferred = record.summary ?? record.headline ?? record.text;
 if (preferred) return insightToMarkdown(preferred);

 const sections = Object.entries(record)
 .map(([key, fieldValue]) => {
 const markdown = insightToMarkdown(fieldValue);
 if (!markdown) return "";
 return `**${labelFromInsightKey(key)}**\n\n${markdown}`;
 })
 .filter(Boolean);

 return sections.join("\n\n");
 }
 return String(value);
}

function initialSocketLabel(state: SocketState) {
 if (state === "live") return "Live via full-market websocket";
 if (state === "connecting") return "Connecting full-market websocket";
 return "Websocket offline";
}

function itemKey(item: unknown): string {
 if (!isRecord(item)) return JSON.stringify(item);
 const directId = item.id ?? item._id;
 if (typeof directId === "string" && directId.trim()) return directId;
 return [
 item.symbol,
 item.nse,
 item.date,
 item.timestamp,
 item.headline,
 item.title,
 item.type,
 item.reason
 ].filter(Boolean).join(":") || JSON.stringify(item).slice(0, 300);
}

function getAlertTypeConfig(type?: string | null) {
 if (!type) return fallbackAlertTypeConfig;
 return alertTypeConfig[type as keyof typeof alertTypeConfig] ?? {
  ...fallbackAlertTypeConfig,
  name: labelFromInsightKey(type)
 };
}

function normalizeIncomingData(value: unknown): unknown {
 if (!isRecord(value)) return value;
 if (isRecord(value.payload)) return value.payload;
 return value;
}

function collectSymbols(value: unknown, symbols: Set<string>) {
 if (Array.isArray(value)) {
 for (const item of value) collectSymbols(item, symbols);
 return;
 }
 if (!isRecord(value)) return;

 for (const key of ["symbol", "symbols", "nse"]) {
 const raw = value[key];
 if (typeof raw === "string") {
 for (const part of raw.replace(",", ":").split(":")) {
 const symbol = part.trim().toUpperCase();
 if (symbol) symbols.add(symbol);
 }
 }
 if (Array.isArray(raw)) {
 for (const item of raw) collectSymbols(item, symbols);
 }
 }

 for (const key of ["payload", "data"]) {
 if (value[key] !== undefined) collectSymbols(value[key], symbols);
 }
}

function itemMatchesWatchlist(item: unknown, watchlistSymbols: Set<string>) {
 if (!watchlistSymbols.size) return true;
 const itemSymbols = new Set<string>();
 collectSymbols(item, itemSymbols);
 if (!itemSymbols.size) return false;
 for (const symbol of itemSymbols) {
 if (watchlistSymbols.has(symbol)) return true;
 }
 return false;
}

function mergeItem<T>(items: T[], item: T) {
 const nextKey = itemKey(item);
 return [item, ...items.filter((existing) => itemKey(existing) !== nextKey)].slice(0, MAX_FEED_ITEMS);
}

export function MarketIntelligenceLiveFeed({
 activeSection,
 initialFeeds,
 symbolMetadata,
 symbols
}: {
 activeSection: AlphaSection;
 initialFeeds: MarketIntelligenceFeeds;
 symbolMetadata: Record<string, AlphaSymbolMetadata>;
 symbols: string[];
}) {
 const [feeds, setFeeds] = useState(initialFeeds);
 const [liveUpdateCounts, setLiveUpdateCounts] = useState<Record<AlphaSection, number>>(emptyLiveUpdateCounts);
 const [socketState, setSocketState] = useState<SocketState>("connecting");
 const [socketError, setSocketError] = useState("");
 const watchlistSymbols = useMemo(() => new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)), [symbols]);

 useEffect(() => {
 let socket: WebSocket | null = null;
 let cancelled = false;

 async function connect() {
 try {
 const config = await getAlphaWebSocketConfig([...marketIntelligenceProducts]);
 if (cancelled) return;
 socket = new WebSocket(config.url);

 socket.onopen = () => {
 if (cancelled || !socket) return;
 setSocketState("live");
 setSocketError("");
 const subscribedSymbols = Array.from(watchlistSymbols);
 for (const product of marketIntelligenceProducts) {
 socket.send(JSON.stringify({ op: "subscribe", product, symbols: subscribedSymbols }));
 }
 };

 socket.onmessage = (event) => {
 let parsed: IncomingEnvelope;
 try {
 parsed = JSON.parse(String(event.data)) as IncomingEnvelope;
 } catch {
 return;
 }

 if (parsed.error) {
 setSocketError(parsed.error);
 return;
 }
 if (!isMarketProduct(parsed.channel)) return;

 const item = normalizeIncomingData(parsed.data);
 if (!itemMatchesWatchlist(item, watchlistSymbols)) return;
 const section = sectionFromProduct(parsed.channel);

 setLiveUpdateCounts((current) => ({ ...current, [section]: current[section] + 1 }));
 setFeeds((current) => {
 if (parsed.channel === "news") {
 return { ...current, news: mergeItem(current.news, item as AlphaNewsItem) };
 }
 if (parsed.channel === "alerts") {
 return { ...current, alerts: mergeItem(current.alerts, item as AlphaAlert) };
 }
 if (parsed.channel === "concalls") {
 return { ...current, concalls: mergeItem(current.concalls, item as AlphaConcall) };
 }
 if (parsed.channel === "earnings") {
 return { ...current, earnings: mergeItem(current.earnings, item as AlphaAnnouncementDetail) };
 }
 return { ...current, announcements: mergeItem(current.announcements, item as AlphaAnnouncementDetail) };
 });
 };

 socket.onerror = () => {
 setSocketState("offline");
 setSocketError("Could not keep the Alpha websocket connected.");
 };

 socket.onclose = () => {
 if (!cancelled) setSocketState("offline");
 };
 } catch (caught) {
 if (!cancelled) {
 setSocketState("offline");
 setSocketError(caught instanceof Error ? caught.message : "Could not connect to the Alpha websocket.");
 }
 }
 }

 connect();

 return () => {
 cancelled = true;
 socket?.close();
 };
 }, [watchlistSymbols]);

 return (
 <div className="grid gap-5">
 <div className="flex flex-col gap-2 border-y border-border py-3 text-xs text-muted-foreground min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
 <span className="font-semibold uppercase tracking-[0.16em] text-primary">{initialSocketLabel(socketState)}</span>
 <span>{marketIntelligenceProducts.length} products subscribed / {symbols.length} watchlist symbols</span>
 </div>
 {socketError ? <StateMessage tone="error" message={socketError} /> : null}
 {liveUpdateCounts[activeSection] ? (
 <LiveUpdateStrip
 count={liveUpdateCounts[activeSection]}
 section={activeSection}
 onAcknowledge={() => setLiveUpdateCounts((current) => ({ ...current, [activeSection]: 0 }))}
 />
 ) : null}
 <MarketIntelligenceSection section={activeSection} feeds={feeds} symbolMetadata={symbolMetadata} />
 </div>
 );
}

function MarketIntelligenceSection({
 section,
 feeds,
 symbolMetadata
}: {
 section: AlphaSection;
 feeds: MarketIntelligenceFeeds;
 symbolMetadata: Record<string, AlphaSymbolMetadata>;
}) {
 if (section === "news") return <NewsList items={feeds.news} symbolMetadata={symbolMetadata} />;
 if (section === "alerts") return <AlertsList items={feeds.alerts} symbolMetadata={symbolMetadata} />;
 if (section === "concalls") return <ConcallList items={feeds.concalls} symbolMetadata={symbolMetadata} />;
 if (section === "earnings") return <AnnouncementList items={feeds.earnings} fallbackTitle="Earnings update" symbolMetadata={symbolMetadata} earnings />;
 return <AnnouncementList items={feeds.announcements} fallbackTitle="Untitled announcement" symbolMetadata={symbolMetadata} />;
}

export function StateMessage({
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

function LiveUpdateStrip({ count, onAcknowledge, section }: { count: number; onAcknowledge: () => void; section: AlphaSection }) {
 const visual = sectionVisuals[section];
 const Icon = visual.icon;
 const label = count === 1 ? "1 new live record added" : `${count} new live records added`;

 return (
 <button
 className="flex w-full items-center justify-between gap-3 border border-primary/30 bg-[var(--accent-glow)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:border-primary/60"
 onClick={onAcknowledge}
 type="button"
 >
 <span className="flex items-center gap-2">
 <Icon className="size-3.5" />
 {label}
 </span>
 <Check className="size-3.5" />
 </button>
 );
}

function EmptyFeed({ section }: { section: AlphaSection }) {
 const visual = sectionVisuals[section];
 const Icon = visual.icon;

 return (
 <div className="flex min-h-56 flex-col items-center justify-center border-l-2 border-border px-4 py-10 text-center">
 <div className="flex size-12 items-center justify-center border border-border bg-secondary text-muted-foreground">
 <Icon className="size-5" />
 </div>
 <h2 className="mt-4 text-base font-semibold text-foreground">{visual.title}</h2>
 <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{visual.description} New matching websocket events will appear here.</p>
 </div>
 );
}

function NewsList({ items, symbolMetadata }: { items: AlphaNewsItem[]; symbolMetadata: Record<string, AlphaSymbolMetadata> }) {
 if (!items.length) return <EmptyFeed section="news" />;
 return (
 <div className="grid min-w-0 gap-4">
 {items.map((item) => {
 const symbol = item.symbol ?? "";
 return (
 <article className="min-w-0 max-w-full border-l-2 border-border pl-4" key={itemKey(item)}>
 <div className="flex items-start justify-between gap-4">
 <div className="min-w-0">
 <h2 className="max-w-full whitespace-normal break-words text-lg font-semibold text-foreground">{item.specific_title ?? item.title ?? "Untitled news"}</h2>
 {symbol ? <SymbolMetadataLine metadata={symbolMetadata[symbol.trim().toUpperCase()]} symbol={symbol} /> : null}
 <p className="mt-1 max-w-full whitespace-normal break-words text-xs text-muted-foreground">
 {[item.source, item.sentiment, formatDate(item.date)].filter(Boolean).join(" / ")}
 </p>
 </div>
 {item.link ? <ExternalAnchor href={item.link} label="Open news article" /> : null}
 </div>
 <p className="mt-3 max-w-full whitespace-normal break-words text-sm leading-6 text-muted-foreground">{item.long_summary ?? item.summary ?? "No summary provided."}</p>
 </article>
 );
 })}
 </div>
 );
}

function AlertsList({ items, symbolMetadata }: { items: AlphaAlert[]; symbolMetadata: Record<string, AlphaSymbolMetadata> }) {
 if (!items.length) return <EmptyFeed section="alerts" />;
 return (
 <div className="grid min-w-0 gap-4">
 {items.map((item) => {
 const typeConfig = getAlertTypeConfig(item.type);
 const Icon = typeConfig.icon;
 return (
 <article className="min-w-0 max-w-full border-l-2 pl-4" key={itemKey(item)} style={{ borderColor: typeConfig.color }}>
 <div className="flex items-start justify-between gap-3">
 <SymbolMetadataHeader metadata={symbolMetadata[item.symbol.trim().toUpperCase()]} symbol={item.symbol} />
 <p className="shrink-0 text-xs text-muted-foreground">{formatDate(item.timestamp)}</p>
 </div>
 <div className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
 <span className="flex size-5 shrink-0 items-center justify-center" style={{ color: typeConfig.color }} aria-hidden="true">
 <Icon className="size-4" strokeWidth={2.2} />
 </span>
 <span className="min-w-0 whitespace-normal break-words">{typeConfig.name}</span>
 </div>
 {item.reason ? <p className="mt-2 max-w-full whitespace-normal break-words text-sm leading-6 text-muted-foreground">{item.reason}</p> : null}
 </article>
 );
 })}
 </div>
 );
}

function AnnouncementList({
 items,
 fallbackTitle,
 symbolMetadata,
 earnings = false
}: {
 items: AlphaAnnouncementDetail[];
 fallbackTitle: string;
 symbolMetadata: Record<string, AlphaSymbolMetadata>;
 earnings?: boolean;
}) {
 if (!items.length) return <EmptyFeed section={earnings ? "earnings" : "announcements"} />;
 return (
 <div className="grid min-w-0 gap-4">
 {items.map((item) => {
 const symbol = item.symbol ?? "";
 return (
 <article className="min-w-0 max-w-full border-l-2 border-border pl-4" key={itemKey(item)}>
 <div className="flex items-start justify-between gap-4">
 <div className="min-w-0">
 <h2 className="max-w-full whitespace-normal break-words text-lg font-semibold text-foreground">{item.headline ?? item.title ?? fallbackTitle}</h2>
 {symbol ? <SymbolMetadataLine metadata={symbolMetadata[symbol.trim().toUpperCase()]} symbol={symbol} /> : null}
 <p className="mt-1 max-w-full whitespace-normal break-words text-xs text-muted-foreground">
 {[earnings && item.earnings_significant ? "significant" : item.category, formatDate(item.date)].filter(Boolean).join(" / ")}
 </p>
 </div>
 {item.attachment_url ? <ExternalAnchor href={item.attachment_url} label="Open attachment" /> : null}
 </div>
 <p className="mt-3 max-w-full whitespace-normal break-words text-sm leading-6 text-muted-foreground">{earnings ? item.management_guidance ?? item.summary ?? "No summary provided." : item.summary ?? "No summary provided."}</p>
 </article>
 );
 })}
 </div>
 );
}

function ConcallList({ items, symbolMetadata }: { items: AlphaConcall[]; symbolMetadata: Record<string, AlphaSymbolMetadata> }) {
 if (!items.length) return <EmptyFeed section="concalls" />;
 return (
 <div className="grid min-w-0 gap-4">
 {items.map((item) => {
 const transcriptHref = item.transcript_pdf_links?.[0] ?? null;
 const audioHref = item.recording_links?.[0] ?? null;
 const markdown = insightToMarkdown(item.short_analysis ?? item.analysis ?? item.summary ?? item.completion_response) || "No analysis provided.";
 return (
 <article className="min-w-0 max-w-full border-l-2 border-border pl-4" key={itemKey(item)}>
 <div className="flex flex-col items-start justify-between gap-3 min-[720px]:flex-row min-[720px]:gap-4">
 <div className="min-w-0">
 <SymbolMetadataHeader metadata={symbolMetadata[item.symbol.trim().toUpperCase()]} symbol={item.symbol} />
 <p className="mt-1 max-w-full whitespace-normal break-words text-xs text-muted-foreground">{[item.quarter, item.month, item.concall_type, formatDate(item.date)].filter(Boolean).join(" / ")}</p>
 </div>
 {transcriptHref || audioHref ? (
 <div className="flex shrink-0 flex-wrap items-center gap-1.5">
 {transcriptHref ? <InlineActionLink href={transcriptHref} icon={FileText} label="PDF" /> : null}
 {audioHref ? <InlineActionLink href={audioHref} icon={Play} label="Audio" /> : null}
 </div>
 ) : null}
 </div>
 <ConcallMarkdown>{markdown}</ConcallMarkdown>
 </article>
 );
 })}
 </div>
 );
}

function SymbolMetadataHeader({ symbol, metadata }: { symbol: string; metadata?: AlphaSymbolMetadata }) {
 const detail = [metadata?.company_name, metadata?.sector, metadata?.industry ?? metadata?.basic_industry ?? metadata?.theme].filter(Boolean);

 return (
 <div className="flex min-w-0 max-w-full items-start gap-2.5">
 <SymbolLogo metadata={metadata} symbol={symbol} />
 <div className="min-w-0">
 <h2 className="font-mono text-lg font-semibold leading-6 text-foreground">{symbol}</h2>
 {detail.length ? <p className="max-w-full whitespace-normal break-words text-xs leading-5 text-muted-foreground">{detail.join(" / ")}</p> : null}
 </div>
 </div>
 );
}

function SymbolMetadataLine({ symbol, metadata }: { symbol: string; metadata?: AlphaSymbolMetadata }) {
 const detail = [metadata?.company_name, metadata?.sector, metadata?.industry ?? metadata?.basic_industry ?? metadata?.theme].filter(Boolean);

 return (
 <div className="mt-1 flex min-w-0 max-w-full items-start gap-2">
 <SymbolLogo metadata={metadata} small symbol={symbol} />
 <p className="min-w-0 max-w-full whitespace-normal break-words text-xs text-muted-foreground">
 <span className="font-mono font-semibold uppercase text-foreground">{symbol}</span>
 {detail.length ? ` / ${detail.join(" / ")}` : null}
 </p>
 </div>
 );
}

function SymbolLogo({ symbol, metadata, small = false }: { symbol: string; metadata?: AlphaSymbolMetadata; small?: boolean }) {
 const sizeClassName = small ? "size-5 text-[9px]" : "size-8 text-[10px]";

 if (metadata?.logo) {
 return <img alt="" className={`${sizeClassName} shrink-0 bg-background object-contain`} src={metadata.logo} />;
 }

 return (
 <span className={`flex ${sizeClassName} shrink-0 items-center justify-center bg-muted font-mono font-semibold text-muted-foreground`}>
 {symbol.slice(0, 2)}
 </span>
 );
}

function ConcallMarkdown({ children }: { children: string }) {
 return (
 <div className="mt-3 max-w-full whitespace-normal break-words text-sm leading-6 text-muted-foreground">
 <ReactMarkdown
 remarkPlugins={[remarkGfm]}
 components={{
 p: ({ children: paragraphChildren }) => <p className="mb-3 max-w-full whitespace-normal break-words last:mb-0">{paragraphChildren}</p>,
 ul: ({ children: listChildren }) => <ul className="mb-3 ml-5 max-w-full list-disc space-y-1 whitespace-normal break-words last:mb-0">{listChildren}</ul>,
 ol: ({ children: listChildren }) => <ol className="mb-3 ml-5 max-w-full list-decimal space-y-1 whitespace-normal break-words last:mb-0">{listChildren}</ol>,
 li: ({ children: itemChildren }) => <li className="max-w-full break-words pl-1">{itemChildren}</li>,
 strong: ({ children: strongChildren }) => <strong className="font-semibold text-foreground">{strongChildren}</strong>,
 a: ({ children: linkChildren, href }) => (
 <a className="break-words font-medium text-primary underline-offset-4 hover:underline" href={href} target="_blank" rel="noreferrer">
 {linkChildren}
 </a>
 )
 }}
 >
 {children}
 </ReactMarkdown>
 </div>
 );
}

function InlineActionLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
 return (
 <a
 className="inline-flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
 href={href}
 rel="noreferrer"
 target="_blank"
 >
 <Icon className="size-3.5" />
 {label}
 </a>
 );
}

function ExternalAnchor({ href, label }: { href: string; label: string }) {
 return (
 <a className="flex size-9 shrink-0 items-center justify-center text-primary hover:bg-[var(--accent-glow)]" href={href} target="_blank" rel="noreferrer" aria-label={label}>
 <ExternalLink className="size-4" />
 </a>
 );
}
