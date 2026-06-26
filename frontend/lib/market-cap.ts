/** Market cap values are stored in crore (Cr). */

function trimTrailingNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatMarketCapInCrores(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 100_000) return `${trimTrailingNumber(value / 100_000)}L Cr`;
    if (abs >= 1_000) return `${trimTrailingNumber(value / 1_000)}K Cr`;
    return `${Math.round(value)} Cr`;
}

export function formatMarketCap(value?: number | null): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    return formatMarketCapInCrores(value);
}
