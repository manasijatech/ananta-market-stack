"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribeToAlertNotificationStream } from "@/lib/alert-notification-stream";
import { queryKeys } from "@/lib/query-keys";
import {
    fetchAlertNotificationTray,
    type AlertNotificationTrayData
} from "@/lib/queries/alert-notifications";
import {
    markAlertNotificationRead,
    readAllAlertNotifications
} from "@/service/actions/alerts";
import type { AlertNotification } from "@/service/types/alerts";

const POLL_INTERVAL_MS = 15_000;

function sseSupported() {
    return typeof window !== "undefined" && "EventSource" in window;
}

/**
 * Loads the alert notification tray with live updates.
 *
 * Uses SSE when available; falls back to polling every 15 seconds otherwise.
 */
export function useAlertNotificationTray() {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: queryKeys.alerts.notificationTray(),
        queryFn: fetchAlertNotificationTray,
        refetchInterval: sseSupported() ? false : POLL_INTERVAL_MS
    });

    useEffect(() => {
        if (!sseSupported()) {
            return;
        }

        return subscribeToAlertNotificationStream((payloadText) => {
            try {
                const payload = JSON.parse(payloadText) as AlertNotification;
                queryClient.setQueryData<AlertNotificationTrayData>(
                    queryKeys.alerts.notificationTray(),
                    (current) => {
                        const items = [
                            payload,
                            ...(current?.items ?? []).filter((item) => item.id !== payload.id)
                        ].slice(0, 8);
                        const unreadDelta = payload.is_read ? 0 : 1;
                        const hadItem = (current?.items ?? []).some((item) => item.id === payload.id);
                        const unreadCount = Math.max(
                            0,
                            (current?.unreadCount ?? 0) + (hadItem ? 0 : unreadDelta)
                        );

                        return { unreadCount, items };
                    }
                );
            } catch {
                return;
            }
        });
    }, [queryClient]);

    return query;
}

/** Marks a single alert notification as read with optimistic tray cache updates. */
export function useMarkAlertNotificationRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: markAlertNotificationRead,
        onSuccess: (_, notificationId) => {
            queryClient.setQueryData<AlertNotificationTrayData>(
                queryKeys.alerts.notificationTray(),
                (current) => {
                    if (!current) {
                        return current;
                    }

                    return {
                        unreadCount: Math.max(0, current.unreadCount - 1),
                        items: current.items.filter((item) => item.id !== notificationId)
                    };
                }
            );
        }
    });
}

/** Marks all alert notifications as read and clears the tray cache. */
export function useReadAllAlertNotifications() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: readAllAlertNotifications,
        onSuccess: () => {
            queryClient.setQueryData<AlertNotificationTrayData>(queryKeys.alerts.notificationTray(), {
                unreadCount: 0,
                items: []
            });
        }
    });
}
