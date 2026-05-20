"use server";

import type {
    AlphaAttachmentLookupResponse,
    AlphaPaginatedResponse,
    AlphaStringListResponse
} from "@/service/types/alpha/common";
import type { AlphaAnnouncementBatchResponse, AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import {
    appendList,
    appendParam,
    feedQuery,
    queryParamsToObject,
    request,
    withAlphaSdk,
    type AlphaFeedParams
} from "@/service/actions/alpha/shared";

export async function getAlphaAnnouncementCategories(): Promise<string[]> {
    const result = await withAlphaSdk<AlphaStringListResponse>((client) =>
        client.getAnnouncementsCategories()
    );
    return result.data ?? [];
}

export async function getAlphaAnnouncements(
    params: AlphaFeedParams = {}
): Promise<AlphaPaginatedResponse<AlphaAnnouncementDetail>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaAnnouncementDetail>>((client) =>
        client.getAnnouncements({
            query: queryParamsToObject(feedQuery(params))
        })
    );
}

export async function getAlphaAnnouncementsByIds(
    ids: string[],
    detailed = true
): Promise<AlphaAnnouncementBatchResponse> {
    const query = new URLSearchParams();
    appendList(query, "ids", ids);
    appendParam(query, "detailed", detailed);
    return withAlphaSdk<AlphaAnnouncementBatchResponse>((client) =>
        client.getAnnouncementsItems({
            query: queryParamsToObject(query)
        })
    );
}

export async function getAlphaAnnouncementAttachments(ids: string[]): Promise<AlphaAttachmentLookupResponse> {
    const query = new URLSearchParams();
    appendList(query, "ids", ids);
    return withAlphaSdk<AlphaAttachmentLookupResponse>((client) =>
        client.getAnnouncementsAttachments({
            query: queryParamsToObject(query)
        })
    );
}
