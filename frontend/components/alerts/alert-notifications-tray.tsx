"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
 getAlertNotifications,
 getAlertUnreadCount,
 markAlertNotificationRead,
 readAllAlertNotifications
} from "@/service/actions/alerts";
import { Button } from "@/components/ui/button";
import { subscribeToAlertNotificationStream } from "@/lib/alert-notification-stream";
import type { AlertNotification } from "@/service/types/alerts";

function sseSupported() {
 return typeof window !== "undefined" && "EventSource" in window;
}

function llmOutput(payload: Record<string, unknown>) {
 const analysis = payload.llm_analysis;
 if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return "";
 const output = (analysis as Record<string, unknown>).output;
 return typeof output === "string" ? output : "";
}

export function AlertNotificationsTray() {
 const [items, setItems] = useState<AlertNotification[]>([]);
 const [unreadCount, setUnreadCount] = useState(0);
 const [open, setOpen] = useState(false);
 const [isPending, startTransition] = useTransition();

 useEffect(() => {
  let cancelled = false;
  let fallbackTimer: number | undefined;

  async function load() {
    const [count, notifications] = await Promise.all([
      getAlertUnreadCount(),
      getAlertNotifications({ unread_only: true, limit: 8 })
    ]);
    if (cancelled) return;
    setUnreadCount(count.unread_count);
    setItems(notifications);
  }

  startTransition(async () => {
    await load();
  });

  function startPolling() {
    fallbackTimer = window.setInterval(() => {
      startTransition(async () => {
        await load();
      });
    }, 15000);
  }

  let unsubscribe: () => void = () => {};
  if (sseSupported()) {
    unsubscribe = subscribeToAlertNotificationStream((payloadText) => {
      try {
        const payload = JSON.parse(payloadText) as AlertNotification;
        if (cancelled) return;
        setItems((current) => [payload, ...current.filter((item) => item.id !== payload.id)].slice(0, 8));
        setUnreadCount((current) => current + (payload.is_read ? 0 : 1));
      } catch {
        return;
      }
    });
  } else {
    startPolling();
  }

  return () => {
    cancelled = true;
    unsubscribe();
    if (fallbackTimer) window.clearInterval(fallbackTimer);
  };
 }, []);

 function markRead(id: string) {
 startTransition(async () => {
 await markAlertNotificationRead(id);
 setItems((current) => current.filter((item) => item.id !== id));
 setUnreadCount((current) => Math.max(0, current - 1));
 });
 }

 function markAllRead() {
 startTransition(async () => {
 await readAllAlertNotifications();
 setItems([]);
 setUnreadCount(0);
 });
 }

 return (
 <div className="relative">
 <Button onClick={() => setOpen((current) => !current)} type="button" variant="outline">
 <Bell className="size-4" />
 Alerts
 {unreadCount ? (
 <span className="type-meta bg-primary px-2 py-0.5 text-primary-foreground">
 {unreadCount}
 </span>
 ) : null}
 </Button>
 {open ? (
 <div className="absolute right-0 top-12 z-30 w-[360px] border border-border bg-background p-4 ">
 <div className="mb-3 flex items-center justify-between gap-3">
 <div>
 <div className="type-section-title">User alerts</div>
 <div className="type-meta">{unreadCount} unread</div>
 </div>
 <div className="flex items-center gap-2">
 <Button disabled={!items.length || isPending} onClick={markAllRead} size="sm" type="button" variant="outline">
 Read all
 </Button>
 <Button asChild size="sm" type="button">
 <Link href="/alerts">Open</Link>
 </Button>
 </div>
 </div>
 <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-1">
 {items.map((item) => (
 <div className=" border border-border p-3" key={item.id}>
 <div className="flex items-start justify-between gap-3">
 <div>
 <div className="type-section-title">{item.title}</div>
 <div className="type-help mt-1 text-muted-foreground">{item.message}</div>
 {llmOutput(item.payload) ? <div className="type-help mt-2 border-l-2 border-primary pl-2 text-muted-foreground">{llmOutput(item.payload)}</div> : null}
 </div>
 <Button onClick={() => markRead(item.id)} size="sm" type="button" variant="ghost">
 Read
 </Button>
 </div>
 </div>
 ))}
{!items.length ? <div className="type-body py-6 text-muted-foreground">No unread user alerts.</div> : null}
 </div>
 </div>
 ) : null}
 </div>
 );
}
