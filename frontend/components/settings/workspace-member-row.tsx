"use client";

import { Badge } from "@/components/ui/badge";
import { WorkspaceMemberActions } from "@/components/settings/workspace-member-actions";
import { WorkspaceMemberRoleControls } from "@/components/settings/workspace-member-role-form";
import {
    memberAvatarClass,
    memberInitials,
    memberLabel,
    memberSubtitle,
    sentenceCase
} from "@/components/settings/workspace-member-utils";
import type { RoleDefinition, WorkspaceMember } from "@/service/types/rbac";
import { cn } from "@/lib/utils";

type WorkspaceMemberRowProps = {
    currentUserId: string;
    member: WorkspaceMember;
    roles: RoleDefinition[];
    viewerDefault: string;
};

function roleBadgeVariant(roleName: string): "info" | "secondary" {
    return roleName === "admin" ? "info" : "secondary";
}

function statusBadgeVariant(status: string): "success" | "secondary" | "warning" {
    if (status === "active") {
        return "success";
    }
    if (status === "pending") {
        return "warning";
    }
    return "secondary";
}

export function WorkspaceMemberRow({ currentUserId, member, roles, viewerDefault }: WorkspaceMemberRowProps) {
    const isSelf = member.user_id === currentUserId;
    const roleLabel = roles.find((role) => role.name === member.role)?.label ?? member.role;
    const avatarSeed = member.user_id || member.email || memberLabel(member);
    const subtitle = memberSubtitle(member);

    return (
        <div
            className={cn(
                "grid items-center gap-3 border-t border-border bg-background px-4 py-3 first:border-t-0 hover:bg-muted/35",
                "md:min-h-16 md:grid-cols-[minmax(0,1fr)_180px_40px]",
                "focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-offset-2 focus-within:ring-offset-background"
            )}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div
                    className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                        memberAvatarClass(avatarSeed)
                    )}
                >
                    {memberInitials(member)}
                </div>
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{memberLabel(member)}</span>
                        {isSelf ? (
                            <Badge className="rounded-full" size="sm" variant="secondary">
                                You
                            </Badge>
                        ) : null}
                        <Badge size="sm" variant={statusBadgeVariant(member.status)}>
                            {sentenceCase(member.status)}
                        </Badge>
                        <Badge size="sm" variant={roleBadgeVariant(member.role)}>
                            {sentenceCase(roleLabel)}
                        </Badge>
                    </div>
                    <p className="mt-px truncate text-xs text-muted-foreground">{subtitle}</p>
                </div>
            </div>

            <WorkspaceMemberRoleControls isSelf={isSelf} member={member} roles={roles} viewerDefault={viewerDefault} />

            <div className="flex justify-end md:w-10">
                <WorkspaceMemberActions currentUserId={currentUserId} member={member} />
            </div>
        </div>
    );
}
