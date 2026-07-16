"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getWorkspaceMembers } from "@/service/actions/rbac";
import { WORKSPACE_MEMBERS_POLL_INTERVAL_MS } from "@/hooks/use-workspace-members";
import type { WorkspaceMember } from "@/service/types/rbac";

/** Pending workspace access requests for admins in the header alerts tray. */
export function usePendingAccessRequests(enabled: boolean) {
    return useQuery({
        queryKey: queryKeys.access.members(),
        queryFn: getWorkspaceMembers,
        enabled,
        select: (members: WorkspaceMember[]) => members.filter((member) => member.status === "pending"),
        refetchInterval: enabled ? WORKSPACE_MEMBERS_POLL_INTERVAL_MS : false,
        refetchIntervalInBackground: enabled
    });
}
