import type { AnnouncementBatchResponse, AnnouncementDetail, EarningsDetail } from "drishti-sdk";

export type AlphaEarningsTableMetric = {
    unit?: string | null;
    yoy_percent?: number | null;
    qoq_percent?: number | null;
    current_period_value?: number | null;
    previous_quarter_value?: number | null;
    previous_year_value?: number | null;
    year_yoy_percent?: number | null;
    current_year_value?: number | null;
    previous_year_full_value?: number | null;
    cumulative_yoy_percent?: number | null;
    current_cumulative_value?: number | null;
    previous_year_cumulative_value?: number | null;
};

export type AlphaEarningsTableSection = {
    current_period_label?: string | null;
    previous_quarter_label?: string | null;
    previous_year_label?: string | null;
    current_full_year_label?: string | null;
    previous_full_year_label?: string | null;
    current_cumulative_period_label?: string | null;
    previous_year_cumulative_period_label?: string | null;
    revenue?: AlphaEarningsTableMetric;
    operating_profit?: AlphaEarningsTableMetric;
    ebitda_margin?: AlphaEarningsTableMetric;
    pat?: AlphaEarningsTableMetric;
    eps?: AlphaEarningsTableMetric;
    pbt?: AlphaEarningsTableMetric;
    npas?: AlphaEarningsTableMetric;
    provisions?: AlphaEarningsTableMetric;
    confidence?: number;
};

export type AlphaEarningsTableExtraction = {
    standalone?: AlphaEarningsTableSection | null;
    consolidated?: AlphaEarningsTableSection | null;
    confidence?: number | null;
};

export type AlphaEarningsTablePayload = AlphaEarningsTableExtraction | AlphaEarningsTableSection;

/** Announcement list/detail rows from alpha-api (`important`, not legacy `imp_announcement`). */
export type AlphaAnnouncementDetail = AnnouncementDetail & {
    /** Detailed feed responses may include the direct document URL. */
    attachment_url?: string | null;
};

/** Earnings rows may include quarter labels even when the SDK type omits them. */
export type AlphaEarningsDetail = Omit<EarningsDetail, "earnings_table"> & {
    quarter?: string | null;
    /** Structured earnings results from the Drishti/Alpha payload. */
    earnings_table?: AlphaEarningsTablePayload | null;
    /** Older payloads may use the extraction field name directly. */
    earnings_table_extraction?: AlphaEarningsTablePayload | null;
};

export type AlphaAnnouncementBatchResponse = AnnouncementBatchResponse;
