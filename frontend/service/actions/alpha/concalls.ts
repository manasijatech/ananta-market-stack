"use server";

import type {
    AlphaAttachmentLookupResponse,
    AlphaPaginatedResponse,
    AlphaPresignedUrlResponse
} from "@/service/types/alpha/common";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import { appendList, feedQuery, request, withQuery, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export async function getAlphaConcalls(params: AlphaFeedParams = {}): Promise<AlphaPaginatedResponse<AlphaConcall>> {
    const response = await request<AlphaPaginatedResponse<AlphaConcall>>(withQuery("/v1/concalls", feedQuery(params)));
    return response;
}

export async function getAlphaConcall(concallId: string): Promise<AlphaConcall> {
    return request<AlphaConcall>(`/v1/concalls/${encodeURIComponent(concallId)}`);
}

export async function getAlphaConcallTranscripts(ids: string[]): Promise<AlphaAttachmentLookupResponse> {
    const query = new URLSearchParams();
    appendList(query, "ids", ids);
    return request<AlphaAttachmentLookupResponse>(withQuery("/v1/concalls/transcripts", query));
}

export async function getAlphaConcallTranscript(concallId: string): Promise<AlphaPresignedUrlResponse> {
    return request<AlphaPresignedUrlResponse>(`/v1/concalls/${encodeURIComponent(concallId)}/transcript`);
}
