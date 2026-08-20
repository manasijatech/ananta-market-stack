"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flattenLivePriceTick, livePriceNumber, mergeLivePriceTick } from "@/lib/live-price-tick";
import { livePriceWebSocketCandidates } from "@/lib/live-price-ws";
import { touchLiveDemandSubscriptions } from "@/service/actions/alerts";
import type { InstrumentRef, LivePriceTick } from "@/service/types/alerts";

export type LivePriceDemand = {
    account_id?: string | null;
    broker_code?: string | null;
    exchange?: string | null;
    instrument_ref?: InstrumentRef | Record<string, unknown>;
    symbol: string;
};

function toNumber(value: unknown): number | null {
    return livePriceNumber(value);
}

function livePriceKey(row: { account_id?: string | null; broker_code?: string | null; symbol: string }): string {
    return [row.account_id || "", row.broker_code || "", row.symbol.trim().toUpperCase()].join(":");
}

export function useLivePrices(demand: LivePriceDemand[], sourceId: string, userId?: string | null) {
    const [prices, setPrices] = useState<Record<string, LivePriceTick>>({});
    const [state, setState] = useState<"connecting" | "connected" | "disconnected" | "error">("disconnected");
    const pendingRef = useRef<Map<string, LivePriceTick>>(new Map());
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const demandKey = useMemo(
        () =>
            demand
                .map((row) => `${row.account_id ?? ""}:${row.broker_code ?? ""}:${row.symbol}:${row.exchange ?? ""}`)
                .join("|"),
        [demand]
    );

    useEffect(() => {
        if (!demand.length) {
            setState("disconnected");
            return;
        }
        let cancelled = false;

        async function touchDemand() {
            try {
                const rows = await touchLiveDemandSubscriptions({
                    scopes: [{ source_id: sourceId, source_type: "adaptive_workspace" }],
                    subscriptions: demand.map((item) => ({
                        ...item,
                        source_id: sourceId,
                        source_label: "Adaptive workspace",
                        source_type: "adaptive_workspace"
                    }))
                });
                if (cancelled) return;
                setPrices((current) => {
                    const next = { ...current };
                    for (const row of rows) {
                        if (!row.symbol) continue;
                        const tick =
                            flattenLivePriceTick((row.last_quote || {}) as Record<string, unknown>, {
                                account_id: row.account_id ?? undefined,
                                broker_code: row.broker_code ?? undefined,
                                exchange: row.exchange,
                                received_at: row.last_received_at,
                                symbol: row.symbol
                            }) ?? ({ symbol: row.symbol } as LivePriceTick);
                        next[livePriceKey(tick)] = mergeLivePriceTick(next[livePriceKey(tick)], tick);
                        next[livePriceKey({ symbol: row.symbol })] = mergeLivePriceTick(next[livePriceKey({ symbol: row.symbol })], tick);
                    }
                    return next;
                });
            } catch {
                if (!cancelled) setState("error");
            }
        }

        void touchDemand();
        const handle = window.setInterval(touchDemand, 30_000);
        return () => {
            cancelled = true;
            window.clearInterval(handle);
        };
    }, [demand, demandKey, sourceId]);

    useEffect(() => {
        const refs = demand.filter((row) => row.account_id && row.broker_code && row.symbol);
        if (!refs.length || !userId) {
            return;
        }
        let cancelled = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let socket: WebSocket | null = null;
        let urlIndex = 0;
        let openedOnce = false;
        let switchUrl = false;
        const urls = livePriceWebSocketCandidates(userId as string);

        function flush() {
            flushTimerRef.current = null;
            if (!pendingRef.current.size) return;
            const batch = Array.from(pendingRef.current.values());
            pendingRef.current.clear();
            setPrices((current) => {
                const next = { ...current };
                for (const tick of batch) {
                    next[livePriceKey(tick)] = mergeLivePriceTick(current[livePriceKey(tick)], tick);
                    next[livePriceKey({ symbol: tick.symbol })] = mergeLivePriceTick(current[livePriceKey({ symbol: tick.symbol })], tick);
                }
                return next;
            });
        }

        function enqueue(rows: LivePriceTick[]) {
            for (const row of rows) {
                if (!row?.symbol) continue;
                const tick = flattenLivePriceTick(row as unknown as Record<string, unknown>, { symbol: row.symbol }) ?? row;
                pendingRef.current.set(livePriceKey(tick), tick);
                pendingRef.current.set(livePriceKey({ symbol: tick.symbol }), tick);
            }
            if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flush, 200);
        }

        function connect() {
            if (!urls.length) {
                setState("error");
                return;
            }
            setState(openedOnce ? "disconnected" : "connecting");
            const url = urls[Math.min(urlIndex, urls.length - 1)];
            socket = new WebSocket(url);
            socket.onopen = () => {
                openedOnce = true;
                socket?.send(
                    JSON.stringify({
                        refs: refs.map((ref) => `${ref.account_id}|${ref.broker_code}|${ref.symbol}`),
                        type: "subscribe"
                    })
                );
                setState("connected");
            };
            socket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(String(event.data)) as { rows?: LivePriceTick[]; type?: string };
                    if (payload.type === "snapshot" || payload.type === "prices") {
                        enqueue(Array.isArray(payload.rows) ? payload.rows : []);
                    }
                } catch {
                    setState("error");
                }
            };
            socket.onerror = () => {
                if (!openedOnce && urlIndex < urls.length - 1) {
                    urlIndex += 1;
                    switchUrl = true;
                }
                socket?.close();
            };
            socket.onclose = () => {
                if (cancelled) return;
                setState(openedOnce ? "disconnected" : "connecting");
                const retryMs = switchUrl ? 150 : 2500;
                switchUrl = false;
                reconnectTimer = setTimeout(connect, retryMs);
            };
        }

        connect();
        return () => {
            cancelled = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
            socket?.close();
        };
    }, [demandKey, userId]);

    return { prices, state, tickFor: (symbol: string, accountId?: string | null, brokerCode?: string | null) => {
        return prices[livePriceKey({ account_id: accountId, broker_code: brokerCode, symbol })] ?? prices[livePriceKey({ symbol })];
    } };
}

export function liveTickMove(tick: LivePriceTick | undefined): { change: number | null; changePercent: number | null; ltp: number | null } {
    const ltp = toNumber(tick?.ltp ?? tick?.last_price);
    const changePercent = toNumber(tick?.change_pct ?? tick?.day_change_perc);
    const change = toNumber(tick?.day_change);
    return { change, changePercent, ltp };
}
