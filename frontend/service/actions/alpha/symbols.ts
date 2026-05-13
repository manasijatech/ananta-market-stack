"use server";

import type { AlphaSymbolMetadata, AlphaSymbolMetadataResponse } from "@/service/types/alpha/symbols";
import { appendList, request, withQuery } from "@/service/actions/alpha/shared";

export async function getAlphaSymbolMetadata(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
  const query = new URLSearchParams();
  appendList(query, "symbols", symbols.map((symbol) => symbol.toUpperCase()));
  if (!query.has("symbols")) return [];
  const result = await request<AlphaSymbolMetadataResponse>(withQuery("/v1/symbols/metadata", query));
  return result.data ?? [];
}
