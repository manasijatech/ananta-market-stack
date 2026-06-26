import { parseApiDate } from "@/lib/datetime";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";

const AVATAR_PALETTES = [
    "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100",
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-100",
    "bg-violet-100 text-violet-800 dark:bg-violet-800 dark:text-violet-100",
    "bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-100",
    "bg-rose-100 text-rose-800 dark:bg-rose-800 dark:text-rose-100",
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-800 dark:text-cyan-100"
] as const;

const INSIGHT_LABEL_OVERRIDES: Record<string, string> = {
    markettrends: "Market trends",
    competitivelandscape: "Competitive landscape",
    qaanalysis: "Q&A analysis",
    financialmetrics: "Financial metrics",
    redflags: "Red flags",
    guidance: "Guidance",
    summarization: "Summarization"
};

const PLACEHOLDER_TITLE_PATTERNS = [
    /as per annexure enclosed/i,
    /please refer enclosed file/i,
    /find enclosed/i
];

export type SentimentKind = "positive" | "negative" | "neutral";

export type EarningsMetricChip = {
    label: string;
    value: string;
    direction: "up" | "down";
};

export type AlertSeverity = "extraordinary" | "significant" | "informational";

export function tickerAvatarClass(seed: string): string {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash + seed.charCodeAt(index) * (index + 1)) % AVATAR_PALETTES.length;
    }
    return AVATAR_PALETTES[hash];
}

export function parseTickerSymbols(raw?: string | null): string[] {
    if (!raw?.trim()) return [];
    return Array.from(
        new Set(
            raw
                .split(/[:,\s]+/)
                .map((part) => part.trim().toUpperCase())
                .filter(Boolean)
        )
    );
}

export function companyDetail(metadata?: AlphaSymbolMetadata): string {
    return [metadata?.company_name, metadata?.sector].filter(Boolean).join(" · ");
}

export function formatFeedTimestamp(value?: string | null): string {
    if (!value?.trim()) return "";
    const date = parseApiDate(value);
    if (Number.isNaN(date.getTime())) return value;

    const now = new Date();
    const sameDay =
        date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) ===
        now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

    if (sameDay) {
        const diffMs = now.getTime() - date.getTime();
        const minutes = Math.floor(diffMs / 60_000);
        if (minutes < 1) return "Just now";
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
    }

    return new Intl.DateTimeFormat("en-IN", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Kolkata"
    })
        .format(date)
        .replace(",", " ·");
}

export function labelFromInsightKey(key: string): string {
    const normalized = key.toLowerCase().replace(/[_\s-]+/g, "");
    if (INSIGHT_LABEL_OVERRIDES[normalized]) return INSIGHT_LABEL_OVERRIDES[normalized];
    return key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function truncateAtWord(text: string, maxChars: number): string {
    const clean = text.trim();
    if (clean.length <= maxChars) return clean;
    const slice = clean.slice(0, maxChars);
    const lastSpace = slice.lastIndexOf(" ");
    const truncated = (lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trimEnd();
    return `${truncated}…`;
}

export function firstSentence(text: string): string {
    const clean = text.trim();
    if (!clean) return "";
    const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
    return match?.[1]?.trim() ?? truncateAtWord(clean, 180);
}

export function normalizeSentiment(value?: string | null): SentimentKind {
    const clean = value?.trim().toLowerCase();
    if (clean === "positive" || clean === "bullish") return "positive";
    if (clean === "negative" || clean === "bearish") return "negative";
    return "neutral";
}

export function isPlaceholderAnnouncementTitle(title: string): boolean {
    return PLACEHOLDER_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

export function announcementDisplayTitle(
    title: string,
    typeLabel: string,
    companyName?: string | null
): { headline: string; original?: string } {
    if (!isPlaceholderAnnouncementTitle(title)) {
        return { headline: title };
    }
    const company = companyName?.trim() || "Company";
    return {
        headline: `${typeLabel} — ${company}`,
        original: title
    };
}

export function parseEarningsMetrics(summary: string): EarningsMetricChip[] {
    const chips: EarningsMetricChip[] = [];
    const patterns = [
        /(revenue|sales|pat|ebitda|margin)[^.]*?([↑▲+]?\s*-?\d+(?:\.\d+)?%)\s*(yoy|qoq)/gi,
        /(revenue|sales|pat|ebitda|margin)[^.]*?(declin\w+|down|fell)[^.]*?(\d+(?:\.\d+)?%)\s*(yoy|qoq)/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(summary)) !== null) {
            const label = match[1].toUpperCase();
            const value = match[2]?.includes("%") ? match[2] : `${match[4]}%`;
            const period = (match[3] || match[5] || "").toUpperCase();
            const direction =
                /declin|down|fell|▼|↓|-/i.test(match[0]) || /^-/.test(value) ? "down" : "up";
            chips.push({
                label: `${label} ${period}`,
                value: value.replace(/\s+/g, ""),
                direction
            });
        }
    }

    const deduped = new Map<string, EarningsMetricChip>();
    for (const chip of chips) {
        deduped.set(`${chip.label}-${chip.value}`, chip);
    }
    return Array.from(deduped.values()).slice(0, 6);
}

export function classifyAlertSeverity(text: string): AlertSeverity {
    const clean = text.toLowerCase();
    if (/extraordinary|>\s*500%|surge.*5\d{2}%|5\d{2}%.*surge/.test(clean)) return "extraordinary";
    if (/catalyst|analyst|upgrade|downgrade|corporate|results|earnings|guidance|incident|acquisition/.test(clean)) {
        return "significant";
    }
    return "informational";
}

export function itemMatchesFeedSearch(item: unknown, query: string): boolean {
    const clean = query.trim().toUpperCase();
    if (!clean) return true;
    const haystack = JSON.stringify(item).toUpperCase();
    return haystack.includes(clean);
}

export function itemWatchlistSymbols(item: unknown): Set<string> {
    const symbols = new Set<string>();
    function walk(value: unknown) {
        if (Array.isArray(value)) {
            for (const entry of value) walk(entry);
            return;
        }
        if (typeof value !== "object" || value === null) return;
        const record = value as Record<string, unknown>;
        for (const key of ["symbol", "symbols", "nse"]) {
            const raw = record[key];
            if (typeof raw === "string") {
                for (const part of parseTickerSymbols(raw)) symbols.add(part);
            }
        }
        for (const key of ["payload", "data"]) {
            if (record[key] !== undefined) walk(record[key]);
        }
    }
    walk(item);
    return symbols;
}

export function matchesWatchlistOnly(item: unknown, watchlistSymbols: Set<string>): boolean {
    if (!watchlistSymbols.size) return true;
    const itemSymbols = itemWatchlistSymbols(item);
    for (const symbol of itemSymbols) {
        if (watchlistSymbols.has(symbol)) return true;
    }
    return false;
}

export type FinancialMetricRow = {
    metric: string;
    q4: string;
    fy: string;
};

export type ConcallSection = {
    key: string;
    label: string;
    markdown: string;
};

const CONCALL_SECTION_ORDER = [
    "guidance",
    "markettrends",
    "competitivelandscape",
    "summarization",
    "redflags",
    "qaanalysis",
    "financialmetrics"
] as const;

function parseJsonInsight(value: string): unknown | null {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        return null;
    }
}

function insightValueToMarkdown(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        const parsed = parseJsonInsight(value);
        if (parsed) return insightValueToMarkdown(parsed);
        return value.replace(/\\n/g, "\n").trim();
    }
    if (Array.isArray(value)) return value.map(insightValueToMarkdown).filter(Boolean).join("\n\n");
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const preferred = record.summary ?? record.headline ?? record.text;
        if (preferred) return insightValueToMarkdown(preferred);
        return Object.entries(record)
            .map(([key, fieldValue]) => {
                const markdown = insightValueToMarkdown(fieldValue);
                if (!markdown) return "";
                return `**${labelFromInsightKey(key)}**\n\n${markdown}`;
            })
            .filter(Boolean)
            .join("\n\n");
    }
    return String(value);
}

export function parseConcallSections(analysis: unknown): ConcallSection[] {
    if (!analysis) return [];
    let record: Record<string, unknown> | null = null;

    if (typeof analysis === "string") {
        const parsed = parseJsonInsight(analysis);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            record = parsed as Record<string, unknown>;
        } else {
            return [{ key: "analysis", label: "Analysis", markdown: insightValueToMarkdown(analysis) }];
        }
    } else if (typeof analysis === "object" && !Array.isArray(analysis)) {
        record = analysis as Record<string, unknown>;
    }

    if (!record) return [];

    const sections = Object.entries(record)
        .map(([key, value]) => ({
            key,
            label: labelFromInsightKey(key),
            markdown: insightValueToMarkdown(value)
        }))
        .filter((section) => section.markdown.trim());

    sections.sort((first, second) => {
        const firstIndex = CONCALL_SECTION_ORDER.indexOf(
            first.key.toLowerCase().replace(/[_\s-]+/g, "") as (typeof CONCALL_SECTION_ORDER)[number]
        );
        const secondIndex = CONCALL_SECTION_ORDER.indexOf(
            second.key.toLowerCase().replace(/[_\s-]+/g, "") as (typeof CONCALL_SECTION_ORDER)[number]
        );
        if (firstIndex === -1 && secondIndex === -1) return first.label.localeCompare(second.label);
        if (firstIndex === -1) return 1;
        if (secondIndex === -1) return -1;
        return firstIndex - secondIndex;
    });

    return sections;
}

export function bulletsFromMarkdown(markdown: string, limit: number): string[] {
    const lines = markdown
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean);
    return lines.slice(0, limit);
}

export type AnnouncementTypeKind =
    | "credit-rating"
    | "issue-of-securities"
    | "incident"
    | "board-meeting"
    | "agm"
    | "other";

export function classifyAnnouncementType(category?: string | null): AnnouncementTypeKind {
    const clean = category?.toLowerCase() ?? "";
    if (clean.includes("credit") && clean.includes("rating")) return "credit-rating";
    if (clean.includes("issue") && clean.includes("secur")) return "issue-of-securities";
    if (clean.includes("incident") || clean.includes("accident")) return "incident";
    if (clean.includes("board") && clean.includes("meeting")) return "board-meeting";
    if (clean.includes("agm")) return "agm";
    return "other";
}

export function announcementTypeLabel(kind: AnnouncementTypeKind): string {
    const labels: Record<AnnouncementTypeKind, string> = {
        "credit-rating": "Credit Rating",
        "issue-of-securities": "Issue of Securities",
        incident: "Incident",
        "board-meeting": "Board Meeting",
        agm: "AGM",
        other: "Others"
    };
    return labels[kind];
}

export function announcementTypeBadgeVariant(
    kind: AnnouncementTypeKind
): "info" | "secondary" | "destructive" | "warning" {
    if (kind === "credit-rating") return "info";
    if (kind === "issue-of-securities") return "warning";
    if (kind === "incident") return "destructive";
    return "secondary";
}

export function itemKey(item: unknown): string {
    if (typeof item !== "object" || item === null) return JSON.stringify(item);
    const record = item as Record<string, unknown>;
    const directId = record.id ?? record._id;
    if (typeof directId === "string" && directId.trim()) return directId;
    return (
        [record.symbol, record.nse, record.date, record.timestamp, record.headline, record.title, record.type, record.reason]
            .filter(Boolean)
            .join(":") || JSON.stringify(item).slice(0, 300)
    );
}

export function parseFinancialMetricsTable(markdown: string): FinancialMetricRow[] {
    const rows: FinancialMetricRow[] = [];
    const linePattern =
        /([A-Za-z][A-Za-z\s/%]+?)\s*(?:Q4[^0-9+-]*|quarter[^0-9+-]*)?([+-]?\d+(?:\.\d+)?%)[^0-9+-]*(?:FY[^0-9+-]*)?([+-]?\d+(?:\.\d+)?%)/gi;
    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(markdown)) !== null) {
        rows.push({
            metric: match[1].trim(),
            q4: match[2].trim(),
            fy: match[3].trim()
        });
    }
    return rows.slice(0, 8);
}
