"use server";

import type { AlphaAttachmentLookupResponse, AlphaPaginatedResponse } from "@/service/types/alpha/common";
import type { AlphaEarningsDetail } from "@/service/types/alpha/announcements";
import {
    normalizeList,
    toEarningsQueryParams,
    withAlphaSdk,
    type AlphaFeedParams
} from "@/service/actions/alpha/shared";

export type AlphaEarningsDetailParams = {
    symbol: string;
    quarter: string;
    detailed?: boolean;
};

export async function getAlphaEarnings(
    params: AlphaFeedParams = {}
): Promise<AlphaPaginatedResponse<AlphaEarningsDetail>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaEarningsDetail>>((client) =>
        client.getEarnings(toEarningsQueryParams(params))
    );
}

export async function getAlphaEarningsDetail(params: AlphaEarningsDetailParams): Promise<AlphaEarningsDetail> {
    const symbol = params.symbol.trim().toUpperCase();
    const quarter = params.quarter.trim();
    const detailParams = params.detailed === undefined ? {} : { detailed: params.detailed };
    return withAlphaSdk<AlphaEarningsDetail>((client) => client.getEarningsDetail({ symbol, quarter, ...detailParams }));
}

export async function getAlphaEarningsAttachments(ids: string[]): Promise<AlphaAttachmentLookupResponse> {
    return withAlphaSdk<AlphaAttachmentLookupResponse>((client) =>
        client.getEarningsAttachments({ ids: normalizeList(ids) })
    );
}
