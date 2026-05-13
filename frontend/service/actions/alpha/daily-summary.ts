"use server";

import type {
  AlphaDailySummaryRequest,
  AlphaDailySummaryResponse
} from "@/service/types/alpha/daily-summary";
import { request } from "@/service/actions/alpha/shared";

export async function generateAlphaDailySummary(
  payload: AlphaDailySummaryRequest
): Promise<AlphaDailySummaryResponse> {
  return request<AlphaDailySummaryResponse>("/v1/daily-summary/", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
