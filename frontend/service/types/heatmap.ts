import type { BrokerCode } from "@/service/types/broker";

export type HeatmapScope = "tracked" | "watchlist" | "portfolio_holdings";

export interface HeatmapAlphaEventTag {
    tag: string;
    count: number;
}

export interface HeatmapAlphaEvent {
    id: string;
    product: string;
    event_key: string;
    received_at: string;
    processed_at?: string | null;
    payload: Record<string, unknown>;
}

export interface HeatmapAlphaEventSummary {
    total_count: number;
    tags: HeatmapAlphaEventTag[];
    latest_received_at?: string | null;
}

export interface HeatmapSymbol {
    symbol: string;
    exchange?: string | null;
    broker_code: BrokerCode | string;
    account_id: string;
    ltp: number;
    day_change?: number | null;
    day_change_perc?: number | null;
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
    volume?: number | null;
    market_cap?: number | string | null;
    company_name?: string | null;
    logo?: string | null;
    sector?: string | null;
    basic_industry?: string | null;
    industry?: string | null;
    theme?: string | null;
    health_status: string;
    health_reason: string;
    last_received_at?: string | null;
    source_kinds: string[];
    alpha_event_summary: HeatmapAlphaEventSummary;
    alpha_events: HeatmapAlphaEvent[];
    live_data: Record<string, unknown>;
}

export interface HeatmapResponse {
    scope: HeatmapScope;
    scope_label: string;
    selection_id?: string | null;
    broker_code?: string | null;
    account_id?: string | null;
    requested_limit: number;
    returned_count: number;
    tracked_symbol_count: number;
    days?: number | null;
    items: HeatmapSymbol[];
}
