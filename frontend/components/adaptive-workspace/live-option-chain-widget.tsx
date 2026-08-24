"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveStatusBadge, WidgetState, WidgetToolbar } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar } from "@/components/adaptive-workspace/widget-scope-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import {
    resolveWatchlist,
    stringParam,
    symbolsFromComponent,
    universeSymbols,
    useDeskAccounts,
    useDeskWatchlists,
    widgetProp
} from "@/hooks/use-desk-data";
import { normalizeOptionChain } from "@/lib/adaptive-workspace/derivatives";
import { getOptionChainData } from "@/service/actions/broker";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { JsonObject } from "@/service/types/broker";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

function money(value: number | null) {
    if (value == null) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

export function LiveOptionChainWidget({ component, onPatch, refreshNonce }: Props) {
    const { spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { account, error: accountError } = useDeskAccounts();
    const { watchlists } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const bound = symbolsFromComponent(component, watchlist, deskSymbols);
    const symbol = (stringParam(component.props, ["symbol"]) || bound[0] || "").toUpperCase();
    const expiry = String(widgetProp(component, "expiry") ?? "").trim();
    const [draftExpiry, setDraftExpiry] = useState(expiry);
    const [payload, setPayload] = useState<JsonObject | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setDraftExpiry(expiry);
    }, [expiry]);

    useEffect(() => {
        if (!account || !symbol) {
            setLoading(false);
            setPayload(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void getOptionChainData(account.id, { symbol, exchange: "NSE", expiry: expiry || null })
            .then((next) => {
                if (cancelled) return;
                setPayload(next);
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load option chain.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, expiry, refreshNonce, symbol]);

    const view = useMemo(() => normalizeOptionChain(payload), [payload]);
    const rows = view.rows.slice(0, 40);
    const activeExpiry = expiry || view.expiries[0] || "";

    return (
        <WidgetState error={error || accountError} loading={loading} loadingLabel="Loading option chain">
            <WidgetToolbar>
                <div className="flex min-w-0 w-full items-center gap-1.5">
                    <WidgetScopeBar
                        allowDesk={false}
                        allowMultiSymbol={false}
                        allowWatchlist={false}
                        component={component}
                        extraSymbols={deskSymbols}
                        onPatch={onPatch}
                        selectedWatchlist={watchlist}
                        symbol={symbol}
                        watchlists={watchlists}
                    />
                </div>
                <Input
                    aria-label="Expiry"
                    className="h-7 w-[9.5rem] max-w-full min-w-0 shrink-0"
                    onBlur={() => {
                        if (draftExpiry !== expiry) onPatch({ expiry: draftExpiry });
                    }}
                    onChange={(event) => setDraftExpiry(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && draftExpiry !== expiry) onPatch({ expiry: draftExpiry });
                    }}
                    placeholder="YYYY-MM-DD"
                    size="sm"
                    value={draftExpiry}
                />
                <LiveStatusBadge
                    label={view.unsupported ? "Unsupported" : rows.length ? "Live" : "Empty"}
                    tone={view.unsupported ? "error" : rows.length ? "live" : "idle"}
                />
            </WidgetToolbar>
            {view.expiries.length ? (
                <div className="flex flex-wrap gap-1 border-b border-border/40 px-2 py-1.5">
                    {view.expiries.slice(0, 8).map((item) => (
                        <Button
                            key={item}
                            onClick={() => onPatch({ expiry: item })}
                            size="xs"
                            type="button"
                            variant={item === activeExpiry ? "default" : "outline"}
                        >
                            {item}
                        </Button>
                    ))}
                </div>
            ) : null}
            {view.unsupported ? (
                <p className="p-3 text-sm text-muted-foreground">
                    {view.message || "This broker does not expose an option chain. Quotes, heatmap, and P&L still work on the connected account."}
                </p>
            ) : !symbol ? (
                <p className="p-3 text-sm text-muted-foreground">Pick a symbol to load the option chain.</p>
            ) : !rows.length ? (
                <p className="p-3 text-sm text-muted-foreground">
                    {view.message || (expiry ? "No strikes returned for this expiry." : "Enter an F&O expiry (YYYY-MM-DD) if this broker requires one.")}
                </p>
            ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                    {view.spot != null ? (
                        <p className="px-3 pt-2 text-[11px] text-muted-foreground">
                            {view.underlying || symbol} spot {money(view.spot)}
                        </p>
                    ) : null}
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="h-8 text-right">CE LTP</TableHead>
                                <TableHead className="h-8 text-right">CE OI</TableHead>
                                <TableHead className="h-8 text-center">Strike</TableHead>
                                <TableHead className="h-8 text-right">PE LTP</TableHead>
                                <TableHead className="h-8 text-right">PE OI</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={row.strike}>
                                    <TableCell className="py-1.5 text-right font-mono">{money(row.ce.ltp)}</TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{money(row.ce.oi)}</TableCell>
                                    <TableCell className="py-1.5 text-center font-semibold">{money(row.strike)}</TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{money(row.pe.ltp)}</TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{money(row.pe.oi)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </WidgetState>
    );
}
