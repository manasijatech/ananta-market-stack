"use client";

import { useMemo } from "react";
import { LiveStatusBadge, MoveCell, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar, scopeHint } from "@/components/adaptive-workspace/widget-scope-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    componentScope,
    instrumentForSymbol,
    resolveWatchlist,
    symbolsFromComponent,
    useDeskAccounts,
    useDeskWatchlists
} from "@/hooks/use-desk-data";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { liveTickMove, useLivePrices } from "@/hooks/use-live-prices";
import { useQuoteSnapshots } from "@/hooks/use-quote-snapshots";
import { quoteMoveFromRecord } from "@/lib/adaptive-workspace/quote-fields";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { InstrumentRef } from "@/service/types/broker";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export function LiveQuotesWidget({ component, onPatch, refreshNonce }: Props) {
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const instruments = useMemo<InstrumentRef[]>(() => {
        const symbols = symbolsFromComponent(component, watchlist);
        if (componentScope(component) === "symbol") {
            return symbols.map((symbol) => instrumentForSymbol(watchlists, symbol, component) as InstrumentRef);
        }
        if (watchlist?.items.length) {
            return watchlist.items.map((item) => ({
                ...(item.instrument_ref ?? {}),
                exchange: item.exchange ?? item.instrument_ref?.exchange,
                symbol: item.symbol
            }));
        }
        return symbols.map((symbol) => instrumentForSymbol(watchlists, symbol, component) as InstrumentRef);
    }, [component, watchlist, watchlists]);
    const { error, rows } = useQuoteSnapshots(account?.id, instruments, refreshNonce);
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
    const focusSymbol = symbolsFromComponent(component, watchlist)[0] || "";

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
        <WidgetState error={error || accountError} loading={listsLoading && !instruments.length} loadingLabel="Loading live quotes">
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                <WidgetScopeBar
                    component={component}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={focusSymbol}
                    watchlists={watchlists}
                />
                <LiveStatusBadge
                    label={live.state === "connected" ? "Live" : live.state === "connecting" ? "Connecting" : "Snapshot"}
                    tone={live.state === "connected" ? "live" : live.state === "error" ? "error" : "cached"}
                />
            </div>
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">{scopeHint(component, watchlist?.name)}</p>
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
