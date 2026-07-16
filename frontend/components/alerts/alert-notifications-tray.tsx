"use client";

import Link from "next/link";
import { Bell, BellOff, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
    useAlertNotificationTray,
    useMarkAlertNotificationRead,
    useReadAllAlertNotifications
} from "@/hooks/use-alert-notifications";
import { usePendingAccessRequests } from "@/hooks/use-pending-access-requests";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardDescription,
    CardPanel,
    CardTitle
} from "@/components/ui/card";
import { AlertLlmMarkdown } from "@/components/alerts/llm-output-markdown";
import { hasRbacPermission } from "@/lib/rbac";
import type { RbacPrincipal } from "@/service/types/rbac";

function llmOutput(payload: Record<string, unknown>) {
    const analysis = payload.llm_analysis;
    if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return "";
    const output = (analysis as Record<string, unknown>).output;
    return typeof output === "string" ? output : "";
}

function AlertTrayEmptyState() {
    return (
        <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
            <BellOff className="size-4 text-muted-foreground" aria-hidden />
            <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
                <p className="max-w-[220px] text-xs leading-5 text-muted-foreground">
                    Unread alerts from your workflows will appear here.
                </p>
            </div>
            <Button render={<Link href="/alerts-workspace" />} size="sm" variant="outline">
                Set up alerts
            </Button>
        </div>
    );
}

function AlertTrayLoadingState() {
    return (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <p className="text-xs">Loading alerts…</p>
        </div>
    );
}

/** Header dropdown for unread user alert notifications and admin access requests. */
export function AlertNotificationsTray({ principal }: { principal?: RbacPrincipal | null }) {
    const { data, isPending: isLoadingTray, isError, refetch } = useAlertNotificationTray();
    const canManageAccess = hasRbacPermission(principal, "workspace.manage_members");
    const {
        data: pendingAccessRequests = [],
        isPending: isLoadingAccessRequests,
        isError: isAccessRequestsError
    } = usePendingAccessRequests(canManageAccess);
    const markRead = useMarkAlertNotificationRead();
    const markAllRead = useReadAllAlertNotifications();
    const [open, setOpen] = useState(false);
    const trayRef = useRef<HTMLDivElement | null>(null);

    const items = data?.items ?? [];
    const unreadCount = data?.unreadCount ?? 0;
    const pendingAccessCount = pendingAccessRequests.length;
    const totalCount = unreadCount + pendingAccessCount;
    const isMutationPending = markRead.isPending || markAllRead.isPending;

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
            <Button
                aria-label={totalCount > 0 ? `Alerts (${totalCount} requiring attention)` : "Alerts"}
                className="relative size-9 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-3"
                onClick={() => setOpen((current) => !current)}
                type="button"
                variant="outline"
            >
                <Bell className="size-4 shrink-0" />
                <span className="hidden sm:inline">Alerts</span>
                {totalCount > 0 ? (
                    <Badge className="hidden sm:inline-flex" size="sm" variant="secondary">
                        {totalCount}
                    </Badge>
                ) : null}
                {totalCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground sm:hidden">
                        {totalCount > 9 ? "9+" : totalCount}
                    </span>
                ) : null}
            </Button>
            {open ? (
                <Card className="absolute right-0 top-11 z-30 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl sm:w-80">
                    <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
                        <div className="min-w-0">
                            <CardTitle className="text-sm font-semibold leading-none">Alerts</CardTitle>
                            <CardDescription className="text-xs">
                                {totalCount === 0 ? "No unread alerts" : `${totalCount} needs review`}
                            </CardDescription>
                        </div>
                        <Button
                            className="h-7 shrink-0 px-2 text-xs"
                            disabled={!items.length || isMutationPending}
                            onClick={() => markAllRead.mutate()}
                            size="sm"
                            type="button"
                            variant="ghost"
                        >
                            Read all
                        </Button>
                    </div>
                    <CardPanel className="max-h-80 divide-y divide-border overflow-y-auto p-0">
                        {pendingAccessRequests.map((member) => (
                            <Link
                                className="block px-3.5 py-2.5 hover:bg-muted/40"
                                href="/settings/access"
                                key={member.user_id}
                                onClick={() => setOpen(false)}
                            >
                                <div className="flex items-start gap-2">
                                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium leading-snug text-foreground">
                                            New access request
                                        </p>
                                        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                            {(member.display_name || member.auth_name || member.email || "A workspace user")} is waiting for approval.
                                        </p>
                                    </div>
                                    <Badge className="shrink-0" size="sm" variant="warning">
                                        Review
                                    </Badge>
                                </div>
                            </Link>
                        ))}
                        {canManageAccess && isLoadingAccessRequests && !pendingAccessRequests.length ? (
                            <div className="flex items-center justify-center gap-2 py-3 text-muted-foreground">
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                <p className="text-xs">Checking access requests...</p>
                            </div>
                        ) : null}
                        {canManageAccess && isAccessRequestsError ? (
                            <div className="px-3.5 py-2.5 text-xs text-muted-foreground">
                                Could not load access requests.
                            </div>
                        ) : null}
                        {isLoadingTray && !items.length ? <AlertTrayLoadingState /> : null}
                        {isError ? (
                            <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                                <p className="text-xs text-destructive">Could not load alerts.</p>
                                <Button onClick={() => void refetch()} size="sm" type="button" variant="outline">
                                    Retry
                                </Button>
                            </div>
                        ) : null}
                        {items.map((item) => (
                            <div className="px-3.5 py-2.5 hover:bg-muted/40" key={item.id}>
                                <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium leading-snug text-foreground">
                                            {item.title}
                                        </p>
                                        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                            {item.message}
                                        </p>
                                        {llmOutput(item.payload) ? (
                                            <AlertLlmMarkdown className="mt-1.5 border-l border-primary/40 pl-2 text-xs leading-5 text-muted-foreground">
                                                {llmOutput(item.payload)}
                                            </AlertLlmMarkdown>
                                        ) : null}
                                    </div>
                                    <Button
                                        className="h-auto shrink-0 px-1.5 py-0.5 text-xs text-muted-foreground"
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
                        {!items.length && !pendingAccessRequests.length && !isLoadingTray && !isError ? (
                            <AlertTrayEmptyState />
                        ) : null}
                    </CardPanel>
                </Card>
            ) : null}
        </div>
    );
}
