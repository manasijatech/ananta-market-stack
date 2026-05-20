"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import { feedQuery, request, withQuery, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export async function getAlphaAlerts(params: AlphaFeedParams = {}): Promise<AlphaPaginatedResponse<AlphaAlert>> {
    return request<AlphaPaginatedResponse<AlphaAlert>>(withQuery("/v1/alerts", feedQuery(params)));
}
