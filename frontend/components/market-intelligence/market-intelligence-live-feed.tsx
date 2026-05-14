"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAlphaWebSocketConfig } from "@/service/actions/alpha/websocket";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import type { JsonValue } from "@/service/types/broker";
import {
 marketIntelligenceProducts,
 type AlphaSection,
 type MarketIntelligenceFeeds,
 type MarketIntelligenceProduct
} from "@/components/market-intelligence/market-intelligence-data";

const MAX_FEED_ITEMS = 50;

type SocketState = "connecting" | "live" | "offline";

type IncomingEnvelope = {
 channel?: string;
 data?: unknown;
 error?: string;
 status?: string;
 product?: string;
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
 return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMarketProduct(value: unknown): value is MarketIntelligenceProduct {
 return typeof value === "string" && marketIntelligenceProducts.includes(value as MarketIntelligenceProduct);
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

function stringifyInsight(value: JsonValue | undefined | null): string {
 if (!value) return "";
 if (typeof value === "string") return value;
 if (Array.isArray(value)) return value.map(stringifyInsight).filter(Boolean).join(" ");
 if (typeof value === "object") {
 const record = value as Record<string, JsonValue>;
 return stringifyInsight(record.summary ?? record.headline ?? record.text ?? record.analysis ?? JSON.stringify(value));
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
 symbols
}: {
 activeSection: AlphaSection;
 initialFeeds: MarketIntelligenceFeeds;
 symbols: string[];
}) {
 const [feeds, setFeeds] = useState(initialFeeds);
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
 <MarketIntelligenceSection section={activeSection} feeds={feeds} />
 </div>
 );
}

function MarketIntelligenceSection({ section, feeds }: { section: AlphaSection; feeds: MarketIntelligenceFeeds }) {
 if (section === "news") return <NewsList items={feeds.news} />;
 if (section === "alerts") return <AlertsList items={feeds.alerts} />;
 if (section === "concalls") return <ConcallList items={feeds.concalls} />;
 if (section === "earnings") return <AnnouncementList items={feeds.earnings} fallbackTitle="Earnings update" earnings />;
 return <AnnouncementList items={feeds.announcements} fallbackTitle="Untitled announcement" />;
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

function EmptyFeed() {
 return <StateMessage message="No Alpha records found for these watchlist symbols in the last 30 days. New matching websocket events will appear here." />;
}

function NewsList({ items }: { items: AlphaNewsItem[] }) {
 if (!items.length) return <EmptyFeed />;
 return (
 <div className="grid gap-4">
 {items.map((item) => (
 <article className="border-l-2 border-border pl-4" key={itemKey(item)}>
 <div className="flex items-start justify-between gap-4">
 <div className="min-w-0">
 <h2 className="truncate text-lg font-semibold text-foreground">{item.specific_title ?? item.title ?? "Untitled news"}</h2>
 <p className="mt-1 text-xs text-muted-foreground">
 {[item.symbol ?? item.company, item.source, item.sentiment, formatDate(item.date)].filter(Boolean).join(" / ")}
 </p>
 </div>
 {item.link ? <ExternalAnchor href={item.link} label="Open news article" /> : null}
 </div>
 <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.long_summary ?? item.summary ?? "No summary provided."}</p>
 </article>
 ))}
 </div>
 );
}

function AlertsList({ items }: { items: AlphaAlert[] }) {
 if (!items.length) return <EmptyFeed />;
 return (
 <div className="grid gap-4">
 {items.map((item) => (
 <article className="border-l-2 border-border pl-4" key={itemKey(item)}>
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
 if (!items.length) return <EmptyFeed />;
 return (
 <div className="grid gap-4">
 {items.map((item) => (
 <article className="border-l-2 border-border pl-4" key={itemKey(item)}>
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
 if (!items.length) return <EmptyFeed />;
 return (
 <div className="grid gap-4">
 {items.map((item) => {
 const href = item.transcript_pdf_links?.[0] ?? item.recording_links?.[0] ?? null;
 return (
 <article className="border-l-2 border-border pl-4" key={itemKey(item)}>
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
