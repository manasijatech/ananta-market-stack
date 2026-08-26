"use client";

import { useEffect, useMemo, useState } from "react";
import { DeskAccountState, LiveStatusBadge, MoveCell, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { normalizeHoldings, normalizePositions } from "@/components/brokers/normalizers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeskAccounts } from "@/hooks/use-desk-data";
import { cn } from "@/lib/utils";
import { getHoldings, getPositions } from "@/service/actions/broker";
import type { JsonObject } from "@/service/types/broker";

type Props = {
    refreshNonce: number;
};

type ExposureRow = {
    id: string;
    kind: "Holding" | "Position";
    pnl: number;
    quantity: number;
    symbol: string;
};

function money(value: number) {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

export function LivePnlWidget({ refreshNonce }: Props) {
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const [holdingsPayload, setHoldingsPayload] = useState<JsonObject | null>(null);
    const [positionsPayload, setPositionsPayload] = useState<JsonObject | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account) {
            if (!accountsLoading) setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        Promise.all([getHoldings(account.id), getPositions(account.id).catch(() => ({}))])
            .then(([holdings, positions]) => {
                if (cancelled) return;
                setHoldingsPayload(holdings);
                setPositionsPayload(positions);
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load P&L.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, accountsLoading, refreshNonce]);

    const rows = useMemo<ExposureRow[]>(() => {
        const holdings = holdingsPayload ? normalizeHoldings(holdingsPayload) : [];
        const positions = positionsPayload ? normalizePositions(positionsPayload) : [];
        const fromHoldings: ExposureRow[] = holdings.map((row) => ({
            id: `h-${row.id}`,
            kind: "Holding",
            pnl: row.pnl ?? 0,
            quantity: row.quantity,
            symbol: row.symbol
        }));
        const fromPositions: ExposureRow[] = positions.map((row) => ({
            id: `p-${row.id}`,
            kind: "Position",
            pnl: row.pnl ?? 0,
            quantity: row.quantity,
            symbol: row.symbol
        }));
        return [...fromHoldings, ...fromPositions]
            .filter((row) => row.quantity !== 0 || row.pnl !== 0)
            .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
    }, [holdingsPayload, positionsPayload]);

    const totalPnl = rows.reduce((sum, row) => sum + row.pnl, 0);
    const winners = rows.filter((row) => row.pnl > 0).length;
    const losers = rows.filter((row) => row.pnl < 0).length;

    return (
        <WidgetState error={error || accountError} loading={accountsLoading || loading} loadingLabel="Loading P&L exposure">
            <DeskAccountState account={account} accounts={accounts}>
            <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
                <div>
                    <p className="text-[11px] text-muted-foreground">Net P&L</p>
                    <p className={cn("font-mono text-sm font-semibold", totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-red-400" : "text-muted-foreground")}>
                        {totalPnl > 0 ? "+" : ""}
                        {money(totalPnl)}
                    </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                    {winners} up · {losers} down
                </p>
                <LiveStatusBadge label={account?.label || "Broker"} tone="live" />
            </div>
            {!rows.length ? (
                <p className="p-3 text-sm text-muted-foreground">No holdings or positions with P&L on this account yet.</p>
            ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="h-8">Symbol</TableHead>
                                <TableHead className="h-8">Book</TableHead>
                                <TableHead className="h-8 text-right">Qty</TableHead>
                                <TableHead className="h-8 text-right">P&amp;L</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.slice(0, 16).map((row) => (
                                <TableRow key={row.id}>
                                    <TableCell className="py-1.5 font-semibold">{row.symbol}</TableCell>
                                    <TableCell className="py-1.5 text-xs text-muted-foreground">{row.kind}</TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{row.quantity}</TableCell>
                                    <TableCell className="py-1.5 text-right">
                                        <MoveCell value={row.pnl} />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            </DeskAccountState>
        </WidgetState>
    );
}
