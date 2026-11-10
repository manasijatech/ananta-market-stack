import { getMarketStatus } from "@/service/actions/market-status";
import type { MarketStatus } from "@/service/types/market-status";

/**
 * One cached status read per session for the shell indicator.
 *
 * The backend is cheap (no database, no broker call), but the shell mounts on
 * every navigation; a five-minute stale window keeps the phase label close to
 * live without a request per page view.
 */
export async function fetchMarketStatus(): Promise<MarketStatus | null> {
    return getMarketStatus();
}
