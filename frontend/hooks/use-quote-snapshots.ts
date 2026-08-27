"use client";

import { useEffect, useState } from "react";
import { brokerReconnectCopy } from "@/lib/broker-auth-error";
import { getDataQuotesResult } from "@/service/actions/broker";
import type { InstrumentRef, QuoteResponse } from "@/service/types/broker";

export function useQuoteSnapshots(
    accountId: string | undefined,
    instruments: InstrumentRef[],
    refreshNonce: number
) {
    const [rows, setRows] = useState<QuoteResponse[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [authFailed, setAuthFailed] = useState(false);
    const [loading, setLoading] = useState(true);
    const instrumentKey = instruments
        .map((item) => `${item.symbol ?? ""}:${item.exchange ?? ""}:${item.upstox_instrument_key ?? item.zerodha_instrument_token ?? item.angel_token ?? ""}`)
        .join("|");

    useEffect(() => {
        if (!accountId || !instrumentKey) {
            setRows([]);
            setError(null);
            setAuthFailed(false);
            setLoading(false);
            return;
        }
        let cancelled = false;
        let poll: number | undefined;
        setLoading(true);
        const payload = instruments.slice(0, 40);

        async function load() {
            const result = await getDataQuotesResult(accountId!, { instruments: payload });
            if (cancelled) return result;
            setRows(result.data ?? []);
            if (result.ok) {
                setError(null);
                setAuthFailed(false);
            } else {
                setAuthFailed(result.authFailed);
                setError(result.authFailed ? brokerReconnectCopy(result.error || "") : result.error);
            }
            return result;
        }

        void load()
            .then((result) => {
                if (cancelled || (result && !result.ok && result.authFailed)) return;
                poll = window.setInterval(() => {
                    void load();
                }, 20_000);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            if (poll) window.clearInterval(poll);
        };
    }, [accountId, instrumentKey, refreshNonce]);

    return { authFailed, error, loading, rows };
}
