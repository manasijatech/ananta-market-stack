"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
    useAlertNotificationTray,
    useMarkAlertNotificationRead,
    useReadAllAlertNotifications
} from "@/hooks/use-alert-notifications";
import { Button } from "@/components/ui/button";
import { AlertLlmMarkdown } from "@/components/alerts/llm-output-markdown";

function llmOutput(payload: Record<string, unknown>) {
    const analysis = payload.llm_analysis;
    if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return "";
    const output = (analysis as Record<string, unknown>).output;
    return typeof output === "string" ? output : "";
}

export function AlertNotificationsTray() {
    const { data } = useAlertNotificationTray();
    const markRead = useMarkAlertNotificationRead();
    const markAllRead = useReadAllAlertNotifications();
    const [open, setOpen] = useState(false);
    const trayRef = useRef<HTMLDivElement | null>(null);

    const items = data?.items ?? [];
    const unreadCount = data?.unreadCount ?? 0;
    const isPending = markRead.isPending || markAllRead.isPending;

    useEffect(() => {
        if (!open) return;

        function handlePointerDown(event: PointerEvent) {
            const target = event.target;
            if (!(target instanceof Node) || trayRef.current?.contains(target)) return;
            setOpen(false);
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") setOpen(false);
        }

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open]);

    return (
        <div className="relative" ref={trayRef}>
            <Button onClick={() => setOpen((current) => !current)} type="button" variant="outline">
                <Bell className="size-4" />
                Alerts
                {unreadCount ? (
                    <span className="type-meta bg-primary px-2 py-0.5 text-primary-foreground">{unreadCount}</span>
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
                            <Button
                                disabled={!items.length || isPending}
                                onClick={() => markAllRead.mutate()}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                Read all
                            </Button>
                            <Button asChild size="sm" type="button">
                                <Link href="/alerts-workspace">Open</Link>
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
                                        {llmOutput(item.payload) ? (
                                            <AlertLlmMarkdown className="mt-2 border-l-2 border-primary pl-2 text-xs text-muted-foreground">
                                                {llmOutput(item.payload)}
                                            </AlertLlmMarkdown>
                                        ) : null}
                                    </div>
                                    <Button
                                        onClick={() => markRead.mutate(item.id)}
                                        size="sm"
                                        type="button"
                                        variant="ghost"
                                    >
                                        Read
                                    </Button>
                                </div>
                            </div>
                        ))}
                        {!items.length ? (
                            <div className="type-body py-6 text-muted-foreground">No unread user alerts.</div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
