"use client";

import { useMemo } from "react";
import { LiveQuotesWidget } from "@/components/adaptive-workspace/live-quotes-widget";
import { LiveStatusBadge, MoveCell, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolveWatchlist, useDeskAccounts, useDeskWatchlists } from "@/hooks/use-desk-data";
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

export function LiveWatchlistWidget({ component, onPatch, refreshNonce }: Props) {
    const { account } = useDeskAccounts();
    const { error, loading, watchlists } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const selected = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const instruments = useMemo<InstrumentRef[]>(
        () =>
            (selected?.items ?? []).slice(0, 40).map((item) => ({
                ...(item.instrument_ref ?? {}),
                exchange: item.exchange ?? item.instrument_ref?.exchange,
                symbol: item.symbol
            })),
        [selected]
    );
    const demand = useMemo(
        () =>
            instruments.flatMap((item) => {
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
    const snapshots = useQuoteSnapshots(account?.id, instruments, refreshNonce);
    const live = useLivePrices(demand, `watchlist:${component.id}`, account?.user_id);

    if (!watchlists.length && !loading) {
        return <p className="p-3 text-sm text-muted-foreground">No watchlists yet. Create one under Watchlists.</p>;
    }

    return (
        <WidgetState error={error || snapshots.error} loading={loading} loadingLabel="Loading watchlist">
            <div className="flex items-center gap-2 border-b border-border/70 px-2 py-2">
                <SimpleSelect
                    aria-label="Watchlist"
                    className="h-7 min-w-0 flex-1"
                    onValueChange={(watchlistId) => onPatch({ watchlistId })}
                    options={watchlists.map((item) => ({ label: item.name, value: item.id }))}
                    size="sm"
                    value={selected?.id ?? ""}
                />
                <LiveStatusBadge
                    label={
                        live.state === "connected"
                            ? "Live"
                            : live.state === "connecting"
                              ? "Connecting"
                              : snapshots.rows.length
                                ? "Snapshot"
                                : `${selected?.items.length ?? 0} symbols`
                    }
                    tone={live.state === "connected" ? "live" : live.state === "error" ? "error" : "cached"}
                />
            </div>
            {selected?.items.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Exch</TableHead>
                            <TableHead className="text-right">LTP</TableHead>
                            <TableHead className="text-right">Chg %</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {selected.items.map((item, index) => {
                            const symbol = String(item.symbol ?? "").trim();
                            const snapshot =
                                snapshots.rows.find((row) => (row.symbol ?? "").toUpperCase() === symbol.toUpperCase()) ??
                                snapshots.rows[index];
                            const snapshotRecord = snapshot
                                ? ({ ...snapshot, ...(isRecord(snapshot.detail) ? snapshot.detail : {}) } as Record<string, unknown>)
                                : null;
                            const fromSnapshot = snapshotRecord
                                ? quoteMoveFromRecord(snapshotRecord)
                                : { changePercent: null, ltp: null };
                            const fromLive = liveTickMove(live.tickFor(symbol, account?.id, account?.broker_code));
                            const ltp = fromLive.ltp ?? fromSnapshot.ltp ?? snapshot?.ltp ?? null;
                            const changePercent = fromLive.changePercent ?? fromSnapshot.changePercent;
                            return (
                                <TableRow key={`${symbol}:${item.exchange ?? ""}`}>
                                    <TableCell className="font-semibold">{symbol || "—"}</TableCell>
                                    <TableCell className="text-muted-foreground">{item.exchange || "—"}</TableCell>
                                    <TableCell className="text-right font-mono">
                                        {ltp == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(ltp)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <MoveCell suffix="%" value={changePercent} />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            ) : (
                <LiveQuotesWidget component={component} onPatch={onPatch} refreshNonce={refreshNonce} />
            )}
        </WidgetState>
    );
}
