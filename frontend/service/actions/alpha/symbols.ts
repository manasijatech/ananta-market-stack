"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type { AlphaSymbolMetadata, AlphaSymbolMetadataResponse } from "@/service/types/alpha/symbols";

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
    query.set("symbols", symbols.join(","));
    if (!query.has("symbols")) return [];
    const response = await fetchFastApi(`/alpha/symbols/metadata?${query.toString()}`);
    const result = (await response.json()) as AlphaSymbolMetadataResponse;
    if (!response.ok) {
        const detail = (result as unknown as { detail?: unknown; message?: unknown }).detail;
        const message =
            typeof detail === "string"
                ? detail
                : typeof (result as unknown as { message?: unknown }).message === "string"
                  ? String((result as unknown as { message?: unknown }).message)
                  : "Could not fetch symbol metadata from the local backend cache.";
        throw new Error(
            JSON.stringify({
                status: response.status,
                message,
                fieldErrors: {}
            })
        );
    }
    return result.data ?? [];
}

export async function getAlphaSymbolMetadata(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
    const normalized = normalizeSymbols(symbols);
    const metadata: AlphaSymbolMetadata[] = [];
    for (let index = 0; index < normalized.length; index += SYMBOL_METADATA_BATCH_SIZE) {
        const batch = normalized.slice(index, index + SYMBOL_METADATA_BATCH_SIZE);
        metadata.push(...(await getAlphaSymbolMetadataBatch(batch)));
    }
    return metadata;
}
