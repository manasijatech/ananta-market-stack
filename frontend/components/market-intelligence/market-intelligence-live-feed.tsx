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
import { useSession } from "@/components/session-provider";
import { itemKey } from "@/components/market-intelligence/market-intelligence-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail, AlphaEarningsDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import { notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";

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

function alphaWebSocketUrl(userId: string, products: string[]): string {
    const configured = new URL(getPublicApiBaseUrl(), window.location.origin);
    const loopbackHosts = new Set(["127.0.0.1", "localhost"]);
    const shouldUseBrowserOrigin =
        typeof window !== "undefined" &&
        loopbackHosts.has(configured.hostname) &&
        !loopbackHosts.has(window.location.hostname);
    const url = shouldUseBrowserOrigin ? new URL(window.location.origin) : configured;
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${configured.pathname.replace(/\/+$/, "")}/alpha/ws`;
    url.search = "";
    url.searchParams.set("user_id", userId);
    if (products.length) url.searchParams.set("products", products.join(","));
    return url.toString();
}

export function MarketIntelligenceLiveFeed({
    activeSection,
    enableLiveUpdates = true,
    feedSearch,
    initialFeeds,
    onFeedSearchSymbol,
    onSocketStateChange,
    symbolMetadata,
    symbols
}: {
    activeSection: AlphaSection;
    enableLiveUpdates?: boolean;
    feedSearch: string;
    initialFeeds: MarketIntelligenceFeeds;
    onFeedSearchSymbol?: (symbol: string) => void;
    onSocketStateChange?: (state: MarketIntelligenceSocketState) => void;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
    symbols: string[];
}) {
    const { user } = useSession();
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
        if (!enableLiveUpdates) {
            setSocketState("offline");
            setSocketError("");
            return;
        }
        let socket: WebSocket | null = null;
        let cancelled = false;
        let opened = false;
        let failedAttempts = 0;
        let reconnectTimer: number | null = null;

        function scheduleReconnect() {
            if (cancelled || reconnectTimer) return;
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                if (failedAttempts < 3) setSocketState("connecting");
                void connect();
            }, 1500);
        }

        async function connect() {
            try {
                if (cancelled) return;
                setSocketError("");
                socket = new WebSocket(alphaWebSocketUrl(user?.id ?? "local-dev-user", [...marketIntelligenceProducts]));

                socket.onopen = () => {
                    if (cancelled || !socket) return;
                    opened = true;
                    failedAttempts = 0;
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
                    // The browser follows error with close; let close decide user-visible state.
                };

                socket.onclose = (event) => {
                    if (cancelled) return;
                    failedAttempts += 1;
                    if (event.code === 1000) {
                        setSocketState("offline");
                        return;
                    }
                    if (!opened && failedAttempts >= 3) {
                        setSocketState("offline");
                        setSocketError("Could not connect to the Drishti websocket.");
                    } else if (opened) {
                        setSocketState("connecting");
                        setSocketError("");
                    }
                    scheduleReconnect();
                };
            } catch (caught) {
                if (!cancelled) {
                    notifyAlphaCreditWarning(caught);
                    setSocketState("offline");
                    setSocketError(
                        caught instanceof Error ? caught.message : "Could not connect to the Drishti websocket."
                    );
                }
            }
        }

        setSocketState("connecting");
        connect();

        return () => {
            cancelled = true;
            if (reconnectTimer) window.clearTimeout(reconnectTimer);
            socket?.close();
        };
    }, [enableLiveUpdates, user?.id, watchlistSymbols]);

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
        <Alert className="mb-4" variant={tone === "error" ? "destructive" : "info"}>
            <AlertTitle>{tone === "error" ? "Something went wrong" : "Heads up"}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
            {action ? <div className="mt-3" data-slot="alert-action">{action}</div> : null}
        </Alert>
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
        <Button
            className="mb-3 h-auto w-full justify-between px-3 py-2 text-xs"
            onClick={onAcknowledge}
            type="button"
            variant="outline"
        >
            <span>{label}</span>
            <Check aria-hidden="true" />
        </Button>
    );
}
