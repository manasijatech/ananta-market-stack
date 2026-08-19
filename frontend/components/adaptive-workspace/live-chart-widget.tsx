"use client";

import { useEffect, useState } from "react";
import { PriceChartCard } from "@/components/adaptive-workspace/price-chart-card";
import { SuppressPin } from "@/components/adaptive-workspace/tool-card-shell";
import { WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { resolveWatchlist, stringParam, symbolsFromComponent, useDeskAccounts, useDeskWatchlists } from "@/hooks/use-desk-data";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import { getHistoricalData } from "@/service/actions/broker";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { InstrumentRef } from "@/service/types/broker";

function isoDaysAgo(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
}

export function LiveChartWidget({ component, refreshNonce }: { component: WorkspaceComponent; refreshNonce: number }) {
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists } = useDeskWatchlists();
    const watchlist = resolveWatchlist(watchlists, component);
    const params = component.data?.params ?? {};
    const symbol = stringParam(params, ["symbol"]) || symbolsFromComponent(component, watchlist)[0] || "";
    const [output, setOutput] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account || !symbol) {
            setLoading(false);
            return;
        }
        const instrument = (isRecord(params.instrument) ? params.instrument : { exchange: "NSE", symbol }) as InstrumentRef;
        let cancelled = false;
        setLoading(true);
        void getHistoricalData(account.id, {
            from_date: stringParam(params, ["from_date"]) || isoDaysAgo(90),
            instrument: { ...instrument, symbol: instrument.symbol || symbol },
            interval: stringParam(params, ["interval"]) || "day",
            to_date: stringParam(params, ["to_date"]) || isoDaysAgo(0)
        })
            .then((result) => {
                if (cancelled) return;
                setOutput({ ok: true, ...(isRecord(result) ? result : { data: result }) });
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load chart.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, refreshNonce, symbol]);

    return (
        <WidgetState error={error || accountError} loading={loading} loadingLabel="Loading chart">
            {output ? (
                <SuppressPin>
                    <PriceChartCard input={params} name="broker_get_historical" output={output} status="success" />
                </SuppressPin>
            ) : (
                <p className="p-3 text-sm text-muted-foreground">Pick a symbol to load a price chart.</p>
            )}
        </WidgetState>
    );
}
