"use client";

import { useMemo } from "react";
import {
    useBrokerNotifications,
    useMarkBrokerNotificationRead
} from "@/hooks/use-broker-notifications";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function NotificationsBanner() {
    const { data: notifications = [] } = useBrokerNotifications();
    const markRead = useMarkBrokerNotificationRead();

    const sorted = useMemo(() => {
        return [...notifications].sort((left, right) => {
            const leftWarning = left.kind.includes("session") ? 0 : 1;
            const rightWarning = right.kind.includes("session") ? 0 : 1;
            return leftWarning - rightWarning;
        });
    }, [notifications]);

    if (!sorted.length) {
        return null;
    }

    return (
        <section className="grid gap-3">
            {sorted.map((item) => (
                <Alert key={item.id} variant={item.kind.includes("session") ? "warning" : "default"}>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-sm font-extrabold uppercase">{item.level}</p>
                            <AlertTitle className="mt-1">{item.title}</AlertTitle>
                            <AlertDescription className="mt-1">{item.message}</AlertDescription>
                        </div>
                        <Button
                            disabled={markRead.isPending}
                            onClick={() => markRead.mutate(item.id)}
                            size="sm"
                            type="button"
                            variant="outline"
                        >
                            Dismiss
                        </Button>
                    </div>
                </Alert>
            ))}
        </section>
    );
}
