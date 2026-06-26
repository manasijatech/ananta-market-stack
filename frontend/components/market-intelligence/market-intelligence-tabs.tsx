"use client";

import {
    Bell,
    Copy,
    ExternalLink,
    FileText,
    IndianRupee,
    Megaphone,
    MessageSquare,
    Newspaper,
    Pause,
    Play,
    RotateCcw,
    Star,
    X,
    type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    CompanyMetaLine,
    ExpandableBody,
    FeedCard,
    FeedCardAction,
    FeedFilterBar,
    FeedFilterChip,
    SentimentBadge,
    TickerAvatar,
    TickerChip,
    TickerChipRow
} from "@/components/market-intelligence/market-intelligence-feed-primitives";
import {
    announcementDisplayTitle,
    announcementTypeBadgeVariant,
    announcementTypeLabel,
    bulletsFromMarkdown,
    classifyAlertSeverity,
    classifyAnnouncementType,
    companyDetail,
    firstSentence,
    formatFeedTimestamp,
    itemKey,
    itemMatchesFeedSearch,
    matchesWatchlistOnly,
    normalizeSentiment,
    parseConcallSections,
    parseEarningsMetrics,
    parseFinancialMetricsTable,
    type AnnouncementTypeKind
} from "@/components/market-intelligence/market-intelligence-utils";
import type { AlphaSection } from "@/components/market-intelligence/market-intelligence-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveWaveform } from "@/components/ui/live-waveform";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import type { AlphaAnnouncementDetail, AlphaEarningsDetail } from "@/service/types/alpha/announcements";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import { parseApiDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const SAVED_NEWS_KEY = "mi-saved-news";
const READ_ALERTS_KEY = "mi-read-alerts";

const sectionVisuals = {
    news: { icon: Newspaper, title: "No News Found", description: "No news matched your filters." },
    announcements: { icon: Megaphone, title: "No Announcements Found", description: "No announcements matched your filters." },
    earnings: { icon: IndianRupee, title: "No Earnings Found", description: "No earnings matched your filters." },
    concalls: { icon: MessageSquare, title: "No Concalls Found", description: "No concalls matched your filters." },
    alerts: { icon: Bell, title: "No Alerts Found", description: "No alerts matched your filters." }
} satisfies Record<AlphaSection, { icon: LucideIcon; title: string; description: string }>;

function EmptyFeed({ section }: { section: AlphaSection }) {
    const visual = sectionVisuals[section];
    const Icon = visual.icon;
    return (
        <div className="flex min-h-48 flex-col items-center justify-center py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
                <Icon className="size-4" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-foreground">{visual.title}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{visual.description}</p>
        </div>
    );
}

function useSavedNews() {
    const [saved, setSaved] = useState<Set<string>>(new Set());

    useEffect(() => {
        try {
            const raw = localStorage.getItem(SAVED_NEWS_KEY);
            if (raw) setSaved(new Set(JSON.parse(raw) as string[]));
        } catch {
            setSaved(new Set());
        }
    }, []);

    const toggle = useCallback((id: string) => {
        setSaved((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            localStorage.setItem(SAVED_NEWS_KEY, JSON.stringify([...next]));
            return next;
        });
    }, []);

    return { saved, toggle };
}

function useReadAlerts() {
    const [readIds, setReadIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        try {
            const raw = localStorage.getItem(READ_ALERTS_KEY);
            if (raw) setReadIds(new Set(JSON.parse(raw) as string[]));
        } catch {
            setReadIds(new Set());
        }
    }, []);

    const markRead = useCallback((id: string) => {
        setReadIds((current) => {
            if (current.has(id)) return current;
            const next = new Set(current);
            next.add(id);
            localStorage.setItem(READ_ALERTS_KEY, JSON.stringify([...next]));
            return next;
        });
    }, []);

    const markAllRead = useCallback((ids: string[]) => {
        setReadIds((current) => {
            const next = new Set(current);
            for (const id of ids) next.add(id);
            localStorage.setItem(READ_ALERTS_KEY, JSON.stringify([...next]));
            return next;
        });
    }, []);

    return { readIds, markRead, markAllRead };
}

function isRecentAlert(timestamp?: string | null): boolean {
    if (!timestamp) return false;
    const date = parseApiDate(timestamp);
    if (Number.isNaN(date.getTime())) return false;
    return Date.now() - date.getTime() < 60 * 60 * 1000;
}

type SharedTabProps = {
    feedSearch: string;
    onTickerClick?: (symbol: string) => void;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
    watchlistSymbols: Set<string>;
};

type SentimentFilter = "positive" | "negative" | "neutral" | "all" | "watchlist";

export function NewsTab({
    feedSearch,
    items,
    onTickerClick,
    symbolMetadata,
    watchlistSymbols
}: SharedTabProps & { items: AlphaNewsItem[] }) {
    const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
    const { saved, toggle } = useSavedNews();

    const filtered = useMemo(() => {
        return items.filter((item) => {
            if (!itemMatchesFeedSearch(item, feedSearch)) return false;
            if (sentimentFilter === "watchlist" && !matchesWatchlistOnly(item, watchlistSymbols)) return false;
            if (sentimentFilter === "all" || sentimentFilter === "watchlist") return true;
            return normalizeSentiment(item.sentiment) === sentimentFilter;
        });
    }, [feedSearch, items, sentimentFilter, watchlistSymbols]);

    const counts = useMemo(() => {
        const base = items.filter((item) => itemMatchesFeedSearch(item, feedSearch));
        return {
            all: base.length,
            positive: base.filter((item) => normalizeSentiment(item.sentiment) === "positive").length,
            negative: base.filter((item) => normalizeSentiment(item.sentiment) === "negative").length,
            neutral: base.filter((item) => normalizeSentiment(item.sentiment) === "neutral").length
        };
    }, [feedSearch, items]);

    if (!items.length) return <EmptyFeed section="news" />;

    return (
        <div className="min-w-0">
            <FeedFilterBar>
                <FeedFilterChip active={sentimentFilter === "all"} count={counts.all} label="All" onClick={() => setSentimentFilter("all")} />
                <FeedFilterChip active={sentimentFilter === "positive"} count={counts.positive} label="Positive" onClick={() => setSentimentFilter("positive")} />
                <FeedFilterChip active={sentimentFilter === "negative"} count={counts.negative} label="Negative" onClick={() => setSentimentFilter("negative")} />
                <FeedFilterChip active={sentimentFilter === "neutral"} count={counts.neutral} label="Neutral" onClick={() => setSentimentFilter("neutral")} />
                <FeedFilterChip active={sentimentFilter === "watchlist"} label="Your symbols only" onClick={() => setSentimentFilter("watchlist")} />
            </FeedFilterBar>

            {filtered.length ? null : <EmptyFeed section="news" />}

            {filtered.map((item) => {
                const symbol = item.symbol ?? "";
                const metadata = symbolMetadata[symbol.trim().toUpperCase()];
                const id = itemKey(item);
                const headline = item.specific_title ?? item.title ?? "Untitled news";
                const body = item.long_summary ?? item.summary ?? "";
                const isSaved = saved.has(id);

                return (
                    <FeedCard
                        key={id}
                        avatar={<TickerAvatar metadata={metadata} symbol={symbol || "NA"} />}
                        body={<ExpandableBody minSentences={2} text={body || "No summary provided."} />}
                        categoryBadge={<SentimentBadge sentiment={item.sentiment} />}
                        headline={headline}
                        metaLeading={<TickerChipRow onTickerClick={onTickerClick} symbol={symbol} />}
                        metaTrailing={
                            <>
                                <CompanyMetaLine metadata={metadata} />
                                {item.source ? (
                                    <span className="ml-2 text-xs text-muted-foreground">{item.source}</span>
                                ) : null}
                            </>
                        }
                        timestamp={item.date}
                        actions={
                            <>
                                {item.link ? (
                                    <FeedCardAction onClick={() => window.open(item.link!, "_blank", "noreferrer")}>
                                        <ExternalLink className="size-3" />
                                        Source
                                    </FeedCardAction>
                                ) : null}
                                <FeedCardAction onClick={() => toggle(id)}>
                                    <Star className={cn("size-3", isSaved && "fill-primary text-primary")} />
                                    {isSaved ? "Saved" : "Save"}
                                </FeedCardAction>
                                <FeedCardAction
                                    onClick={() => {
                                        void navigator.clipboard.writeText(`${headline}\n\n${body}`);
                                    }}
                                >
                                    <Copy className="size-3" />
                                    Copy
                                </FeedCardAction>
                            </>
                        }
                    />
                );
            })}
        </div>
    );
}

const ANNOUNCEMENT_FILTERS: AnnouncementTypeKind[] = [
    "credit-rating",
    "board-meeting",
    "issue-of-securities",
    "incident",
    "agm"
];

function announcementDedupKey(item: AlphaAnnouncementDetail, metadata?: AlphaSymbolMetadata): string {
    const company = metadata?.company_name ?? item.symbol;
    const type = classifyAnnouncementType(item.category);
    const date = item.date ? parseApiDate(item.date).getTime() : 0;
    const bucket = Math.floor(date / (2 * 60 * 1000));
    return `${company}:${type}:${bucket}`;
}

export function AnnouncementsTab({
    feedSearch,
    items,
    onTickerClick,
    symbolMetadata
}: SharedTabProps & { items: AlphaAnnouncementDetail[] }) {
    const [typeFilter, setTypeFilter] = useState<AnnouncementTypeKind | "all">("all");

    const grouped = useMemo(() => {
        const map = new Map<string, AlphaAnnouncementDetail[]>();
        for (const item of items) {
            const metadata = symbolMetadata[item.symbol?.trim().toUpperCase() ?? ""];
            const key = announcementDedupKey(item, metadata);
            const group = map.get(key) ?? [];
            group.push(item);
            map.set(key, group);
        }
        return [...map.values()];
    }, [items, symbolMetadata]);

    const filteredGroups = useMemo(() => {
        return grouped.filter((group) => {
            const primary = group[0];
            if (!itemMatchesFeedSearch(primary, feedSearch)) return false;
            if (typeFilter === "all") return true;
            return classifyAnnouncementType(primary.category) === typeFilter;
        });
    }, [feedSearch, grouped, typeFilter]);

    const typeCounts = useMemo(() => {
        const base = grouped.filter((group) => itemMatchesFeedSearch(group[0], feedSearch));
        const counts: Record<string, number> = { all: base.length };
        for (const kind of ANNOUNCEMENT_FILTERS) {
            counts[kind] = base.filter((group) => classifyAnnouncementType(group[0].category) === kind).length;
        }
        return counts;
    }, [feedSearch, grouped]);

    if (!items.length) return <EmptyFeed section="announcements" />;

    return (
        <div className="min-w-0">
            <FeedFilterBar>
                <FeedFilterChip active={typeFilter === "all"} count={typeCounts.all} label="All" onClick={() => setTypeFilter("all")} />
                {ANNOUNCEMENT_FILTERS.map((kind) => (
                    <FeedFilterChip
                        active={typeFilter === kind}
                        count={typeCounts[kind]}
                        key={kind}
                        label={announcementTypeLabel(kind)}
                        onClick={() => setTypeFilter(kind)}
                    />
                ))}
            </FeedFilterBar>

            {filteredGroups.length ? null : <EmptyFeed section="announcements" />}

            {filteredGroups.map((group) => (
                <AnnouncementCard
                    group={group}
                    key={itemKey(group[0])}
                    onTickerClick={onTickerClick}
                    symbolMetadata={symbolMetadata}
                />
            ))}
        </div>
    );
}

function AnnouncementCard({
    group,
    onTickerClick,
    symbolMetadata
}: {
    group: AlphaAnnouncementDetail[];
    onTickerClick?: (symbol: string) => void;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
}) {
    const [expanded, setExpanded] = useState(false);
    const primary = group[0];
    const symbol = primary.symbol ?? "";
    const metadata = symbolMetadata[symbol.trim().toUpperCase()];
    const typeKind = classifyAnnouncementType(primary.category);
    const typeLabel = announcementTypeLabel(typeKind);
    const rawTitle = primary.headline ?? primary.title ?? "Untitled announcement";
    const { headline, original } = announcementDisplayTitle(rawTitle, typeLabel, metadata?.company_name);
    const body = primary.summary ?? "No summary provided.";

    return (
        <FeedCard
            avatar={<TickerAvatar metadata={metadata} symbol={symbol || "NA"} />}
            body={
                <>
                    {original ? <p className="mb-1 text-[11px] text-muted-foreground">{original}</p> : null}
                    <ExpandableBody text={body} />
                    {group.length > 1 && !expanded ? (
                        <button
                            className="mt-1 text-xs font-medium text-primary hover:underline"
                            onClick={() => setExpanded(true)}
                            type="button"
                        >
                            Show both ({group.length} filings)
                        </button>
                    ) : null}
                    {expanded && group.length > 1
                        ? group.slice(1).map((variant) => (
                              <div className="mt-3 border-t border-border/50 pt-3" key={itemKey(variant)}>
                                  <p className="text-xs font-medium text-foreground">
                                      {variant.headline ?? variant.title ?? "Filing variant"}
                                  </p>
                                  <p className="mt-1 text-[13px] text-muted-foreground">{variant.summary}</p>
                              </div>
                          ))
                        : null}
                </>
            }
            categoryBadge={
                <Badge size="sm" variant={announcementTypeBadgeVariant(typeKind)}>
                    {typeLabel}
                    {group.length > 1 ? ` · ${group.length} filings` : ""}
                </Badge>
            }
            headline={headline}
            metaLeading={<TickerChipRow onTickerClick={onTickerClick} symbol={symbol} />}
            metaTrailing={<CompanyMetaLine metadata={metadata} />}
            timestamp={primary.date}
        />
    );
}

export function EarningsTab({
    feedSearch,
    items,
    onTickerClick,
    symbolMetadata
}: SharedTabProps & { items: AlphaEarningsDetail[] }) {
    const filtered = useMemo(
        () => items.filter((item) => itemMatchesFeedSearch(item, feedSearch)),
        [feedSearch, items]
    );

    if (!items.length) return <EmptyFeed section="earnings" />;

    return (
        <div className="min-w-0">
            {filtered.length ? null : <EmptyFeed section="earnings" />}
            {filtered.map((item) => {
                const symbol = item.symbol ?? "";
                const metadata = symbolMetadata[symbol.trim().toUpperCase()];
                const summary = item.summary ?? "";
                const quarter = item.quarter?.trim() || "Quarter";
                const titleFromData = (item as { headline?: string; title?: string }).headline
                    ?? (item as { headline?: string; title?: string }).title;
                const titleSameAsBody = titleFromData && summary && titleFromData.trim() === summary.trim();
                const headline =
                    titleFromData && !titleSameAsBody
                        ? titleFromData
                        : `${metadata?.company_name ?? symbol} ${quarter} Earnings`;
                const chips = parseEarningsMetrics(summary);
                const significance = item.earnings_significant
                    ? { label: "Significant", variant: "warning" as const }
                    : summary.toLowerCase().includes("moderate")
                      ? { label: "Moderate", variant: "secondary" as const }
                      : { label: "Routine", variant: "secondary" as const };

                return (
                    <FeedCard
                        key={itemKey(item)}
                        avatar={<TickerAvatar metadata={metadata} symbol={symbol || "NA"} />}
                        body={
                            <>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge size="sm" variant={significance.variant}>
                                        {significance.label}
                                    </Badge>
                                    {quarter ? (
                                        <Badge className="font-mono" size="sm" variant="outline">
                                            {quarter}
                                        </Badge>
                                    ) : null}
                                </div>
                                {chips.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {chips.map((chip) => (
                                            <span
                                                className={cn(
                                                    "inline-flex rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium",
                                                    chip.direction === "up"
                                                        ? "bg-success/10 text-success-foreground"
                                                        : "bg-destructive/10 text-destructive-foreground"
                                                )}
                                                key={`${chip.label}-${chip.value}`}
                                            >
                                                {chip.label} {chip.direction === "up" ? "▲" : "▼"}
                                                {chip.value}
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                                {summary ? <ExpandableBody className="mt-2" text={summary} /> : null}
                            </>
                        }
                        headline={headline}
                        metaLeading={<TickerChipRow onTickerClick={onTickerClick} symbol={symbol} />}
                        metaTrailing={<CompanyMetaLine metadata={metadata} />}
                        timestamp={item.date}
                    />
                );
            })}
        </div>
    );
}

function proxiedConcallAudioSrc(src: string): string {
    return `/api/market-intelligence/concall-audio?src=${encodeURIComponent(src)}`;
}

export function ConcallsTab({
    feedSearch,
    items,
    onTickerClick,
    symbolMetadata
}: SharedTabProps & { items: AlphaConcall[] }) {
    const [activeAudio, setActiveAudio] = useState<{ src: string; symbol: string; quarter: string } | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);

    const filtered = useMemo(
        () => items.filter((item) => itemMatchesFeedSearch(item, feedSearch)),
        [feedSearch, items]
    );

    if (!items.length) return <EmptyFeed section="concalls" />;

    return (
        <div className="relative min-w-0 pb-24">
            {filtered.length ? null : <EmptyFeed section="concalls" />}

            {filtered.map((item) => (
                <ConcallCard
                    key={itemKey(item)}
                    item={item}
                    onPlayAudio={(src) =>
                        setActiveAudio({ src, symbol: item.symbol, quarter: item.quarter ?? "" })
                    }
                    onTickerClick={onTickerClick}
                    symbolMetadata={symbolMetadata}
                />
            ))}

            {activeAudio ? (
                <div className="sticky bottom-0 z-20 mt-4 border border-border bg-[var(--bg-elevated)] p-3 shadow-lg">
                    <div className="flex items-center gap-3">
                        <TickerAvatar
                            metadata={symbolMetadata[activeAudio.symbol.trim().toUpperCase()]}
                            symbol={activeAudio.symbol}
                        />
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-sm font-medium text-foreground">
                                {activeAudio.symbol}
                                {activeAudio.quarter ? ` — ${activeAudio.quarter}` : ""}
                            </p>
                            <ConcallAudioControls
                                audioRef={audioRef}
                                onPlayingChange={setPlaying}
                                src={activeAudio.src}
                            />
                        </div>
                        <div className="hidden w-24 min-[540px]:block">
                            <LiveWaveform
                                active={playing}
                                barGap={1}
                                barRadius={4}
                                barWidth={2}
                                className="h-8 w-full text-primary"
                                height={32}
                                mediaElementRef={audioRef}
                                mode="static"
                            />
                        </div>
                        <Button
                            aria-label="Close audio player"
                            className="size-8 shrink-0"
                            onClick={() => setActiveAudio(null)}
                            size="icon"
                            type="button"
                            variant="ghost"
                        >
                            <X className="size-4" />
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ConcallCard({
    item,
    onPlayAudio,
    onTickerClick,
    symbolMetadata
}: {
    item: AlphaConcall;
    onPlayAudio: (src: string) => void;
    onTickerClick?: (symbol: string) => void;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
}) {
    const [expanded, setExpanded] = useState(false);
    const symbol = item.symbol ?? "";
    const metadata = symbolMetadata[symbol.trim().toUpperCase()];
    const sections = parseConcallSections(item.short_analysis ?? item.expanded_analysis);
    const guidance = sections.find((section) => section.key.toLowerCase().includes("guidance"));
    const summarization = sections.find((section) => section.key.toLowerCase().includes("summarization"));
    const redFlags = sections.find((section) => section.key.toLowerCase().includes("redflag"));
    const redFlagCount = redFlags ? bulletsFromMarkdown(redFlags.markdown, 99).length : 0;
    const financialMetrics = sections.find((section) =>
        section.key.toLowerCase().replace(/[_\s-]+/g, "").includes("financialmetrics")
    );
    const metricRows = financialMetrics ? parseFinancialMetricsTable(financialMetrics.markdown) : [];

    return (
        <article className="border-b border-border/50 py-3">
            <div className="flex flex-col gap-3 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between">
                <div className="flex min-w-0 gap-2.5">
                    <TickerAvatar metadata={metadata} symbol={symbol || "NA"} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <TickerChipRow onTickerClick={onTickerClick} symbol={symbol} />
                            <CompanyMetaLine metadata={metadata} />
                            {item.quarter ? (
                                <Badge className="font-mono" size="sm" variant="outline">
                                    {item.quarter}
                                </Badge>
                            ) : null}
                            {redFlagCount > 0 ? (
                                <Badge size="sm" variant="warning">
                                    ⚠ {redFlagCount} red flags
                                </Badge>
                            ) : null}
                            <time className="ml-auto text-xs text-muted-foreground">{formatFeedTimestamp(item.date)}</time>
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                    {item.transcript_url ? (
                        <a
                            className="inline-flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
                            href={item.transcript_url}
                            rel="noreferrer"
                            target="_blank"
                        >
                            <FileText className="size-3.5" />
                            PDF
                        </a>
                    ) : null}
                    {item.audio_url ? (
                        <Button
                            className="h-8 px-2.5 text-xs"
                            onClick={() => onPlayAudio(item.audio_url!)}
                            size="sm"
                            type="button"
                            variant="outline"
                        >
                            <Play className="size-3.5" />
                            Audio
                        </Button>
                    ) : null}
                </div>
            </div>

            {!expanded ? (
                <div className="mt-3 space-y-3 pl-9">
                    {guidance ? (
                        <ConcallBulletPreview label="Guidance" limit={3} markdown={guidance.markdown} />
                    ) : null}
                    {summarization ? (
                        <ConcallBulletPreview label="Summarization" limit={2} markdown={summarization.markdown} />
                    ) : null}
                    <button
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={() => setExpanded(true)}
                        type="button"
                    >
                        Show full analysis ↓
                    </button>
                </div>
            ) : (
                <div className="mt-3 space-y-4 pl-9">
                    {sections.map((section) => {
                        const isRedFlags = section.key.toLowerCase().replace(/[_\s-]+/g, "").includes("redflags");
                        const isFinancial = section.key
                            .toLowerCase()
                            .replace(/[_\s-]+/g, "")
                            .includes("financialmetrics");
                        return (
                            <section
                                className={cn(
                                    isRedFlags && "border-l-[3px] border-l-destructive bg-destructive/5 pl-3"
                                )}
                                key={section.key}
                            >
                                <h4 className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    {section.label}
                                </h4>
                                {isFinancial && metricRows.length ? (
                                    <table className="mt-2 w-full text-xs">
                                        <thead>
                                            <tr className="text-muted-foreground">
                                                <th className="py-1 text-left font-medium">Metric</th>
                                                <th className="py-1 text-right font-medium">Q4 FY26</th>
                                                <th className="py-1 text-right font-medium">FY26</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {metricRows.map((row) => (
                                                <tr className="border-t border-border/40" key={row.metric}>
                                                    <td className="py-1 pr-2 text-left">{row.metric}</td>
                                                    <td className="py-1 text-right font-mono">{row.q4}</td>
                                                    <td className="py-1 text-right font-mono">{row.fy}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <ConcallMarkdown>{section.markdown}</ConcallMarkdown>
                                )}
                            </section>
                        );
                    })}
                    <button
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={() => setExpanded(false)}
                        type="button"
                    >
                        Collapse ↑
                    </button>
                </div>
            )}
        </article>
    );
}

function ConcallBulletPreview({ label, limit, markdown }: { label: string; limit: number; markdown: string }) {
    const bullets = bulletsFromMarkdown(markdown, limit);
    if (!bullets.length) return null;
    return (
        <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-muted-foreground">
                {bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                ))}
            </ul>
        </div>
    );
}

function ConcallMarkdown({ children }: { children: string }) {
    return (
        <div className="mt-1 max-w-full text-[13px] leading-5 text-muted-foreground">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children: c }) => <p className="mb-2 last:mb-0">{c}</p>,
                    ul: ({ children: c }) => <ul className="mb-2 ml-4 list-disc space-y-0.5">{c}</ul>,
                    li: ({ children: c }) => <li>{c}</li>,
                    strong: ({ children: c }) => <strong className="font-medium text-foreground">{c}</strong>
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
}

function ConcallAudioControls({
    audioRef,
    onPlayingChange,
    src
}: {
    audioRef: RefObject<HTMLAudioElement | null>;
    onPlayingChange: (playing: boolean) => void;
    src: string;
}) {
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const playbackSrc = proxiedConcallAudioSrc(src);
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    useEffect(() => {
        setDuration(0);
        setCurrentTime(0);
        onPlayingChange(false);
        audioRef.current?.play().catch(() => onPlayingChange(false));
    }, [audioRef, onPlayingChange, playbackSrc]);

    function toggle() {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) audio.play().catch(() => onPlayingChange(false));
        else audio.pause();
    }

    return (
        <div className="mt-1 flex items-center gap-2">
            <Button className="size-7" onClick={toggle} size="icon" type="button" variant="outline">
                {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button
                className="size-7"
                onClick={() => {
                    if (audioRef.current) audioRef.current.currentTime = 0;
                }}
                size="icon"
                type="button"
                variant="ghost"
            >
                <RotateCcw className="size-3.5" />
            </Button>
            <div className="relative min-w-0 flex-1">
                <div className="h-1 rounded-full bg-border">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                </div>
                <input
                    aria-label="Seek audio"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    disabled={duration <= 0}
                    max={100}
                    min={0}
                    onChange={(event) => {
                        if (!audioRef.current || duration <= 0) return;
                        const next = (Number(event.target.value) / 100) * duration;
                        audioRef.current.currentTime = next;
                        setCurrentTime(next);
                    }}
                    type="range"
                    value={progress}
                />
            </div>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
            </span>
            <audio
                onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
                onEnded={() => {
                    setIsPlaying(false);
                    onPlayingChange(false);
                }}
                onPause={() => {
                    setIsPlaying(false);
                    onPlayingChange(false);
                }}
                onPlay={() => {
                    setIsPlaying(true);
                    onPlayingChange(true);
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                preload="metadata"
                ref={audioRef}
                src={playbackSrc}
            />
        </div>
    );
}

function formatAudioTime(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0:00";
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function classifyAlertFilterLabel(items: AlphaAlert[]): { catalyst: number; unexplained: number } {
    let catalyst = 0;
    let unexplained = 0;
    for (const item of items) {
        const severity = classifyAlertSeverity(item.reason ?? "");
        if (severity === "informational") unexplained += 1;
        else catalyst += 1;
    }
    return { catalyst, unexplained };
}

export function AlertsTab({
    feedSearch,
    items,
    onTickerClick,
    symbolMetadata
}: SharedTabProps & { items: AlphaAlert[] }) {
    const [filter, setFilter] = useState<"all" | "catalyst" | "unexplained">("all");
    const { markAllRead, readIds } = useReadAlerts();

    const grouped = useMemo(() => {
        const map = new Map<string, AlphaAlert[]>();
        for (const item of items) {
            const symbol = item.symbol?.trim().toUpperCase() || "UNKNOWN";
            const group = map.get(symbol) ?? [];
            group.push(item);
            map.set(symbol, group);
        }
        for (const [symbol, group] of map) {
            group.sort((a, b) => {
                const aTime = a.timestamp ? parseApiDate(a.timestamp).getTime() : 0;
                const bTime = b.timestamp ? parseApiDate(b.timestamp).getTime() : 0;
                return bTime - aTime;
            });
            map.set(symbol, group);
        }
        return [...map.entries()];
    }, [items]);

    const filterCounts = useMemo(() => {
        const base = classifyAlertFilterLabel(items);
        return { all: items.length, catalyst: base.catalyst, unexplained: base.unexplained };
    }, [items]);

    const filteredGroups = useMemo(() => {
        return grouped.filter(([, group]) => {
            const primary = group[0];
            if (!itemMatchesFeedSearch(primary, feedSearch)) return false;
            if (filter === "all") return true;
            const severity = classifyAlertSeverity(primary.reason ?? "");
            return filter === "catalyst" ? severity !== "informational" : severity === "informational";
        });
    }, [feedSearch, filter, grouped]);

    if (!items.length) return <EmptyFeed section="alerts" />;

    return (
        <div className="min-w-0">
            <FeedFilterBar
                trailing={
                    <button
                        className="text-xs font-medium text-muted-foreground hover:text-primary"
                        onClick={() => markAllRead(items.map((item) => itemKey(item)))}
                        type="button"
                    >
                        Mark all read
                    </button>
                }
            >
                <FeedFilterChip active={filter === "all"} count={filterCounts.all} label="All" onClick={() => setFilter("all")} />
                <FeedFilterChip
                    active={filter === "catalyst"}
                    count={filterCounts.catalyst}
                    label="Catalyst-driven"
                    onClick={() => setFilter("catalyst")}
                />
                <FeedFilterChip
                    active={filter === "unexplained"}
                    count={filterCounts.unexplained}
                    label="Unexplained"
                    onClick={() => setFilter("unexplained")}
                />
            </FeedFilterBar>

            {filteredGroups.length ? null : <EmptyFeed section="alerts" />}

            {filteredGroups.map(([symbol, group]) => (
                <AlertGroupCard
                    group={group}
                    key={symbol}
                    onTickerClick={onTickerClick}
                    readIds={readIds}
                    symbol={symbol}
                    symbolMetadata={symbolMetadata}
                />
            ))}
        </div>
    );
}

function AlertGroupCard({
    group,
    onTickerClick,
    readIds,
    symbol,
    symbolMetadata
}: {
    group: AlphaAlert[];
    onTickerClick?: (symbol: string) => void;
    readIds: Set<string>;
    symbol: string;
    symbolMetadata: Record<string, AlphaSymbolMetadata>;
}) {
    const [expanded, setExpanded] = useState(false);
    const primary = group[0];
    const metadata = symbolMetadata[symbol];
    const severity = classifyAlertSeverity(primary.reason ?? "");
    const borderAccent =
        severity === "extraordinary" ? "danger" : severity === "significant" ? "warning" : "muted";
    const isUnread = !readIds.has(itemKey(primary)) && isRecentAlert(primary.timestamp);
    const summary = firstSentence(primary.reason ?? "");

    return (
        <FeedCard
            avatar={<TickerAvatar metadata={metadata} symbol={symbol} />}
            body={
                <>
                    {expanded && group.length > 1 ? (
                        <div className="space-y-3">
                            {group.map((alert) => (
                                <div className="border-t border-border/40 pt-2 first:border-t-0 first:pt-0" key={itemKey(alert)}>
                                    <p className="text-xs text-muted-foreground">{formatFeedTimestamp(alert.timestamp)}</p>
                                    <p className="mt-1 text-[13px] text-muted-foreground">{alert.reason}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <ExpandableBody text={summary || primary.reason || ""} />
                    )}
                    {group.length > 1 ? (
                        <button
                            className="mt-1 text-xs font-medium text-primary hover:underline"
                            onClick={() => setExpanded((current) => !current)}
                            type="button"
                        >
                            {expanded ? "Collapse" : `Show ${group.length} alerts`}
                        </button>
                    ) : null}
                </>
            }
            borderAccent={borderAccent}
            categoryBadge={
                group.length > 1 ? (
                    <Badge size="sm" variant="outline">
                        {group.length} alerts
                    </Badge>
                ) : null
            }
            dimmed={!isUnread && readIds.has(itemKey(primary))}
            headline={summary || primary.reason || "Market alert"}
            metaLeading={
                <TickerChip highlight={isUnread} onClick={onTickerClick} symbol={symbol} />
            }
            metaTrailing={<CompanyMetaLine metadata={metadata} />}
            timestamp={primary.timestamp}
        />
    );
}
