"use client";

import { useIslandDisplayedValues } from "@/components/adaptive-workspace/live-price-island-context";
import { cn } from "@/lib/utils";
import type { LiveLtpIslandAttrs } from "@/lib/live-ltp-island";

function formatLtp(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function formatChg(value: number | null): string | null {
    if (value == null || !Number.isFinite(value)) return null;
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function moveTone(chgPct: number | null): "up" | "down" | "flat" {
    if (chgPct == null || !Number.isFinite(chgPct) || chgPct === 0) return "flat";
    return chgPct > 0 ? "up" : "down";
}

export function LiveLtpIsland({ attrs }: { attrs: LiveLtpIslandAttrs }) {
    const { asOf, chgPct, isLive, ltp } = useIslandDisplayedValues(attrs);
    const tone = moveTone(chgPct);
    const chgText = formatChg(chgPct);
    const showLtp = attrs.kind !== "chgPct";
    const showChg = attrs.kind !== "ltp" && chgText != null;
    const ariaParts = [
        attrs.symbol,
        showLtp && ltp != null ? `${formatLtp(ltp)} rupees` : null,
        showChg
            ? tone === "up"
                ? `up ${Math.abs(chgPct!).toFixed(2)} percent`
                : tone === "down"
                  ? `down ${Math.abs(chgPct!).toFixed(2)} percent`
                  : `unchanged`
            : null,
        !isLive && asOf ? `as of ${asOf}` : isLive ? "live" : null
    ].filter(Boolean);

    return (
        <span
            aria-label={ariaParts.join(", ")}
            className={cn(
                "ananta-ltp-island inline-flex items-baseline gap-1 align-baseline whitespace-nowrap font-semibold tabular-nums",
                "rounded-sm px-0.5 py-px",
                tone === "up" && "text-emerald-600 dark:text-emerald-400",
                tone === "down" && "text-red-600 dark:text-red-400",
                tone === "flat" && "text-muted-foreground",
                !isLive && "opacity-90"
            )}
            data-exchange={attrs.exchange}
            data-live={isLive ? "1" : "0"}
            data-symbol={attrs.symbol}
            title={!isLive && asOf ? `As of ${asOf}` : isLive ? "Live" : undefined}
        >
            <span className="font-sans tracking-tight">{attrs.symbol}</span>
            {showLtp ? <span className="font-mono text-[0.95em]">{formatLtp(ltp)}</span> : null}
            {showChg ? <span className="font-mono text-[0.9em] opacity-90">({chgText})</span> : null}
        </span>
    );
}
