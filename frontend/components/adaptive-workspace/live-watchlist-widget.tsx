"use client";

import { useMemo } from "react";
import { LiveQuotesWidget } from "@/components/adaptive-workspace/live-quotes-widget";
import { LiveStatusBadge, MoveCell, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolveWatchlist, useDeskAccounts, useDeskWatchlists } from "@/hooks/use-desk-data";
import { liveTickMove, useLivePrices } from "@/hooks/use-live-prices";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export function LiveWatchlistWidget({ component, onPatch, refreshNonce }: Props) {
    const { account } = useDeskAccounts();
    const { error, loading, watchlists } = useDeskWatchlists();
    const selected = resolveWatchlist(watchlists, component);
    const demand = useMemo(
        () =>
            (selected?.items ?? []).slice(0, 80).map((item) => ({
                account_id: account?.id,
                broker_code: account?.broker_code,
                exchange: item.exchange,
                instrument_ref: item.instrument_ref,
                symbol: item.symbol
            })),
        [account?.broker_code, account?.id, selected]
    );
    const live = useLivePrices(demand, `watchlist:${component.id}`, account?.user_id);

    if (!watchlists.length && !loading) {
        return <p className="p-3 text-sm text-muted-foreground">No watchlists yet. Create one under Watchlists.</p>;
    }

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading watchlist">
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
                    label={live.state === "connected" ? "Live" : `${selected?.items.length ?? 0} symbols`}
                    tone={live.state === "connected" ? "live" : "cached"}
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
                        {selected.items.map((item) => {
                            const move = liveTickMove(live.tickFor(item.symbol, account?.id, account?.broker_code));
                            return (
                                <TableRow key={`${item.symbol}:${item.exchange ?? ""}`}>
                                    <TableCell className="font-semibold">{item.symbol}</TableCell>
                                    <TableCell className="text-muted-foreground">{item.exchange || "—"}</TableCell>
                                    <TableCell className="text-right font-mono">
                                        {move.ltp == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(move.ltp)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <MoveCell suffix="%" value={move.changePercent} />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            ) : (
                <LiveQuotesWidget component={component} refreshNonce={refreshNonce} />
            )}
        </WidgetState>
    );
}
