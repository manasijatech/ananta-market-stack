"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from "react";
import { liveTickMove, useLivePrices, type LivePriceDemand } from "@/hooks/use-live-prices";
import {
    islandKey,
    type LiveLtpDisplayed,
    type LiveLtpIslandAttrs
} from "@/lib/live-ltp-island";
import type { LivePriceTick } from "@/service/types/alerts";

type RegisteredIsland = {
    exchange: string;
    symbol: string;
};

type LivePriceIslandContextValue = {
    displayed: Record<string, LiveLtpDisplayed>;
    liveState: "connecting" | "connected" | "disconnected" | "error";
    registerDemand: (id: string, islands: RegisteredIsland[]) => void;
    registerDisplayed: (key: string, value: LiveLtpDisplayed) => void;
    tickFor: (symbol: string, accountId?: string | null, brokerCode?: string | null) => LivePriceTick | undefined;
    unregisterDemand: (id: string) => void;
};

const LivePriceIslandContext = createContext<LivePriceIslandContextValue | null>(null);

function sameIslands(a: RegisteredIsland[] | undefined, b: RegisteredIsland[]): boolean {
    if (!a || a.length !== b.length) return false;
    return a.every(
        (row, index) =>
            row.symbol.toUpperCase() === b[index].symbol.toUpperCase() &&
            (row.exchange || "").toUpperCase() === (b[index].exchange || "").toUpperCase()
    );
}

type ProviderProps = {
    accountId?: string | null;
    brokerCode?: string | null;
    children: ReactNode;
    sessionId?: string | null;
    userId?: string | null;
};

export function LivePriceIslandProvider({
    accountId,
    brokerCode,
    children,
    sessionId,
    userId
}: ProviderProps) {
    const [demandMap, setDemandMap] = useState<Record<string, RegisteredIsland[]>>({});
    const [displayed, setDisplayed] = useState<Record<string, LiveLtpDisplayed>>({});
    const displayedRef = useRef(displayed);
    displayedRef.current = displayed;

    const demand: LivePriceDemand[] = useMemo(() => {
        const byKey = new Map<string, LivePriceDemand>();
        for (const rows of Object.values(demandMap)) {
            for (const row of rows) {
                const symbol = row.symbol.trim().toUpperCase();
                if (!symbol) continue;
                const key = islandKey(row.exchange, symbol);
                if (byKey.has(key)) continue;
                byKey.set(key, {
                    account_id: accountId || null,
                    broker_code: brokerCode || null,
                    exchange: row.exchange || null,
                    symbol
                });
            }
        }
        return Array.from(byKey.values());
    }, [accountId, brokerCode, demandMap]);

    const sourceId = sessionId ? `chat-island:${sessionId}` : "chat-island:anonymous";
    const live = useLivePrices(demand, sourceId, userId);
    const tickForRef = useRef(live.tickFor);
    tickForRef.current = live.tickFor;

    const registerDemand = useCallback((id: string, islands: RegisteredIsland[]) => {
        setDemandMap((current) => {
            if (sameIslands(current[id], islands)) return current;
            return { ...current, [id]: islands };
        });
    }, []);

    const unregisterDemand = useCallback((id: string) => {
        setDemandMap((current) => {
            if (!(id in current)) return current;
            const next = { ...current };
            delete next[id];
            return next;
        });
    }, []);

    const registerDisplayed = useCallback((key: string, value: LiveLtpDisplayed) => {
        const prev = displayedRef.current[key];
        if (prev && prev.ltp === value.ltp && prev.chgPct === value.chgPct) return;
        setDisplayed((current) => {
            const existing = current[key];
            if (existing && existing.ltp === value.ltp && existing.chgPct === value.chgPct) return current;
            return { ...current, [key]: value };
        });
    }, []);

    const tickFor = useCallback((symbol: string, accountId?: string | null, brokerCode?: string | null) => {
        return tickForRef.current(symbol, accountId, brokerCode);
    }, []);

    const value = useMemo<LivePriceIslandContextValue>(
        () => ({
            displayed,
            liveState: live.state,
            registerDemand,
            registerDisplayed,
            tickFor,
            unregisterDemand
        }),
        [displayed, live.state, registerDemand, registerDisplayed, tickFor, unregisterDemand]
    );

    return <LivePriceIslandContext.Provider value={value}>{children}</LivePriceIslandContext.Provider>;
}

export function useOptionalLivePriceIsland(): LivePriceIslandContextValue | null {
    return useContext(LivePriceIslandContext);
}

export function useLivePriceIsland(): LivePriceIslandContextValue {
    const ctx = useContext(LivePriceIslandContext);
    if (!ctx) {
        throw new Error("useLivePriceIsland requires LivePriceIslandProvider");
    }
    return ctx;
}

/** Resolve live or snapshot values for an island and keep copy-flatten map warm. */
export function useIslandDisplayedValues(attrs: LiveLtpIslandAttrs): LiveLtpDisplayed & {
    asOf: string | null;
    isLive: boolean;
} {
    const ctx = useOptionalLivePriceIsland();
    const registerDemand = ctx?.registerDemand;
    const unregisterDemand = ctx?.unregisterDemand;
    const registerDisplayed = ctx?.registerDisplayed;
    const tickFor = ctx?.tickFor;
    const tick = tickFor?.(attrs.symbol) ?? undefined;
    const move = liveTickMove(tick);
    const ltp = move.ltp ?? attrs.ltp ?? null;
    const chgPct = move.changePercent ?? attrs.chgPct ?? null;
    const isLive = move.ltp != null;
    const asOf = isLive ? null : attrs.asOf ?? null;
    const key = islandKey(attrs.exchange, attrs.symbol);

    useEffect(() => {
        registerDisplayed?.(key, { chgPct, ltp });
    }, [chgPct, key, ltp, registerDisplayed]);

    const demandIdRef = useRef(`island:${key}:${Math.random().toString(36).slice(2, 9)}`);
    useEffect(() => {
        if (!registerDemand || !unregisterDemand) return;
        const id = demandIdRef.current;
        registerDemand(id, [{ exchange: attrs.exchange, symbol: attrs.symbol }]);
        return () => unregisterDemand(id);
    }, [attrs.exchange, attrs.symbol, registerDemand, unregisterDemand]);

    return { asOf, chgPct, isLive, ltp };
}
