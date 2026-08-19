"use client";

import { useCallback, useEffect, useState } from "react";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { Badge } from "@/components/ui/badge";
import { subscribeToAlertNotificationStream } from "@/lib/alert-notification-stream";
import { getAlertNotifications, getAlertWorkflows } from "@/service/actions/alerts";
import type { AlertNotification, AlertWorkflow } from "@/service/types/alerts";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    refreshNonce: number;
};

export function LiveAlertsWidget({ component, refreshNonce }: Props) {
    const unreadOnly = component.props?.unreadOnly === true || component.data?.params?.unread_only === true;
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

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading alerts">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">
                    {workflows.length} workflows · {notifications.length} notifications
                </p>
                <LiveStatusBadge label={live ? "Live" : "Polled"} tone={live ? "live" : "cached"} />
            </div>
            <div className="grid gap-3 p-2">
                <section>
                    <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workflows</p>
                    {workflows.length ? (
                        <ul className="grid gap-1.5">
                            {workflows.slice(0, 12).map((row) => (
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
                    {notifications.length ? (
                        <ul className="grid gap-1.5">
                            {notifications.slice(0, 20).map((row) => (
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
