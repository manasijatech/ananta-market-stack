"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type { AlphaSymbolMetadata, AlphaSymbolMetadataResponse } from "@/service/types/alpha/symbols";

const METADATA_BATCH_SIZE = 40;

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

function isHollowMetadata(row: AlphaSymbolMetadata): boolean {
    return !row.company_name && !row.logo;
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

async function getAlphaSymbolMetadataBulk(
    symbols: string[],
    options: { forceRefresh?: boolean } = {}
): Promise<AlphaSymbolMetadata[]> {
    const forceRefresh = Boolean(options.forceRefresh);
    if (!symbols.length) return [];
    const batches: string[][] = [];
    for (let index = 0; index < symbols.length; index += METADATA_BATCH_SIZE) {
        batches.push(symbols.slice(index, index + METADATA_BATCH_SIZE));
    }
    const settled = await Promise.all(
        batches.map(async (batch) => {
            const response = await fetchFastApi("/alpha/symbols/metadata/bulk", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ symbols: batch, force_refresh: forceRefresh })
            });
            if (!response.ok) {
                const detail = await response.text().catch(() => "");
                throw new Error(detail || `Symbol metadata request failed (${response.status}).`);
            }
            const result = (await response.json()) as AlphaSymbolMetadataResponse;
            return normalizeMetadataRows(batch, result.data);
        })
    );
    return settled.flat();
}

export async function getAlphaSymbolMetadata(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) {
        return [];
    }
    try {
        let rows = await getAlphaSymbolMetadataBulk(normalized, { forceRefresh: false });
        const hollow = rows.filter(isHollowMetadata).map((row) => row.symbol);
        // Self-heal: if the first pass is mostly empty (stale cache / recovered API key),
        // force one Drishti refresh for the hollow symbols only.
        if (hollow.length > 0 && hollow.length >= Math.max(1, Math.ceil(rows.length * 0.4))) {
            try {
                const refreshed = await getAlphaSymbolMetadataBulk(hollow, { forceRefresh: true });
                const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
                for (const row of refreshed) {
                    if (!isHollowMetadata(row)) {
                        bySymbol.set(row.symbol, row);
                    }
                }
                rows = normalized.map((symbol) => bySymbol.get(symbol) ?? fallbackMetadataRow(symbol));
            } catch {
                // Keep the first-pass rows; callers already tolerate hollow metadata.
            }
        }
        return rows;
    } catch {
        return fallbackMetadata(normalized);
    }
}
