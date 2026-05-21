"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import { toNewsQueryParams, withAlphaSdk, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export async function getAlphaNews(params: AlphaFeedParams = {}): Promise<AlphaPaginatedResponse<AlphaNewsItem>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaNewsItem>>((client) => client.getNews(toNewsQueryParams(params)));
}
