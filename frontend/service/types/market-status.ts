export type MarketStatusTone = "open" | "pre_open" | "closed";

export type MarketStatus = {
    exchange: string;
    segment: string;
    status: "open" | "pre_open" | "closed" | "holiday" | "weekend";
    phase: string;
    holiday_name: string | null;
    ist_now: string;
    trading_date: string;
    is_trading_day: boolean;
    last_completed_session: string;
    next_open: string | null;
    live_quotes_expected: boolean;
    calendar_coverage: string;
    label: string;
};
