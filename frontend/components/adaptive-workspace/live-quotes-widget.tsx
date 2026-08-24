"use client";

import { useMemo } from "react";
import { LiveStatusBadge, MoveCell, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import {
    WidgetScopeBar,
    readHiddenSymbols,
    scopeHint,
    toggleHiddenSymbol,
    withHiddenAtBottom
} from "@/components/adaptive-workspace/widget-scope-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import {
    componentScope,
    instrumentForSymbol,
    resolveWatchlist,
    symbolsFromComponent,
    universeSymbols,
    useDeskAccounts,
    useDeskWatchlists
} from "@/hooks/use-desk-data";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { liveTickMove, useLivePrices } from "@/hooks/use-live-prices";
import { useQuoteSnapshots } from "@/hooks/use-quote-snapshots";
import { quoteMoveFromRecord } from "@/lib/adaptive-workspace/quote-fields";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import { cn } from "@/lib/utils";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { LivePriceTick } from "@/service/types/alerts";
import type { InstrumentRef, QuoteResponse } from "@/service/types/broker";
import type { Watchlist } from "@/service/types/watchlist";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export type QuoteMoveRow = {
    change: number | null;
    changePercent: number | null;
    exchange: "BSE" | null;
    hidden: boolean;
    ltp: number | null;
    symbol: string;
};

export function bseExchange(source: unknown, instrumentExchange?: string | null): "BSE" | null {
    let fromSource = "";
    if (isRecord(source)) {
        fromSource = String(source.exchange ?? "").trim().toUpperCase();
        if (!fromSource && isRecord(source.detail)) {
            fromSource = String(source.detail.exchange ?? "").trim().toUpperCase();
        }
    }
    const fromInstrument = String(instrumentExchange ?? "").trim().toUpperCase();
    return fromSource === "BSE" || fromInstrument === "BSE" ? "BSE" : null;
}

export function instrumentsForComponent(
    component: WorkspaceComponent,
    watchlist: Watchlist | null,
    watchlists: Watchlist[]
): InstrumentRef[] {
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
}

export function HideSymbolButton({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
    return (
        <Button onClick={onToggle} size="xs" type="button" variant="ghost">
            {hidden ? "Show" : "Hide"}
        </Button>
    );
}

export function buildQuoteMoveRows(
    instruments: InstrumentRef[],
    snapshots: QuoteResponse[],
    live: { tickFor: (symbol: string, accountId?: string | null, brokerCode?: string | null) => LivePriceTick | undefined },
    account: { broker_code?: string; id?: string } | null | undefined,
    hidden: ReadonlySet<string>
): QuoteMoveRow[] {
    const rows = instruments.slice(0, 40).map((instrument, index) => {
        const symbol = String(instrument.symbol ?? "").trim().toUpperCase();
        const snapshot = snapshots.find((row) => (row.symbol ?? "").toUpperCase() === symbol) ?? snapshots[index];
        const snapshotRecord = snapshot
            ? ({ ...snapshot, ...(isRecord(snapshot.detail) ? snapshot.detail : {}) } as Record<string, unknown>)
            : null;
        const fromSnapshot = snapshotRecord ? quoteMoveFromRecord(snapshotRecord) : { change: null, changePercent: null, ltp: null };
        const tick = live.tickFor(symbol, account?.id, account?.broker_code);
        const fromLive = liveTickMove(tick);
        return {
            change: fromLive.change ?? fromSnapshot.change,
            changePercent: fromLive.changePercent ?? fromSnapshot.changePercent,
            exchange: bseExchange(snapshotRecord, instrument.exchange),
            hidden: hidden.has(symbol),
            ltp: fromLive.ltp ?? fromSnapshot.ltp ?? snapshot?.ltp ?? null,
            symbol
        };
    });
    return withHiddenAtBottom(rows, hidden, (row) => row.symbol);
}

export function QuotesMoveTable({
    emptyLabel = "No symbols bound to this quotes widget yet.",
    layoutLocked = false,
    onRemove,
    onToggleHidden,
    rows,
    showExchangeBadge = false
}: {
    emptyLabel?: string;
    layoutLocked?: boolean;
    onRemove?: (symbol: string) => void;
    onToggleHidden: (symbol: string) => void;
    rows: QuoteMoveRow[];
    showExchangeBadge?: boolean;
}) {
    if (!rows.length) {
        return <p className="p-3 text-sm text-muted-foreground">{emptyLabel}</p>;
    }
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="h-8 py-1">Symbol</TableHead>
                    <TableHead className="h-8 py-1 text-right">LTP</TableHead>
                    <TableHead className="h-8 py-1 text-right">Change</TableHead>
                    <TableHead className="h-8 py-1 text-right">Change %</TableHead>
                    {layoutLocked ? null : <TableHead className="h-8 w-24 py-1 text-right"> </TableHead>}
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow className={cn(row.hidden && "text-muted-foreground")} key={row.symbol}>
                        <TableCell className={cn("py-1.5 font-semibold", row.hidden && "opacity-60")}>
                            <span className="inline-flex items-center gap-1.5">
                                {row.symbol}
                                {showExchangeBadge && row.exchange ? (
                                    <Badge size="sm" variant="outline">
                                        {row.exchange}
                                    </Badge>
                                ) : null}
                            </span>
                        </TableCell>
                        <TableCell className={cn("text-right font-mono", row.hidden && "opacity-60")}>
                            {row.ltp == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(row.ltp)}
                        </TableCell>
                        <TableCell className={cn("text-right", row.hidden && "opacity-60")}>
                            <MoveCell value={row.change} />
                        </TableCell>
                        <TableCell className={cn("text-right", row.hidden && "opacity-60")}>
                            <MoveCell suffix="%" value={row.changePercent} />
                        </TableCell>
                        {layoutLocked ? null : (
                            <TableCell className="text-right">
                                <span className="inline-flex items-center justify-end gap-0.5">
                                    <HideSymbolButton hidden={row.hidden} onToggle={() => onToggleHidden(row.symbol)} />
                                    {onRemove ? (
                                        <Button
                                            aria-label={`Remove ${row.symbol} from desk list`}
                                            onClick={() => onRemove(row.symbol)}
                                            size="xs"
                                            type="button"
                                            variant="ghost"
                                        >
                                            Remove
                                        </Button>
                                    ) : null}
                                </span>
                            </TableCell>
                        )}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export function LiveQuotesWidget({ component, onPatch, refreshNonce }: Props) {
    const { patchUniverse, spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists, loading: listsLoading } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const bound = symbolsFromComponent(component, watchlist, deskSymbols);
    const instruments = useMemo(
        () =>
            componentScope(component) === "desk"
                ? bound.map((symbol) => instrumentForSymbol(watchlists, symbol, component) as InstrumentRef)
                : instrumentsForComponent(component, watchlist, watchlists),
        [bound, component, watchlist, watchlists]
    );
    const hiddenList = readHiddenSymbols(component);
    const hiddenKey = hiddenList.join("|");
    const hidden = useMemo(() => new Set(hiddenKey ? hiddenKey.split("|") : []), [hiddenKey]);
    const { error, rows } = useQuoteSnapshots(account?.id, instruments, refreshNonce);
    const demand = useMemo(
        () =>
            instruments.slice(0, 40).flatMap((item) => {
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
    const focusSymbol = bound[0] || "";
    const tableRows = buildQuoteMoveRows(instruments, rows, live, account, hidden);

    return (
        <WidgetState error={error || accountError} loading={listsLoading && !instruments.length} loadingLabel="Loading live quotes">
            <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5">
                <WidgetScopeBar
                    allowDesk
                    allowMultiSymbol
                    component={component}
                    extraSymbols={deskSymbols}
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
            {prefs?.canvasLocked !== false ? null : (
                <p className="px-3 pt-1 text-[11px] text-muted-foreground">{scopeHint(component, watchlist?.name, deskSymbols.length)}</p>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
            <QuotesMoveTable
                layoutLocked={prefs?.canvasLocked !== false}
                onRemove={
                    componentScope(component) === "desk"
                        ? (symbol) => patchUniverse(deskSymbols.filter((item) => item !== symbol))
                        : undefined
                }
                onToggleHidden={(symbol) => onPatch({ hiddenSymbols: toggleHiddenSymbol(hiddenList, symbol) })}
                rows={tableRows}
                showExchangeBadge
            />
            </div>
        </WidgetState>
    );
}
