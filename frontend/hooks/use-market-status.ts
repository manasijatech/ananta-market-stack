"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchMarketStatus } from "@/lib/queries/market-status";

const STALE_MS = 60 * 1000;

/**
 * Cached exchange session state for the shell indicator.
 *
 * One request per minute regardless of how many pages mount the shell: the
 * phase changes at most a handful of times a day, so the indicator stays close
 * to live without a request per navigation.
 */
export function useMarketStatus() {
    return useQuery({
        queryKey: queryKeys.market.status(),
        queryFn: fetchMarketStatus,
        staleTime: STALE_MS,
        gcTime: STALE_MS,
        retry: false
    });
}
