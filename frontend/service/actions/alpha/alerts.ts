"use server";

import type { AlphaPaginatedResponse } from "@/service/types/alpha/common";
import type { AlphaAlert } from "@/service/types/alpha/alerts";
import { toAlertsQueryParams, withAlphaSdk, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export async function getAlphaAlerts(params: AlphaFeedParams = {}): Promise<AlphaPaginatedResponse<AlphaAlert>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaAlert>>((client) => client.getAlerts(toAlertsQueryParams(params)));
}
