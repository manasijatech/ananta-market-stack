"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardPanel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIstDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { WorkspaceProvenance } from "@/service/types/adaptive-workspace";

const PinEnabledContext = createContext(true);

export function SuppressPin({ children }: { children: ReactNode }) {
    return <PinEnabledContext.Provider value={false}>{children}</PinEnabledContext.Provider>;
}

type Props = {
    actions?: ReactNode;
    children?: ReactNode;
    error?: string | null;
    pending?: boolean;
    pendingLabel?: string;
    provenance?: WorkspaceProvenance | null;
    title: string;
};

export function ToolCardShell({
    actions,
    children,
    error,
    pending = false,
    pendingLabel = "Loading broker data",
    provenance,
    title
}: Props) {
    const accountLabel = provenance?.account?.label || provenance?.account?.broker_code || null;
    const sourceLabel =
        provenance?.source === "cached" ? "Cached" : provenance?.source === "model" ? "Model-derived" : provenance?.source === "live" ? "Live" : null;

    const pinEnabled = useContext(PinEnabledContext);
    const body = (
        <>
            {pending ? (
                <div className="grid gap-2">
                    <p className="text-xs text-muted-foreground">{pendingLabel}</p>
                    <Skeleton className="h-7 w-40" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : null}
            {!pending && error ? (
                <div className="grid gap-2">
                    <p className={cn("text-sm", "text-destructive")}>{error}</p>
                    {children}
                </div>
            ) : null}
            {!pending && !error ? children : null}
        </>
    );
    if (!pinEnabled) {
        return <div className="px-3 py-2">{body}</div>;
    }

    return (
        <Card className="my-2 overflow-hidden border-border/80">
            <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/70 px-3 py-2.5">
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{title}</p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {accountLabel ? <Badge size="sm" variant="outline">{accountLabel}</Badge> : null}
                        {sourceLabel ? <Badge size="sm" variant="secondary">{sourceLabel}</Badge> : null}
                        {provenance?.asOf ? <span>{formatIstDateTime(provenance.asOf)}</span> : null}
                        {provenance?.toolName ? <span className="truncate font-mono">{provenance.toolName}</span> : null}
                    </div>
                </div>
                {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
            </CardHeader>
            <CardPanel className="px-3 py-3">{body}</CardPanel>
        </Card>
    );
}
