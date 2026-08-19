"use client";

import { useMemo } from "react";
import { LiveStatusBadge, MoveCell, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeskAccounts, useDeskWatchlists, resolveWatchlist, stringListParam, symbolsFromComponent } from "@/hooks/use-desk-data";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { liveTickMove, useLivePrices } from "@/hooks/use-live-prices";
import { useQuoteSnapshots } from "@/hooks/use-quote-snapshots";
import { quoteMoveFromRecord } from "@/lib/adaptive-workspace/quote-fields";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { InstrumentRef } from "@/service/types/broker";

type Props = {
    component: WorkspaceComponent;
    refreshNonce: number;
};

function instrumentsFor(component: WorkspaceComponent, watchlist: ReturnType<typeof resolveWatchlist>): InstrumentRef[] {
    const params = component.data?.params ?? {};
    const raw = params.instruments;
    if (Array.isArray(raw)) {
        return raw.flatMap((item) => {
            if (!isRecord(item) || typeof item.symbol !== "string" || !item.symbol.trim()) return [];
            return [{ ...item, symbol: item.symbol.trim().toUpperCase() } as InstrumentRef];
        });
    }
    if (watchlist?.items.length) {
        return watchlist.items.map((item) => ({
            ...(item.instrument_ref ?? {}),
            exchange: item.exchange ?? item.instrument_ref?.exchange,
            symbol: item.symbol
        }));
    }
    return symbolsFromComponent(component, watchlist).map((symbol) => ({ symbol, exchange: "NSE" }));
}

export function LiveQuotesWidget({ component, refreshNonce }: Props) {
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const instruments = useMemo(() => instrumentsFor(component, watchlist), [component, watchlist]);
    const { error, loading, rows } = useQuoteSnapshots(account?.id, instruments, refreshNonce);
    const demand = useMemo(
        () =>
            instruments
                .slice(0, 40)
                .flatMap((item) => {
                    const symbol = String(item.symbol ?? "").trim();
                    if (!symbol) return [];
                    return [
                        {
                            account_id: account?.id,
                            broker_code: account?.broker_code,
                            exchange: item.exchange,
                            instrument_ref: item,
                            symbol
                        }
                    ];
                }),
        [account?.broker_code, account?.id, instruments]
    );
    const live = useLivePrices(demand, `quotes:${component.id}`, account?.user_id);

    const tableRows = instruments.slice(0, 40).map((instrument, index) => {
        const symbol = String(instrument.symbol ?? "").trim();
        const snapshot = rows.find((row) => (row.symbol ?? "").toUpperCase() === symbol.toUpperCase()) ?? rows[index];
        const snapshotRecord = snapshot
            ? ({ ...snapshot, ...(isRecord(snapshot.detail) ? snapshot.detail : {}) } as Record<string, unknown>)
            : null;
        const fromSnapshot = snapshotRecord ? quoteMoveFromRecord(snapshotRecord) : { change: null, changePercent: null, ltp: null };
        const tick = live.tickFor(symbol, account?.id, account?.broker_code);
        const fromLive = liveTickMove(tick);
        return {
            change: fromLive.change ?? fromSnapshot.change,
            changePercent: fromLive.changePercent ?? fromSnapshot.changePercent,
            ltp: fromLive.ltp ?? fromSnapshot.ltp ?? snapshot?.ltp ?? null,
            symbol
        };
    });

    return (
        <WidgetState error={error || accountError} loading={loading || listsLoading} loadingLabel="Loading live quotes">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="truncate text-xs text-muted-foreground">
                    {watchlist ? watchlist.name : stringListParam(component.data?.params, ["symbols"]).length ? "Requested symbols" : "Quotes"}
                </p>
                <LiveStatusBadge
                    label={live.state === "connected" ? "Live" : live.state === "connecting" ? "Connecting" : "Snapshot"}
                    tone={live.state === "connected" ? "live" : live.state === "error" ? "error" : "cached"}
                />
            </div>
            {tableRows.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="text-right">LTP</TableHead>
                            <TableHead className="text-right">Change</TableHead>
                            <TableHead className="text-right">Change %</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tableRows.map((row) => (
                            <TableRow key={row.symbol}>
                                <TableCell className="font-semibold">{row.symbol}</TableCell>
                                <TableCell className="text-right font-mono">
                                    {row.ltp == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(row.ltp)}
                                </TableCell>
                                <TableCell className="text-right">
                                    <MoveCell value={row.change} />
                                </TableCell>
                                <TableCell className="text-right">
                                    <MoveCell suffix="%" value={row.changePercent} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <p className="p-3 text-sm text-muted-foreground">No symbols bound to this quotes widget yet.</p>
            )}
        </WidgetState>
    );
}
