import type { AnnouncementBatchResponse, AnnouncementDetail, Attachment } from "@manasija/market-stack-sdk";

export interface AlphaSource {
    name?: string | null;
    url?: string | null;
}

export interface AlphaAnnouncementMetadata {
    hash?: string | null;
    is_earnings?: boolean | null;
    category?: string | null;
    related_categories?: string[];
    descriptor?: string | null;
    confidence?: number | null;
    important?: boolean | null;
    research_marked_important?: boolean | null;
    duplicate?: boolean | null;
}

export interface AlphaAnnouncementDetail extends AnnouncementDetail {
    tags?: string[];
    imp_announcement?: boolean;
    research_marked_important?: boolean | null;
    duplicate?: boolean;
    attachment?: Attachment | null;
    r2_key?: string | null;
    pdf_r2_key?: string | null;
    sources?: AlphaSource[];
    metadata?: AlphaAnnouncementMetadata | null;
}

export type AlphaAnnouncementBatchResponse = AnnouncementBatchResponse;
