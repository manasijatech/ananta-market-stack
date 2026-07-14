"use client";

import { ChevronDown, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
    Tooltip,
    TooltipPopup,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import {
    companyDetail,
    formatFeedTimestamp,
    normalizeSentiment,
    parseTickerSymbols,
    tickerAvatarClass,
    truncateAtWord,
    type SentimentKind
} from "@/components/market-intelligence/market-intelligence-utils";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import { cn } from "@/lib/utils";

export function LiveStatusPill({ state }: { state: "connecting" | "live" | "offline" }) {
    if (state === "offline") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                Offline
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success-foreground">
            <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            {state === "connecting" ? "Connecting" : "Live"}
        </span>
    );
}

export function TickerAvatar({
    symbol,
    metadata,
    size = 28
}: {
    symbol: string;
    metadata?: AlphaSymbolMetadata;
    size?: 28 | 24;
}) {
    const [failed, setFailed] = useState(false);
    const initials = symbol.slice(0, 2).toUpperCase();
    const sizeClass = size === 28 ? "size-7 text-[10px]" : "size-6 text-[9px]";
    const logo = metadata?.logo && !failed ? metadata.logo : "";

    if (logo) {
        return (
            <img
                alt=""
                className={cn(sizeClass, "shrink-0 rounded-full object-cover")}
                loading="lazy"
                onError={() => setFailed(true)}
                referrerPolicy="no-referrer"
                src={logo}
            />
        );
    }

    return (
        <span
            className={cn(
                "flex shrink-0 items-center justify-center rounded-full font-mono font-semibold",
                sizeClass,
                tickerAvatarClass(symbol)
            )}
        >
            {initials}
        </span>
    );
}

export function TickerChip({
    symbol,
    onClick,
    highlight = false
}: {
    symbol: string;
    onClick?: (symbol: string) => void;
    highlight?: boolean;
}) {
    const className = cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium",
        highlight
            ? "bg-primary/15 text-primary"
            : "bg-secondary text-secondary-foreground"
    );

    if (onClick) {
        return (
            <button className={cn(className, "transition-colors hover:bg-primary/20")} onClick={() => onClick(symbol)} type="button">
                {symbol}
            </button>
        );
    }

    return <span className={className}>{symbol}</span>;
}

export function TickerChipRow({
    symbol,
    onTickerClick
}: {
    symbol?: string | null;
    onTickerClick?: (symbol: string) => void;
}) {
    const symbols = parseTickerSymbols(symbol);
    if (!symbols.length) return null;

    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {symbols.map((ticker) => (
                <TickerChip key={ticker} onClick={onTickerClick} symbol={ticker} />
            ))}
        </span>
    );
}

export function SentimentBadge({ sentiment }: { sentiment?: string | null }) {
    const kind = normalizeSentiment(sentiment);
    const config: Record<SentimentKind, { label: string; variant: "success" | "destructive" | "secondary" }> = {
        positive: { label: "↑ Positive", variant: "success" },
        negative: { label: "↓ Negative", variant: "destructive" },
        neutral: { label: "→ Neutral", variant: "secondary" }
    };
    const { label, variant } = config[kind];
    return (
        <Badge className="h-5 rounded-full px-2 text-[11px] font-medium" size="sm" variant={variant}>
            {label}
        </Badge>
    );
}

export function FeedFilterChip({
    active,
    count,
    label,
    onClick
}: {
    active: boolean;
    count?: number;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            aria-pressed={active}
            className={cn(
                "inline-flex h-9 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors sm:h-7 sm:px-2.5",
                active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/70 bg-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground"
            )}
            onClick={onClick}
            type="button"
        >
            {label}
            {typeof count === "number" ? (
                <span className="rounded-full bg-background/70 px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
                    {count}
                </span>
            ) : null}
        </button>
    );
}

export function FeedFilterBar({
    children,
    trailing
}: {
    children: ReactNode;
    trailing?: ReactNode;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-3 border-b border-border/50 pb-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between min-[640px]:gap-3">
            <div
                className="-mx-1 flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden"
                aria-label="Feed filters"
            >
                {children}
            </div>
            {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </div>
    );
}

export function ExpandableBody({
    text,
    minSentences = 2,
    className
}: {
    text: string;
    minSentences?: number;
    className?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const preview = useMemo(() => buildBodyPreview(text, minSentences), [minSentences, text]);
    const needsExpand = preview !== text.trim();

    if (!text.trim()) return null;

    return (
        <div className={cn("text-[13px] leading-5 text-muted-foreground", className)}>
            <p className="whitespace-pre-wrap break-words">{expanded || !needsExpand ? text : preview}</p>
            {needsExpand ? (
                <button
                    className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                    onClick={() => setExpanded((current) => !current)}
                    type="button"
                >
                    {expanded ? "Collapse" : "Expand"}
                    <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
                </button>
            ) : null}
        </div>
    );
}

function buildBodyPreview(text: string, minSentences: number): string {
    const clean = text.trim();
    if (!clean) return "";

    const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
    if (sentences.length >= minSentences) {
        const joined = sentences.slice(0, minSentences).join(" ").trim();
        if (joined.length < clean.length) {
            return joined.endsWith("…") ? joined : `${joined.replace(/[.!?]$/, "")}…`;
        }
        return joined;
    }

    return truncateAtWord(clean, 220);
}

export function FeedCard({
    avatar,
    metaLeading,
    metaTrailing,
    categoryBadge,
    timestamp,
    headline,
    body,
    actions,
    borderAccent,
    className,
    dimmed = false
}: {
    avatar: ReactNode;
    metaLeading?: ReactNode;
    metaTrailing?: ReactNode;
    categoryBadge?: ReactNode;
    timestamp?: string | null;
    headline: ReactNode;
    body?: ReactNode;
    actions?: ReactNode;
    borderAccent?: "danger" | "warning" | "muted" | "none";
    className?: string;
    dimmed?: boolean;
}) {
    const borderClass =
        borderAccent === "danger"
            ? "border-l-[3px] border-l-destructive bg-destructive/5"
            : borderAccent === "warning"
              ? "border-l-[3px] border-l-warning bg-warning/5"
              : borderAccent === "muted"
                ? "border-l-[3px] border-l-border"
                : "";

    return (
        <article
            className={cn(
                "group border-b border-border/50 py-3 pl-3 pr-1 transition-opacity",
                borderClass,
                dimmed && "opacity-70",
                className
            )}
        >
            <div className="flex gap-2.5">
                <div className="pt-0.5">{avatar}</div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {metaLeading}
                        {categoryBadge}
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                            {metaTrailing}
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                            {timestamp ? (
                                <time className="text-xs text-muted-foreground">
                                    {formatFeedTimestamp(timestamp)}
                                </time>
                            ) : null}
                        </div>
                    </div>
                    <h3 className="mt-1.5 text-[15px] font-medium leading-snug text-foreground">{headline}</h3>
                    {body ? <div className="mt-1.5">{body}</div> : null}
                    {actions ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            {actions}
                        </div>
                    ) : null}
                </div>
            </div>
        </article>
    );
}

export function CompanyMetaLine({ metadata }: { metadata?: AlphaSymbolMetadata }) {
    const detail = companyDetail(metadata);
    if (!detail) return null;
    return <span className="text-xs text-muted-foreground">{detail}</span>;
}

export function FeedSearchInput({
    onChange,
    placeholder = "Search symbol",
    value
}: {
    onChange: (value: string) => void;
    placeholder?: string;
    value: string;
}) {
    return (
        <label className="relative min-w-0 flex-1">
            <span className="sr-only">{placeholder}</span>
            <input
                autoComplete="off"
                className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]"
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                value={value}
            />
            {value ? (
                <button
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => onChange("")}
                    type="button"
                >
                    <X className="size-3.5" />
                </button>
            ) : null}
        </label>
    );
}

export function WatchlistScopeTooltip({
    children,
    historyLimit,
    symbolCount
}: {
    children: ReactNode;
    historyLimit: number;
    symbolCount: number;
}) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger render={<span className="inline-flex min-w-0" />}>{children}</TooltipTrigger>
                <TooltipPopup className="max-w-xs">
                    All watchlists cover {symbolCount} symbol{symbolCount === 1 ? "" : "s"}. Historical API loads use
                    the first {historyLimit} symbols in the active scope.
                </TooltipPopup>
            </Tooltip>
        </TooltipProvider>
    );
}

export function FeedCardAction({
    children,
    onClick
}: {
    children: ReactNode;
    onClick?: () => void;
}) {
    return (
        <button
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            onClick={onClick}
            type="button"
        >
            {children}
        </button>
    );
}
