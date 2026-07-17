"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { DeploymentUpdateStatus } from "@/service/types/deployment";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function getDeploymentUpdateStatus(): Promise<DeploymentUpdateStatus | null> {
    const response = await fetch("/api/v1/deployment/update-status", {
        cache: "no-store",
        credentials: "same-origin"
    });
    if (!response.ok) {
        return null;
    }
    return (await response.json()) as DeploymentUpdateStatus;
}

/** Polls whether a newer deployment image is available for self-hosted instances. */
export function useDeploymentUpdateStatus() {
    return useQuery({
        queryKey: queryKeys.deployment.updateStatus(),
        queryFn: getDeploymentUpdateStatus,
        staleTime: FIVE_MINUTES_MS
    });
}
