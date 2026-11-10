import { describe, expect, it } from "vitest";
import { formatNextOpen, formatSessionDate, summarizeMarketStatus } from "@/lib/market-status";
import type { MarketStatus } from "@/service/types/market-status";

function status(overrides: Partial<MarketStatus> = {}): MarketStatus {
    return {
        exchange: "NSE",
        segment: "cash",
        status: "open",
        phase: "continuous",
        holiday_name: null,
        ist_now: "2026-11-11T11:00:00+05:30",
        trading_date: "2026-11-11",
        is_trading_day: true,
        last_completed_session: "2026-11-09",
        next_open: null,
        live_quotes_expected: true,
        calendar_coverage: "verified_seed_2026",
        label: "Open",
        ...overrides
    };
}

describe("summarizeMarketStatus", () => {
    it("returns null without data so the shell renders nothing", () => {
        expect(summarizeMarketStatus(null)).toBeNull();
    });

    it("names a holiday and the next open", () => {
        const summary = summarizeMarketStatus(
            status({
                status: "holiday",
                phase: "holiday",
                is_trading_day: false,
                holiday_name: "Diwali-Balipratipada",
                live_quotes_expected: false,
                next_open: "2026-11-11T09:15:00+05:30",
                label: "NSE closed · holiday: Diwali-Balipratipada · opens 11 Nov 09:15 IST"
            })
        );

        expect(summary?.tone).toBe("closed");
        expect(summary?.label).toBe("NSE closed");
        expect(summary?.detail).toBe("holiday: Diwali-Balipratipada · opens 11 Nov, 09:15");
        expect(summary?.title).toContain("Diwali-Balipratipada");
    });

    it("still reads as a holiday when the exchange gave no name", () => {
        const summary = summarizeMarketStatus(
            status({
                status: "holiday",
                phase: "holiday",
                is_trading_day: false,
                live_quotes_expected: false,
                next_open: "2026-11-11T09:15:00+05:30"
            })
        );

        expect(summary?.detail).toBe("holiday · opens 11 Nov, 09:15");
        expect(summary?.title).toBe("NSE is closed today. Next session opens 11 Nov, 09:15 IST.");
    });

    it("calls out the weekend", () => {
        const summary = summarizeMarketStatus(
            status({
                status: "weekend",
                phase: "weekend",
                is_trading_day: false,
                live_quotes_expected: false,
                next_open: "2026-11-16T09:15:00+05:30"
            })
        );

        expect(summary?.detail).toBe("weekend · opens 16 Nov, 09:15");
    });

    it("shows the phase while the market trades", () => {
        const summary = summarizeMarketStatus(status());

        expect(summary?.tone).toBe("open");
        expect(summary?.label).toBe("NSE open");
        expect(summary?.detail).toBe("continuous");
    });

    it("uses the pre-open tone before the session starts", () => {
        const summary = summarizeMarketStatus(
            status({
                status: "pre_open",
                phase: "preopen_matching",
                live_quotes_expected: false,
                next_open: "2026-11-11T09:15:00+05:30"
            })
        );

        expect(summary?.tone).toBe("pre_open");
        expect(summary?.label).toBe("NSE pre-open");
        expect(summary?.detail).toBe("opens 11 Nov, 09:15");
    });

    it("reports the next open after hours", () => {
        const summary = summarizeMarketStatus(
            status({
                status: "closed",
                phase: "closed",
                live_quotes_expected: false,
                next_open: "2026-11-12T09:15:00+05:30"
            })
        );

        expect(summary?.tone).toBe("closed");
        // "closed" is already in the label; the detail carries only the next open.
        expect(summary?.detail).toBe("opens 12 Nov, 09:15");
    });

    it("keeps the phase when the market is in the closing auction", () => {
        const summary = summarizeMarketStatus(
            status({
                status: "closed",
                phase: "cas_matching",
                live_quotes_expected: false,
                next_open: "2026-11-12T09:15:00+05:30"
            })
        );

        expect(summary?.detail).toBe("closing auction · opens 12 Nov, 09:15");
    });

    it("notes unverified coverage in the tooltip, not the label", () => {
        const summary = summarizeMarketStatus(
            status({
                status: "closed",
                phase: "closed",
                live_quotes_expected: false,
                calendar_coverage: "weekday_only_unverified_holidays",
                next_open: "2026-11-12T09:15:00+05:30"
            })
        );

        expect(summary?.tone).toBe("closed");
        expect(summary?.title).toContain("unverified");
    });

    it("uses the exchange name from the payload", () => {
        const summary = summarizeMarketStatus(
            status({
                exchange: "BSE",
                status: "holiday",
                phase: "holiday",
                is_trading_day: false,
                live_quotes_expected: false
            })
        );

        expect(summary?.label).toBe("BSE closed");
    });

    it("degrades to a readable detail when the next open is unknown", () => {
        const summary = summarizeMarketStatus(
            status({ status: "closed", phase: "special_session_closed", live_quotes_expected: false, next_open: null })
        );

        expect(summary?.detail).toBe("special session closed");
        expect(summary?.label).toBe("NSE closed");
    });
});

describe("IST formatting", () => {
    it("formats the next open in IST regardless of the host timezone", () => {
        expect(formatNextOpen("2026-11-11T03:45:00+00:00")).toBe("11 Nov, 09:15");
    });

    it("formats the last session date", () => {
        expect(formatSessionDate("2026-11-09T00:00:00+05:30")).toBe("9 Nov");
    });

    it("returns an empty string for unusable input", () => {
        expect(formatNextOpen(null)).toBe("");
        expect(formatNextOpen("not-a-date")).toBe("");
        expect(formatSessionDate(undefined)).toBe("");
    });
});
