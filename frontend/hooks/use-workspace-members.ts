"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getWorkspaceMembers } from "@/service/actions/rbac";
import type { WorkspaceMember } from "@/service/types/rbac";

export const WORKSPACE_MEMBERS_POLL_INTERVAL_MS = 5_000;

export function useWorkspaceMembers(initialData?: WorkspaceMember[]) {
    return useQuery({
        queryKey: queryKeys.access.members(),
        queryFn: getWorkspaceMembers,
        initialData,
        refetchInterval: WORKSPACE_MEMBERS_POLL_INTERVAL_MS,
        refetchIntervalInBackground: true
    });
}
