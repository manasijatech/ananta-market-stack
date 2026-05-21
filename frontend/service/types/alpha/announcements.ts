import type { AnnouncementBatchResponse, AnnouncementDetail, EarningsDetail } from "@manasija/market-stack-sdk";

/** Announcement list/detail rows from alpha-api (`important`, not legacy `imp_announcement`). */
export type AlphaAnnouncementDetail = AnnouncementDetail;

export type AlphaEarningsDetail = EarningsDetail;

export type AlphaAnnouncementBatchResponse = AnnouncementBatchResponse;
