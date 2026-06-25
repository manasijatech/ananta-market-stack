"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    marketIntelligenceProducts,
    type AlphaSection,
    type MarketIntelligenceFeeds,
    type MarketIntelligenceProduct
} from "@/components/market-intelligence/market-intelligence-data";
import {
    AlertsTab,
    AnnouncementsTab,
    ConcallsTab,
    EarningsTab,
    NewsTab
} from "@/components/market-intelligence/market-intelligence-tabs";
import { itemKey } from "@/components/market-intelligence/market-intelligence-utils";
import { getAlphaWebSocketConfig } from "@/service/actions/alpha/websocket";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail, AlphaEarningsDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import { notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";

const MAX_FEED_ITEMS = 50;

export type MarketIntelligenceSocketState = "connecting" | "live" | "offline";

const emptyLiveUpdateCounts = {
    news: 0,
    announcements: 0,
    earnings: 0,
    concalls: 0,
    alerts: 0
} satisfies Record<AlphaSection, number>;

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

function sectionFromProduct(product: MarketIntelligenceProduct): AlphaSection {
    return product === "announcements" ? "announcements" : product;
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
    feedSearch,
    initialFeeds,
    onFeedSearchSymbol,
    onSocketStateChange,
    symbolMetadata,
    symbols
}: {
    activeSection: AlphaSection;
    feedSearch: string;
    initialFeeds: MarketIntelligenceFeeds;
    onFeedSearchSymbol?: (symbol: string) => void;
    onSocketStateChange?: (state: MarketIntelligenceSocketState) => void;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
    symbols: string[];
}) {
    const [feeds, setFeeds] = useState(initialFeeds);
    const [liveUpdateCounts, setLiveUpdateCounts] = useState<Record<AlphaSection, number>>(emptyLiveUpdateCounts);
    const [socketState, setSocketState] = useState<MarketIntelligenceSocketState>("connecting");
    const [socketError, setSocketError] = useState("");
    const watchlistSymbols = useMemo(
        () => new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)),
        [symbols]
    );

    useEffect(() => {
        setFeeds(initialFeeds);
        setLiveUpdateCounts(emptyLiveUpdateCounts);
    }, [initialFeeds]);

    useEffect(() => {
        onSocketStateChange?.(socketState);
    }, [onSocketStateChange, socketState]);

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
                            return {
                                ...current,
                                earnings: mergeItem(current.earnings, item as AlphaEarningsDetail)
                            };
                        }
                        return {
                            ...current,
                            announcements: mergeItem(current.announcements, item as AlphaAnnouncementDetail)
                        };
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
                    notifyAlphaCreditWarning(caught);
                    setSocketState("offline");
                    setSocketError(
                        caught instanceof Error ? caught.message : "Could not connect to the Alpha websocket."
                    );
                }
            }
        }

        setSocketState("connecting");
        connect();

        return () => {
            cancelled = true;
            socket?.close();
        };
    }, [watchlistSymbols]);

    const sharedTabProps = {
        feedSearch,
        onTickerClick: onFeedSearchSymbol,
        symbolMetadata,
        watchlistSymbols
    };

    return (
        <div className="min-w-0">
            {socketError ? <StateMessage message={socketError} tone="error" /> : null}
            {liveUpdateCounts[activeSection] ? (
                <LiveUpdateStrip
                    count={liveUpdateCounts[activeSection]}
                    onAcknowledge={() => setLiveUpdateCounts((current) => ({ ...current, [activeSection]: 0 }))}
                />
            ) : null}
            {activeSection === "news" ? <NewsTab items={feeds.news} {...sharedTabProps} /> : null}
            {activeSection === "announcements" ? (
                <AnnouncementsTab items={feeds.announcements} {...sharedTabProps} />
            ) : null}
            {activeSection === "earnings" ? <EarningsTab items={feeds.earnings} {...sharedTabProps} /> : null}
            {activeSection === "concalls" ? <ConcallsTab items={feeds.concalls} {...sharedTabProps} /> : null}
            {activeSection === "alerts" ? <AlertsTab items={feeds.alerts} {...sharedTabProps} /> : null}
        </div>
    );
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
        <div
            className={
                tone === "error"
                    ? "mb-4 border-l-2 border-destructive px-4 py-3 text-sm text-destructive"
                    : "mb-4 border-l-2 border-primary px-4 py-3 text-sm text-muted-foreground"
            }
        >
            <div>{message}</div>
            {action ? <div className="mt-3">{action}</div> : null}
        </div>
    );
}

function LiveUpdateStrip({
    count,
    onAcknowledge
}: {
    count: number;
    onAcknowledge: () => void;
}) {
    const label = count === 1 ? "1 new live record" : `${count} new live records`;

    return (
        <button
            className="mb-3 flex w-full items-center justify-between gap-3 border border-primary/30 bg-[var(--accent-glow)] px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:border-primary/60"
            onClick={onAcknowledge}
            type="button"
        >
            <span>{label}</span>
            <Check className="size-3.5" />
        </button>
    );
}
