"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";

export function usePostAuthRoute(enabled = true) {
    return useQuery({
        queryKey: queryKeys.auth.postAuthRoute(),
        queryFn: resolvePostAuthRoute,
        enabled,
        retry: false
    });
}
