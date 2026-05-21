"use server";

import type {
    AlphaAttachmentLookupResponse,
    AlphaPaginatedResponse,
    AlphaStringListResponse
} from "@/service/types/alpha/common";
import type { AlphaAnnouncementBatchResponse, AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import {
    normalizeList,
    toAnnouncementsListQueryParams,
    withAlphaSdk,
    type AlphaFeedParams
} from "@/service/actions/alpha/shared";

export async function getAlphaAnnouncementCategories(): Promise<string[]> {
    const result = await withAlphaSdk<AlphaStringListResponse>((client) => client.getAnnouncementsCategories());
    return result.data ?? [];
}

export async function getAlphaAnnouncements(
    params: AlphaFeedParams = {}
): Promise<AlphaPaginatedResponse<AlphaAnnouncementDetail>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaAnnouncementDetail>>((client) =>
        client.getAnnouncements(toAnnouncementsListQueryParams(params))
    );
}

export async function getAlphaAnnouncementsByIds(
    ids: string[],
    detailed = true
): Promise<AlphaAnnouncementBatchResponse> {
    return withAlphaSdk<AlphaAnnouncementBatchResponse>((client) =>
        client.getAnnouncementsItems({
            ids: normalizeList(ids),
            detailed
        })
    );
}

export async function getAlphaAnnouncementAttachments(ids: string[]): Promise<AlphaAttachmentLookupResponse> {
    return withAlphaSdk<AlphaAttachmentLookupResponse>((client) =>
        client.getAnnouncementsAttachments({ ids: normalizeList(ids) })
    );
}
