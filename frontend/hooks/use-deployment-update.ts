"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getDeploymentUpdateStatus } from "@/service/actions/deployment";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function useDeploymentUpdateStatus() {
    return useQuery({
        queryKey: queryKeys.deployment.updateStatus(),
        queryFn: getDeploymentUpdateStatus,
        staleTime: FIVE_MINUTES_MS
    });
}
