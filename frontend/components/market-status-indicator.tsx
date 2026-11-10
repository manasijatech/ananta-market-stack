"use client";

import { useMarketStatus } from "@/hooks/use-market-status";
import { summarizeMarketStatus } from "@/lib/market-status";
import type { MarketStatusTone } from "@/service/types/market-status";
import { cn } from "@/lib/utils";

/**
 * Exchange session marker for the workspace header.
 *
 * One line, one pip, no card: the shell is chrome, and a trader glancing at it
 * needs "open or not, and when does it open next" — not a badge competing with
 * the alert tray. The pip is a rotated square, a ticker-tape mark rather than
 * another rounded chip, and it is the only element that changes colour.
 */

const PIP: Record<MarketStatusTone, string> = {
    open: "bg-success border-success",
    pre_open: "border-warning bg-warning/30",
    closed: "border-muted-foreground/50 bg-transparent"
};

export function MarketStatusIndicator({ className }: { className?: string }) {
    const { data, isPending, isError } = useMarketStatus();
    const summary = summarizeMarketStatus(data ?? null);

    // Nothing to say before the first read, and a quiet gap is better than a
    // spinner in permanent header chrome.
    if (isPending || isError || !summary) {
        return <span aria-hidden className={cn("hidden h-4 min-[980px]:block", className)} />;
    }

    return (
        <div
            aria-label={summary.title}
            className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-[0.8125rem] leading-none text-muted-foreground",
                className
            )}
            role="status"
            title={summary.title}
        >
            <span
                aria-hidden
                className={cn(
                    "size-1.5 shrink-0 rotate-45 rounded-[1px] border",
                    PIP[summary.tone]
                )}
            />
            <span className="shrink-0 font-medium text-foreground tabular">{summary.label}</span>
            <span aria-hidden className="hidden h-3 w-px shrink-0 bg-border min-[1240px]:block" />
            <span className="hidden max-w-[22rem] truncate tabular min-[1240px]:block">{summary.detail}</span>
        </div>
    );
}
