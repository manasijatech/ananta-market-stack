"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { getNotifications, markNotificationRead } from "@/service/actions/broker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Notification } from "@/service/types/broker";

export function NotificationsBanner() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setNotifications((await getNotifications()).filter((item) => !item.is_read));
    });
  }, []);

  const sorted = useMemo(() => {
    return [...notifications].sort((left, right) => {
      const leftWarning = left.kind.includes("session") ? 0 : 1;
      const rightWarning = right.kind.includes("session") ? 0 : 1;
      return leftWarning - rightWarning;
    });
  }, [notifications]);

  function dismiss(id: string) {
    startTransition(async () => {
      await markNotificationRead(id);
      setNotifications((current) => current.filter((item) => item.id !== id));
    });
  }

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
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => dismiss(item.id)}
              type="button"
            >
              Dismiss
            </Button>
          </div>
        </Alert>
      ))}
    </section>
  );
}
