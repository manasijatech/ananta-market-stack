"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import { feedQuery, request, withQuery, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export async function getAlphaNews(params: AlphaFeedParams = {}): Promise<AlphaPaginatedResponse<AlphaNewsItem>> {
    return request<AlphaPaginatedResponse<AlphaNewsItem>>(withQuery("/v1/news", feedQuery(params)));
}
