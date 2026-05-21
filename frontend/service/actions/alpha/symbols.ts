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

function fallbackMetadataRow(symbol: string): AlphaSymbolMetadata {
    return {
        symbol,
        company_name: null,
        logo: null,
        market_cap: null,
        sector: null,
        basic_industry: null,
        industry: null,
        macro_economic_indicator: null,
        theme: null,
        scrip_code: null
    };
}

function fallbackMetadata(symbols: string[]): AlphaSymbolMetadata[] {
    return symbols.map(fallbackMetadataRow);
}

function numericValue(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeMetadataRows(symbols: string[], rows: unknown): AlphaSymbolMetadata[] {
    const bySymbol = new Map<string, AlphaSymbolMetadata>();
    if (Array.isArray(rows)) {
        for (const row of rows) {
            if (!row || typeof row !== "object") continue;
            const item = row as Partial<AlphaSymbolMetadata>;
            const symbol = String(item.symbol ?? "")
                .trim()
                .toUpperCase();
            if (!symbol) continue;
            bySymbol.set(symbol, {
                symbol,
                company_name: item.company_name ?? null,
                logo: item.logo ?? null,
                market_cap: numericValue(item.market_cap),
                sector: item.sector ?? null,
                basic_industry: item.basic_industry ?? null,
                industry: item.industry ?? null,
                macro_economic_indicator: item.macro_economic_indicator ?? null,
                theme: item.theme ?? null,
                scrip_code: item.scrip_code ?? null
            });
        }
    }
    return symbols.map((symbol) => bySymbol.get(symbol) ?? fallbackMetadataRow(symbol));
}

async function getAlphaSymbolMetadataBatch(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
    const query = new URLSearchParams();
    query.set("symbols", symbols.join(","));
    if (!query.has("symbols")) return [];
    const response = await fetchFastApi(`/alpha/symbols/metadata?${query.toString()}`);
    if (!response.ok) {
        return fallbackMetadata(symbols);
    }
    try {
        const result = (await response.json()) as AlphaSymbolMetadataResponse;
        return normalizeMetadataRows(symbols, result.data);
    } catch {
        return fallbackMetadata(symbols);
    }
}

export async function getAlphaSymbolMetadata(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
    const normalized = normalizeSymbols(symbols);
    const metadata: AlphaSymbolMetadata[] = [];
    for (let index = 0; index < normalized.length; index += SYMBOL_METADATA_BATCH_SIZE) {
        const batch = normalized.slice(index, index + SYMBOL_METADATA_BATCH_SIZE);
        try {
            metadata.push(...(await getAlphaSymbolMetadataBatch(batch)));
        } catch {
            metadata.push(...fallbackMetadata(batch));
        }
    }
    return metadata;
}
