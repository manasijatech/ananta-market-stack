"use server";

import type { AlphaAttachmentLookupResponse, AlphaPaginatedResponse } from "@/service/types/alpha/common";
import type { AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import { appendList, feedQuery, queryParamsToObject, request, withAlphaSdk, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export async function getAlphaEarnings(
    params: AlphaFeedParams = {}
): Promise<AlphaPaginatedResponse<AlphaAnnouncementDetail>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaAnnouncementDetail>>((client) =>
        client.getEarnings({
            query: queryParamsToObject(feedQuery(params))
        })
    );
}

export async function getAlphaEarning(earningsId: string): Promise<AlphaAnnouncementDetail> {
    return request<AlphaAnnouncementDetail>(`/v1/earnings/${encodeURIComponent(earningsId)}`);
}

export async function getAlphaEarningsAttachments(ids: string[]): Promise<AlphaAttachmentLookupResponse> {
    const query = new URLSearchParams();
    appendList(query, "ids", ids);
    return withAlphaSdk<AlphaAttachmentLookupResponse>((client) =>
        client.getEarningsAttachments({
            query: queryParamsToObject(query)
        })
    );
}
