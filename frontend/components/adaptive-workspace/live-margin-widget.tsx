"use client";

import { useEffect, useMemo, useState } from "react";
import { DeskAccountState, LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar } from "@/components/adaptive-workspace/widget-scope-bar";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
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
import { flattenMetricRows } from "@/lib/adaptive-workspace/derivatives";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import { brokerReconnectCopy } from "@/lib/broker-auth-error";
import { calculateMarginResult } from "@/service/actions/broker";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { JsonObject } from "@/service/types/broker";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export function LiveMarginWidget({ component, onPatch, refreshNonce }: Props) {
    const { spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const { watchlists } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const bound = symbolsFromComponent(component, watchlist, deskSymbols);
    const symbol = (stringParam(component.props, ["symbol"]) || bound[0] || "").toUpperCase();
    const action = String(widgetProp(component, "action") ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const product = String(widgetProp(component, "product") ?? "CNC") || "CNC";
    const quantity = Math.max(1, Math.round(Number(widgetProp(component, "quantity") ?? 1) || 1));
    const [payload, setPayload] = useState<JsonObject | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

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
        void calculateMarginResult(account.id, {
            include_positions: true,
            positions: [
                {
                    action,
                    exchange: "NSE",
                    pricetype: "MARKET",
                    product,
                    quantity,
                    symbol
                }
            ]
        })
            .then((next) => {
                if (cancelled) return;
                if (next.ok) {
                    setPayload(next.data);
                    setError(null);
                } else {
                    setPayload(null);
                    setError(
                        next.authFailed
                            ? brokerReconnectCopy(next.error || "")
                            : next.error || "Could not calculate margin."
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, accountsLoading, action, product, quantity, refreshNonce, symbol]);

    const status = isRecord(payload) ? String(payload.status ?? "").toLowerCase() : "";
    const unsupported = status === "unsupported";
    const failed = status === "error" || status === "failed";
    const message = isRecord(payload) ? String(payload.message ?? payload.guidance ?? "") : "";
    const rows = useMemo(() => flattenMetricRows(payload), [payload]);

    return (
        <WidgetState error={error || accountError} loading={accountsLoading || loading} loadingLabel="Estimating margin">
            <DeskAccountState account={account} accounts={accounts}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-2 py-1.5">
                <WidgetScopeBar
                    allowDesk={false}
                    allowMultiSymbol={false}
                    component={component}
                    extraSymbols={deskSymbols}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={symbol}
                    watchlists={watchlists}
                />
                <SimpleSelect
                    aria-label="Action"
                    className="h-7 w-20"
                    onValueChange={(value) => onPatch({ action: value })}
                    options={[
                        { label: "BUY", value: "BUY" },
                        { label: "SELL", value: "SELL" }
                    ]}
                    size="sm"
                    value={action}
                />
                <SimpleSelect
                    aria-label="Product"
                    className="h-7 w-24"
                    onValueChange={(value) => onPatch({ product: value })}
                    options={[
                        { label: "CNC", value: "CNC" },
                        { label: "MIS", value: "MIS" },
                        { label: "NRML", value: "NRML" }
                    ]}
                    size="sm"
                    value={product}
                />
                <Input
                    aria-label="Quantity"
                    className="h-7 w-16"
                    min={1}
                    onChange={(event) => onPatch({ quantity: Math.max(1, Number(event.target.value) || 1) })}
                    size="sm"
                    type="number"
                    value={String(quantity)}
                />
                <LiveStatusBadge
                    label={unsupported ? "Unsupported" : failed ? "Error" : rows.length ? "Estimate" : "Empty"}
                    tone={unsupported || failed ? "error" : rows.length ? "cached" : "idle"}
                />
            </div>
            {unsupported ? (
                <p className="p-3 text-sm text-muted-foreground">{message || "Margin estimate is not implemented for this broker."}</p>
            ) : failed ? (
                <p className="p-3 text-sm text-muted-foreground">{message || "This broker could not estimate margin for the selected symbol."}</p>
            ) : !symbol ? (
                <p className="p-3 text-sm text-muted-foreground">Pick a symbol to estimate a one-lot MARKET margin.</p>
            ) : !rows.length ? (
                <p className="p-3 text-sm text-muted-foreground">{message || "No numeric margin fields in this broker response."}</p>
            ) : (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 text-sm">
                    {rows.map((row, index) => (
                        <div key={`${row.label}-${index}`}>
                            <dt className="text-[11px] capitalize text-muted-foreground">{row.label}</dt>
                            <dd className="font-mono font-semibold">{row.value}</dd>
                        </div>
                    ))}
                </dl>
            )}
            </DeskAccountState>
        </WidgetState>
    );
}
