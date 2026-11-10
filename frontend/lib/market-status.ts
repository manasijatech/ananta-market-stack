import type { MarketStatus, MarketStatusTone } from "@/service/types/market-status";

/**
 * Pure presentation for the shell market-status indicator.
 *
 * Kept free of React and fetch so the copy can be unit tested. The backend
 * already returns a complete sentence in ``label``; the shell splits it into a
 * short state ("NSE closed") and the reason ("holiday: ... · opens ...") so it
 * can survive a narrow header without losing the one fact a trader needs.
 */

const IST_TIME = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
});

const IST_DAY = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short"
});

const PHASE_LABELS: Record<string, string> = {
    pre_market: "pre-market",
    preopen_entry: "pre-open",
    preopen_matching: "pre-open match",
    preopen_transition: "pre-open",
    preopen_limit_and_market_entry: "pre-open",
    preopen_limit_entry_random_close: "pre-open",
    closing_eligibility_unverified: "closing auction",
    cas_reference_transition: "closing auction",
    cas_limit_and_market_entry: "closing auction",
    cas_limit_entry_random_close: "closing auction",
    cas_matching: "closing auction",
    post_close: "post-close",
    special_session_closed: "special session closed",
    special_session_times_unverified: "special session"
};

export type MarketStatusSummary = {
    tone: MarketStatusTone;
    /** "NSE open" / "NSE closed" — always present. */
    label: string;
    /** The next fact: the phase, the holiday, or the next open. */
    detail: string;
    /** Full sentence for the tooltip and screen readers. */
    title: string;
};

function parseIst(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "11 Nov, 09:15" in IST, or an empty string when the timestamp is unusable. */
export function formatNextOpen(value: string | null | undefined): string {
    const parsed = parseIst(value);
    if (!parsed) return "";
    return `${IST_DAY.format(parsed)}, ${IST_TIME.format(parsed)}`;
}

/** "9 Nov" in IST, or an empty string when the date is unusable. */
export function formatSessionDate(value: string | null | undefined): string {
    const parsed = parseIst(value);
    if (!parsed) return "";
    return IST_DAY.format(parsed);
}

function phaseLabel(status: MarketStatus): string {
    return PHASE_LABELS[status.phase] ?? status.phase.replaceAll("_", " ");
}

function unverifiedCoverage(status: MarketStatus): boolean {
    return status.calendar_coverage === "weekday_only_unverified_holidays"
        || status.calendar_coverage === "operator_override_unverified";
}

/**
 * Turns a status payload into the three strings the indicator renders.
 *
 * The backend ``label`` is authoritative for the sentence; this function
 * re-derives the split so the component can hide the detail independently.
 */
export function summarizeMarketStatus(status: MarketStatus | null): MarketStatusSummary | null {
    if (!status) return null;
    const exchange = status.exchange || "NSE";
    const next = formatNextOpen(status.next_open);

    if (status.status === "open") {
        const last = formatSessionDate(status.last_completed_session);
        return {
            tone: "open",
            label: `${exchange} open`,
            detail: phaseLabel(status),
            title: last
                ? `${exchange} is trading now. Last completed session was ${last}.`
                : `${exchange} is trading now.`
        };
    }

    if (status.status === "pre_open") {
        return {
            tone: "pre_open",
            label: `${exchange} pre-open`,
            detail: next ? `opens ${next}` : phaseLabel(status),
            title: next
                ? `${exchange} pre-open is running. Continuous trading starts ${next} IST.`
                : `${exchange} pre-open is running.`
        };
    }

    if (status.status === "holiday") {
        const name = status.holiday_name?.trim();
        const reason = name ? `holiday: ${name}` : "holiday";
        return {
            tone: "closed",
            label: `${exchange} closed`,
            detail: next ? `${reason} · opens ${next}` : reason,
            title: next
                ? `${exchange} is closed today${name ? ` for ${name}` : ""}. Next session opens ${next} IST.`
                : `${exchange} is closed today${name ? ` for ${name}` : ""}.`
        };
    }

    if (status.status === "weekend") {
        return {
            tone: "closed",
            label: `${exchange} closed`,
            detail: next ? `weekend · opens ${next}` : "weekend",
            title: next
                ? `${exchange} is closed for the weekend. Next session opens ${next} IST.`
                : `${exchange} is closed for the weekend.`
        };
    }

    const phase = phaseLabel(status);
    // "closed" is already in the label; the next open is the only fact left.
    const detail = !next ? phase : status.phase === "closed" ? `opens ${next}` : `${phase} · opens ${next}`;
    const coverage = unverifiedCoverage(status) ? " Holiday list coverage for this year is unverified." : "";
    return {
        tone: "closed",
        label: `${exchange} closed`,
        detail,
        title: next
            ? `${exchange} is not in a continuous session right now. Next session opens ${next} IST.${coverage}`
            : `${exchange} is not in a continuous session right now.${coverage}`
    };
}
