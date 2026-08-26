"use client";

import { useEffect, useMemo, useState } from "react";
import { DeskAccountState, LiveStatusBadge, WidgetState, WidgetToolbar } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar } from "@/components/adaptive-workspace/widget-scope-bar";
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
import { normalizeGreeks } from "@/lib/adaptive-workspace/derivatives";
import { getGreeksData } from "@/service/actions/broker";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { JsonObject } from "@/service/types/broker";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

function num(value: number | null) {
    if (value == null) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(value);
}

export function LiveGreeksWidget({ component, onPatch, refreshNonce }: Props) {
    const { spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const { watchlists } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const bound = symbolsFromComponent(component, watchlist, deskSymbols);
    const symbol = (stringParam(component.props, ["symbol"]) || bound[0] || "").toUpperCase();
    const expiry = String(widgetProp(component, "expiry") ?? "").trim();
    const strike = String(widgetProp(component, "strike") ?? "").trim();
    const optionType = String(widgetProp(component, "optionType") ?? widgetProp(component, "option_type") ?? "").trim();
    const [draftExpiry, setDraftExpiry] = useState(expiry);
    const [payload, setPayload] = useState<JsonObject | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => setDraftExpiry(expiry), [expiry]);

    useEffect(() => {
        if (!account || !symbol) {
            if (!accountsLoading) {
                setLoading(false);
                setPayload(null);
            }
            return;
        }
        let cancelled = false;
        setLoading(true);
        void getGreeksData(account.id, {
            symbol,
            exchange: "NSE",
            expiry: expiry || null,
            strike: strike || null,
            option_type: optionType || null
        })
            .then((next) => {
                if (cancelled) return;
                setPayload(next);
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load greeks.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, accountsLoading, expiry, optionType, refreshNonce, strike, symbol]);

    const view = useMemo(() => normalizeGreeks(payload), [payload]);
    const rows = view.rows.slice(0, 24);

    return (
        <WidgetState error={error || accountError} loading={accountsLoading || loading} loadingLabel="Loading greeks">
            <DeskAccountState account={account} accounts={accounts}>
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
                    placeholder="YYYY-MM-DD"
                    size="sm"
                    value={draftExpiry}
                />
                <LiveStatusBadge
                    label={view.unsupported ? "Unsupported" : rows.length ? "Live" : "Empty"}
                    tone={view.unsupported ? "error" : rows.length ? "live" : "idle"}
                />
            </WidgetToolbar>
            {view.unsupported ? (
                <p className="p-3 text-sm text-muted-foreground">
                    {view.message || "This broker does not expose option greeks on the connected account."}
                </p>
            ) : !rows.length ? (
                <p className="p-3 text-sm text-muted-foreground">
                    {view.message || "No greeks yet. Bind a symbol and an F&O expiry if the broker needs one."}
                </p>
            ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="h-8">Contract</TableHead>
                                <TableHead className="h-8 text-right">Delta</TableHead>
                                <TableHead className="h-8 text-right">Gamma</TableHead>
                                <TableHead className="h-8 text-right">Theta</TableHead>
                                <TableHead className="h-8 text-right">Vega</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={`${row.symbol}-${row.optionType}-${row.strike ?? ""}`}>
                                    <TableCell className="py-1.5 font-semibold">
                                        {row.symbol}
                                        {row.optionType && !row.symbol.toUpperCase().endsWith(row.optionType) ? (
                                            <span className="ml-1 text-[11px] font-normal text-muted-foreground">{row.optionType}</span>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{num(row.delta)}</TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{num(row.gamma)}</TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{num(row.theta)}</TableCell>
                                    <TableCell className="py-1.5 text-right font-mono">{num(row.vega)}</TableCell>
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
