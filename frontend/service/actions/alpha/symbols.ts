"use server";

import type { AlphaSymbolMetadata, AlphaSymbolMetadataResponse } from "@/service/types/alpha/symbols";
import { appendList, request, withQuery } from "@/service/actions/alpha/shared";

const SYMBOL_METADATA_BATCH_SIZE = 20;

function normalizeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const symbol of symbols) {
    const item = symbol.trim().toUpperCase();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

async function getAlphaSymbolMetadataBatch(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
  const query = new URLSearchParams();
  appendList(query, "symbols", symbols);
  if (!query.has("symbols")) return [];
  const result = await request<AlphaSymbolMetadataResponse>(withQuery("/v1/symbols/metadata", query));
  return result.data ?? [];
}

export async function getAlphaSymbolMetadata(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
  const normalized = normalizeSymbols(symbols);
  const metadata: AlphaSymbolMetadata[] = [];
  for (let index = 0; index < normalized.length; index += SYMBOL_METADATA_BATCH_SIZE) {
    const batch = normalized.slice(index, index + SYMBOL_METADATA_BATCH_SIZE);
    metadata.push(...await getAlphaSymbolMetadataBatch(batch));
  }
  return metadata;
}
