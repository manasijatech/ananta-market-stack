"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";

type PostAuthRouteResult = Awaited<ReturnType<typeof resolvePostAuthRoute>>;

/**
 * Resolves the RBAC-aware post-auth route on the client.
 *
 * Used on the pending-approval page so users can re-check without a full reload.
 * Pass `refetchInterval` (number or react-query backoff function) to poll
 * automatically — the page uses this so an approved user is let in within
 * seconds without clicking anything.
 */
export function usePostAuthRoute(
    enabled = true,
    refetchInterval?: UseQueryOptions<PostAuthRouteResult, Error, PostAuthRouteResult>["refetchInterval"]
) {
    return useQuery({
        queryKey: queryKeys.auth.postAuthRoute(),
        queryFn: resolvePostAuthRoute,
        enabled,
        retry: false,
        refetchInterval
    });
}
