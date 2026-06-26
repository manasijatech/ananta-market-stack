"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";

/**
 * Resolves the RBAC-aware post-auth route on the client.
 *
 * Used on the pending-approval page so users can re-check without a full reload.
 */
export function usePostAuthRoute(enabled = true) {
    return useQuery({
        queryKey: queryKeys.auth.postAuthRoute(),
        queryFn: resolvePostAuthRoute,
        enabled,
        retry: false
    });
}
