"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import type { AlphaNewsItem } from "@/service/types/alpha/news";
import { feedQuery, queryParamsToObject, withAlphaSdk, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export async function getAlphaNews(params: AlphaFeedParams = {}): Promise<AlphaPaginatedResponse<AlphaNewsItem>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaNewsItem>>((client) =>
        client.getNews({
            query: queryParamsToObject(feedQuery(params))
        })
    );
}
