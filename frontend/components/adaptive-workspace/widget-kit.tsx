"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function LiveStatusBadge({
    label,
    tone
}: {
    label: string;
    tone: "live" | "cached" | "error" | "idle";
}) {
    return (
        <Badge
            className="max-w-[8.5rem] shrink-0 truncate"
            size="sm"
            variant={tone === "live" ? "success" : tone === "error" ? "warning" : "outline"}
        >
            {label}
        </Badge>
    );
}

export function WidgetToolbar({ children, className }: { children?: ReactNode; className?: string }) {
    return (
        <div className={cn("flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 overflow-hidden border-b border-border/50 px-2 py-1.5", className)}>
            {children}
        </div>
    );
}

export function WidgetState({
    children,
    error,
    loading,
    loadingLabel = "Loading"
}: {
    children?: ReactNode;
    error?: string | null;
    loading?: boolean;
    loadingLabel?: string;
}) {
    if (loading) {
        return (
            <div className="grid h-full gap-2 p-3">
                <p className="text-xs text-muted-foreground">{loadingLabel}</p>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-20 w-full" />
            </div>
        );
    }
    if (error) {
        return <p className="p-3 text-sm text-destructive">{error}</p>;
    }
    return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

export function MoveCell({ value, suffix = "" }: { suffix?: string; value: number | null }) {
    const tone = value == null || value === 0 ? "text-muted-foreground" : value > 0 ? "text-emerald-400" : "text-red-400";
    const text =
        value == null || !Number.isFinite(value)
            ? "—"
            : `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
    return <span className={cn("font-mono", tone)}>{text}</span>;
}
