"use client";

import { useMemo } from "react";
import { useBrokerNotifications, useMarkBrokerNotificationRead } from "@/hooks/use-broker-notifications";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Dismissible banner for unread broker connection notifications. */
export function NotificationsBanner() {
    const { data: notifications = [] } = useBrokerNotifications();
    const markRead = useMarkBrokerNotificationRead();

    const sorted = useMemo(() => {
        const unique = new Map<string, (typeof notifications)[number]>();
        notifications.forEach((item) => {
            const key = item.kind.includes("session")
                ? [item.account_id ?? "", item.broker_code ?? "", item.kind].join(":")
                : item.id;
            if (!unique.has(key)) {
                unique.set(key, item);
            }
        });

        return [...unique.values()].sort((left, right) => {
            const leftWarning = left.kind.includes("session") ? 0 : 1;
            const rightWarning = right.kind.includes("session") ? 0 : 1;
            return leftWarning - rightWarning;
        });
    }, [notifications]);

    if (!sorted.length) {
        return null;
    }

    return (
        <section className="grid gap-2.5">
            {sorted.map((item) => (
                <Alert
                    className="rounded-lg px-3 py-2.5"
                    key={item.id}
                    variant={item.kind.includes("session") ? "warning" : "default"}
                >
                    <AlertTitle className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold uppercase leading-none text-foreground">
                            {item.level}
                        </span>
                        <span>{item.title}</span>
                    </AlertTitle>
                    <AlertDescription className="mt-1 text-[13px] leading-relaxed">{item.message}</AlertDescription>
                    <AlertAction className="max-sm:col-start-1">
                        <Button
                            disabled={markRead.isPending}
                            onClick={() => markRead.mutate(item.id)}
                            size="xs"
                            type="button"
                            variant="outline"
                        >
                            Dismiss
                        </Button>
                    </AlertAction>
                </Alert>
            ))}
        </section>
    );
}
