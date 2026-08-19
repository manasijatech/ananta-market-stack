"use client";

import { useEffect, useState } from "react";
import { getDataQuotes } from "@/service/actions/broker";
import type { InstrumentRef, QuoteResponse } from "@/service/types/broker";

export function useQuoteSnapshots(
    accountId: string | undefined,
    instruments: InstrumentRef[],
    refreshNonce: number
) {
    const [rows, setRows] = useState<QuoteResponse[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!accountId || !instruments.length) {
            setRows([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void getDataQuotes(accountId, { instruments: instruments.slice(0, 40) })
            .then((result) => {
                if (!cancelled) {
                    setRows(result);
                    setError(null);
                }
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load quotes.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        const poll = window.setInterval(() => {
            void getDataQuotes(accountId, { instruments: instruments.slice(0, 40) })
                .then((result) => {
                    if (!cancelled) setRows(result);
                })
                .catch(() => undefined);
        }, 20_000);
        return () => {
            cancelled = true;
            window.clearInterval(poll);
        };
    }, [accountId, instruments, refreshNonce]);

    return { error, loading, rows };
}
