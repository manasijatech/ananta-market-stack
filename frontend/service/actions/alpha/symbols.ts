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

function isHollowMetadata(row: AlphaSymbolMetadata | null | undefined): boolean {
    return !row?.company_name && !row?.logo;
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

function preferMetadataRow(current: AlphaSymbolMetadata | undefined, incoming: AlphaSymbolMetadata): AlphaSymbolMetadata {
    if (!current) return incoming;
    const currentUsable = !isHollowMetadata(current);
    const incomingUsable = !isHollowMetadata(incoming);
    if (incomingUsable && !currentUsable) return incoming;
    if (currentUsable && !incomingUsable) return current;
    if (incoming.logo && !current.logo) return incoming;
    if (current.logo && !incoming.logo) return current;
    if (incoming.company_name && !current.company_name) return incoming;
    if (incomingUsable) return incoming;
    return current;
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

function mergeMetadataRows(base: AlphaSymbolMetadata[], incoming: AlphaSymbolMetadata[]): AlphaSymbolMetadata[] {
    const bySymbol = new Map(base.map((row) => [row.symbol, row]));
    for (const row of incoming) {
        bySymbol.set(row.symbol, preferMetadataRow(bySymbol.get(row.symbol), row));
    }
    return base.map((row) => bySymbol.get(row.symbol) ?? row);
}

export async function getAlphaSymbolMetadata(symbols: string[]): Promise<AlphaSymbolMetadata[]> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) {
        return [];
    }

    let rows: AlphaSymbolMetadata[] = [];
    try {
        rows = await getAlphaSymbolMetadataBulk(normalized, { forceRefresh: false });
    } catch (error) {
        console.error("[alpha-metadata] bulk fetch failed; retrying once", error);
        try {
            rows = await getAlphaSymbolMetadataBulk(normalized, { forceRefresh: true });
        } catch (retryError) {
            console.error("[alpha-metadata] bulk fetch retry failed", retryError);
            return fallbackMetadata(normalized);
        }
    }

    const hollow = rows.filter(isHollowMetadata).map((row) => row.symbol);
    if (!hollow.length) {
        return rows;
    }

    // Always self-heal hollow rows — even a single missing logo/name should backfill.
    try {
        const refreshed = await getAlphaSymbolMetadataBulk(hollow, { forceRefresh: true });
        return mergeMetadataRows(rows, refreshed);
    } catch (error) {
        console.error("[alpha-metadata] hollow force-refresh failed", error);
        return rows;
    }
}
