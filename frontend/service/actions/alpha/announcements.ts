"use server";

import type {
  AlphaAttachmentLookupResponse,
  AlphaPaginatedResponse,
  AlphaStringListResponse
} from "@/service/types/alpha/common";
import type {
  AlphaAnnouncementBatchResponse,
  AlphaAnnouncementDetail
} from "@/service/types/alpha/announcements";
import {
  appendList,
  appendParam,
  feedQuery,
  request,
  withQuery,
  type AlphaFeedParams
} from "@/service/actions/alpha/shared";

export async function getAlphaAnnouncementCategories(): Promise<string[]> {
  const result = await request<AlphaStringListResponse>("/v1/announcements/categories");
  return result.data ?? [];
}

export async function getAlphaAnnouncements(
  params: AlphaFeedParams = {}
): Promise<AlphaPaginatedResponse<AlphaAnnouncementDetail>> {
  return request<AlphaPaginatedResponse<AlphaAnnouncementDetail>>(withQuery("/v1/announcements", feedQuery(params)));
}

export async function getAlphaAnnouncementsByIds(
  ids: string[],
  detailed = true
): Promise<AlphaAnnouncementBatchResponse> {
  const query = new URLSearchParams();
  appendList(query, "ids", ids);
  appendParam(query, "detailed", detailed);
  return request<AlphaAnnouncementBatchResponse>(withQuery("/v1/announcements/items", query));
}

export async function getAlphaAnnouncementAttachments(ids: string[]): Promise<AlphaAttachmentLookupResponse> {
  const query = new URLSearchParams();
  appendList(query, "ids", ids);
  return request<AlphaAttachmentLookupResponse>(withQuery("/v1/announcements/attachments", query));
}
