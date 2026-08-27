"use client";

import { useCallback, useEffect, useState } from "react";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { WidgetScopeBar } from "@/components/adaptive-workspace/widget-scope-bar";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import {
    resolveWatchlist,
    stringParam,
    symbolsFromComponent,
    universeSymbols,
    useDeskWatchlists
} from "@/hooks/use-desk-data";
import { subscribeToAlertNotificationStream } from "@/lib/alert-notification-stream";
import { getAlertNotifications, getAlertWorkflows } from "@/service/actions/alerts";
import type { AlertNotification, AlertWorkflow } from "@/service/types/alerts";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    refreshNonce: number;
};

export function LiveAlertsWidget({ component, onPatch, refreshNonce }: Props) {
    const unreadOnly = component.props?.unreadOnly === true || component.data?.params?.unread_only === true;
    const { spec } = useAdaptiveWorkspace();
    const deskSymbols = universeSymbols(spec);
    const { watchlists } = useDeskWatchlists();
    const prefs = useOptionalAdaptiveDeskPrefs();
    const watchlist = resolveWatchlist(watchlists, component, prefs?.defaultWatchlistId);
    const symbols = symbolsFromComponent(component, watchlist, deskSymbols).map((item) => item.toUpperCase());
    const symbolFilter = stringParam(component.props, ["symbol"]).toUpperCase();
    const [workflows, setWorkflows] = useState<AlertWorkflow[]>([]);
    const [notifications, setNotifications] = useState<AlertNotification[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [live, setLive] = useState(false);

    const load = useCallback(async () => {
        try {
            const [nextWorkflows, nextNotes] = await Promise.all([
                getAlertWorkflows(),
                getAlertNotifications({ limit: 40, unread_only: unreadOnly })
            ]);
            setWorkflows(nextWorkflows);
            setNotifications(nextNotes);
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not load alerts.");
        } finally {
            setLoading(false);
        }
    }, [unreadOnly]);

    useEffect(() => {
        setLoading(true);
        void load();
        const poll = window.setInterval(() => void load(), 20_000);
        return () => window.clearInterval(poll);
    }, [load, refreshNonce]);

    useEffect(() => {
        return subscribeToAlertNotificationStream(() => {
            setLive(true);
            void load();
        });
    }, [load]);

    const wanted = new Set(symbolFilter ? [symbolFilter] : symbols);
    const visibleWorkflows = wanted.size
        ? workflows.filter((row) => !row.symbol || wanted.has(String(row.symbol).toUpperCase()))
        : workflows;
    const visibleNotes = wanted.size
        ? notifications.filter((row) => !row.symbol || wanted.has(String(row.symbol).toUpperCase()))
        : notifications;

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading alerts">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border/70 px-2 py-2">
                <WidgetScopeBar
                    allowDesk
                    extraSymbols={deskSymbols}
                    component={component}
                    onPatch={onPatch}
                    selectedWatchlist={watchlist}
                    symbol={symbolFilter || symbols[0] || ""}
                    watchlists={watchlists}
                />
                <LiveStatusBadge label={live ? "Live" : "Polled"} tone={live ? "live" : "cached"} />
            </div>
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">
                {visibleWorkflows.length} workflows · {visibleNotes.length} notifications
            </p>
            <div className="grid gap-3 p-2">
                <section>
                    <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workflows</p>
                    {visibleWorkflows.length ? (
                        <ul className="grid gap-1.5">
                            {visibleWorkflows.slice(0, 12).map((row) => (
                                <li className="rounded-md border border-border/70 px-2.5 py-2" key={row.id}>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {row.symbol ? (
                                            <Badge size="sm" variant="outline">
                                                {row.symbol}
                                            </Badge>
                                        ) : null}
                                        <span className="text-[11px] text-muted-foreground">{row.status}</span>
                                    </div>
                                    <p className="mt-1 text-sm font-medium">{row.name}</p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="px-1 text-sm text-muted-foreground">No alert workflows yet.</p>
                    )}
                </section>
                <section>
                    <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notifications</p>
                    {visibleNotes.length ? (
                        <ul className="grid gap-1.5">
                            {visibleNotes.slice(0, 20).map((row) => (
                                <li className="rounded-md border border-border/70 px-2.5 py-2" key={row.id}>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {row.symbol ? (
                                            <Badge size="sm" variant="outline">
                                                {row.symbol}
                                            </Badge>
                                        ) : null}
                                        <span className="text-[11px] text-muted-foreground">{row.level}</span>
                                    </div>
                                    <p className="mt-1 text-sm font-medium">{row.title}</p>
                                    {row.message ? <p className="mt-0.5 text-xs text-muted-foreground">{row.message}</p> : null}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="px-1 text-sm text-muted-foreground">No alert notifications yet.</p>
                    )}
                </section>
            </div>
        </WidgetState>
    );
}
