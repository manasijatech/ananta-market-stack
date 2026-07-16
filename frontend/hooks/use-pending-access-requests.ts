"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getWorkspaceMembers } from "@/service/actions/rbac";
import type { WorkspaceMember } from "@/service/types/rbac";

const POLL_INTERVAL_MS = 15_000;

async function fetchPendingAccessRequests(): Promise<WorkspaceMember[]> {
    return (await getWorkspaceMembers()).filter((member) => member.status === "pending");
}

/** Pending workspace access requests for admins in the header alerts tray. */
export function usePendingAccessRequests(enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.access.pendingRequests(),
        queryFn: fetchPendingAccessRequests,
        enabled,
        refetchInterval: enabled ? POLL_INTERVAL_MS : false
    });
}
