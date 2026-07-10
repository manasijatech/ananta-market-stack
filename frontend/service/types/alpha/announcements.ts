import type { AnnouncementBatchResponse, AnnouncementDetail, EarningsDetail } from "drishti-sdk";

/** Announcement list/detail rows from alpha-api (`important`, not legacy `imp_announcement`). */
export type AlphaAnnouncementDetail = AnnouncementDetail;

/** Earnings rows may include quarter labels even when the SDK type omits them. */
export type AlphaEarningsDetail = EarningsDetail & {
    quarter?: string | null;
};

export type AlphaAnnouncementBatchResponse = AnnouncementBatchResponse;
