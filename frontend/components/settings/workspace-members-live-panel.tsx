"use client";

import { RolePermissionsPanel } from "@/components/settings/role-permissions-panel";
import { WorkspaceMemberRow } from "@/components/settings/workspace-member-row";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { typography } from "@/lib/typography";
import type { RoleDefinition, WorkspaceMember } from "@/service/types/rbac";

type WorkspaceMembersLivePanelProps = {
    currentUserId: string;
    initialMembers: WorkspaceMember[];
    roles: RoleDefinition[];
    viewerDefault: string;
};

export function WorkspaceMembersLivePanel({
    currentUserId,
    initialMembers,
    roles,
    viewerDefault
}: WorkspaceMembersLivePanelProps) {
    const { data: members = initialMembers } = useWorkspaceMembers(initialMembers);
    const pendingMembers = members.filter((member) => member.status === "pending");
    const activeMembers = members.filter((member) => member.status === "active");

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                    <p className={typography.sectionEyebrow}>People</p>
                    {pendingMembers.length ? (
                        <Badge size="sm" variant="warning">
                            {pendingMembers.length} pending
                        </Badge>
                    ) : null}
                </div>
                <CardTitle className={typography.sectionTitle}>Approve workspace access</CardTitle>
                <CardDescription className={typography.sectionLead}>
                    New account requests appear here. Approve a request, then choose a role in the confirmation dialog.
                </CardDescription>
                <CardAction className="hidden items-center gap-2 text-[13px] text-muted-foreground sm:flex">
                    <Badge size="sm" variant="success">
                        {activeMembers.length} active
                    </Badge>
                    <Badge size="sm" variant="secondary">
                        {members.length} total
                    </Badge>
                </CardAction>
            </CardHeader>
            <CardPanel className="grid gap-4">
                <div className="grid overflow-hidden rounded-lg border border-border bg-background">
                    <div className="hidden grid-cols-[minmax(0,1fr)_180px_80px] border-b border-border bg-muted/35 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
                        <span>Member</span>
                        <span>Workspace role</span>
                        <span className="text-right">Actions</span>
                    </div>
                    {members.length ? (
                        members.map((member: WorkspaceMember) => (
                            <WorkspaceMemberRow
                                currentUserId={currentUserId}
                                key={member.user_id}
                                member={member}
                                roles={roles}
                                viewerDefault={viewerDefault}
                            />
                        ))
                    ) : (
                        <div className="px-4 py-8 text-sm text-muted-foreground">
                            No members are waiting for approval.
                        </div>
                    )}
                </div>

                <RolePermissionsPanel roles={roles} />
            </CardPanel>
        </Card>
    );
}
