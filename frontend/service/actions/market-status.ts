"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type { MarketStatus } from "@/service/types/market-status";

/**
 * Reads the exchange session phase from the backend.
 *
 * Returns ``null`` on any failure instead of throwing: the shell renders the
 * indicator beside other chrome and must stay usable when the API is down.
 */
export async function getMarketStatus(): Promise<MarketStatus | null> {
    try {
        const response = await fetchFastApi("/market/status");
        if (!response.ok) {
            return null;
        }
        return (await response.json()) as MarketStatus;
    } catch {
        return null;
    }
}
