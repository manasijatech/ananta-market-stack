"use server";

import type {
    AlphaAttachmentLookupResponse,
    AlphaPaginatedResponse,
    AlphaAnnouncementCategoriesResponse
} from "@/service/types/alpha/common";
import type { AlphaAnnouncementDetail } from "@/service/types/alpha/announcements";
import {
    normalizeList,
    toAnnouncementsListQueryParams,
    withAlphaSdk,
    type AlphaFeedParams
} from "@/service/actions/alpha/shared";

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
}

export async function getAlphaAnnouncementCategories(): Promise<string[]> {
    const result = await withAlphaSdk<AlphaAnnouncementCategoriesResponse>((client) => client.getAnnouncementsCategories());
    return [
        ...normalizeStringList(result.data?.important),
        ...normalizeStringList(result.data?.not_important)
    ];
}

export async function getAlphaAnnouncements(
    params: AlphaFeedParams = {}
): Promise<AlphaPaginatedResponse<AlphaAnnouncementDetail>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaAnnouncementDetail>>((client) =>
        client.getAnnouncements(toAnnouncementsListQueryParams(params))
    );
}

export async function getAlphaAnnouncementAttachments(ids: string[]): Promise<AlphaAttachmentLookupResponse> {
    return withAlphaSdk<AlphaAttachmentLookupResponse>((client) =>
        client.getAnnouncementsAttachments({ ids: normalizeList(ids) })
    );
}
