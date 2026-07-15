"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from "@/components/ui/input-group";
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
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
                Offline
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
            <span className="relative flex size-1.5" aria-hidden="true">
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
    if (onClick) {
        return (
            <Badge
                render={<button type="button" />}
                onClick={() => onClick(symbol)}
                size="sm"
                variant={highlight ? "default" : "secondary"}
                className="font-mono"
            >
                {symbol}
            </Badge>
        );
    }

    return (
        <Badge className="font-mono" size="sm" variant={highlight ? "default" : "secondary"}>
            {symbol}
        </Badge>
    );
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
        <Badge size="sm" variant={variant}>
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
        <Badge
            render={<button type="button" />}
            aria-pressed={active}
            className="h-8 shrink-0 gap-1.5 px-3 sm:h-7 sm:px-2.5"
            onClick={onClick}
            size="sm"
            variant={active ? "default" : "outline"}
        >
            {label}
            {typeof count === "number" ? (
                <span
                    className={cn(
                        "rounded-sm px-1 font-mono text-[10px] leading-4",
                        active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                >
                    {count}
                </span>
            ) : null}
        </Badge>
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
        <div className="mb-3 flex min-w-0 flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
            <div
                className="-mx-1 flex min-w-0 snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden"
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
                <Button
                    className="mt-1 h-auto px-0 text-xs"
                    onClick={() => setExpanded((current) => !current)}
                    size="sm"
                    type="button"
                    variant="link"
                >
                    {expanded ? "Collapse" : "Expand"}
                    <ChevronDown
                        aria-hidden="true"
                        className={cn("size-3 transition-transform", expanded && "rotate-180")}
                    />
                </Button>
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
        <Card className={cn("group", borderClass, dimmed && "opacity-70", className)}>
            <CardPanel className="flex gap-3 p-3">
                <div className="shrink-0 pt-0.5">{avatar}</div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                            {metaLeading}
                            {categoryBadge}
                            {metaTrailing}
                        </div>
                        {timestamp ? (
                            <time className="shrink-0 text-xs text-muted-foreground">
                                {formatFeedTimestamp(timestamp)}
                            </time>
                        ) : null}
                    </div>
                    <h3 className="mt-1.5 text-[15px] font-medium leading-snug text-foreground">{headline}</h3>
                    {body ? <div className="mt-1.5">{body}</div> : null}
                    {actions ? (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            {actions}
                        </div>
                    ) : null}
                </div>
            </CardPanel>
        </Card>
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
        <InputGroup className="h-9 w-full min-w-0">
            <InputGroupAddon>
                <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
                aria-label={placeholder}
                autoComplete="off"
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                value={value}
            />
            {value ? (
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        aria-label="Clear search"
                        onClick={() => onChange("")}
                        size="icon-xs"
                        type="button"
                    >
                        <X aria-hidden="true" />
                    </InputGroupButton>
                </InputGroupAddon>
            ) : null}
        </InputGroup>
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
        <Button onClick={onClick} size="sm" type="button" variant="outline">
            {children}
        </Button>
    );
}
