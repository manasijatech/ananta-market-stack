"use client";

import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { WorkspaceMemberActions } from "@/components/settings/workspace-member-actions";
import { WorkspaceMemberRoleControls } from "@/components/settings/workspace-member-role-form";
import {
    memberAvatarClass,
    memberInitials,
    memberLabel,
    memberSubtitle,
    roleDisplayLabel,
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

function StatusIcon({ status }: { status: string }) {
    if (status === "active") {
        return <Check aria-hidden className="size-3 text-success-foreground" />;
    }
    if (status === "disabled" || status === "removed" || status === "rejected") {
        return <X aria-hidden className="size-3 text-destructive" />;
    }
    return null;
}

export function WorkspaceMemberRow({ currentUserId, member, roles, viewerDefault }: WorkspaceMemberRowProps) {
    const isSelf = member.user_id === currentUserId;
    const roleDefinition = roles.find((role) => role.name === member.role);
    const roleLabel = roleDisplayLabel(member.role, roleDefinition?.label);
    const avatarSeed = member.user_id || member.email || memberLabel(member);
    const subtitle = memberSubtitle(member);

    return (
        <div
            className={cn(
                "grid items-center gap-3 border-t border-border bg-background px-4 py-3 first:border-t-0 hover:bg-muted/35",
                "md:min-h-16 md:grid-cols-[minmax(0,1fr)_180px_80px]",
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
                            <StatusIcon status={member.status} />
                            {sentenceCase(member.status)}
                        </Badge>
                        {member.status !== "pending" ? (
                            <Badge size="sm" variant={roleBadgeVariant(member.role)}>
                                {roleLabel}
                            </Badge>
                        ) : null}
                        {member.is_owner ? (
                            <Badge size="sm" variant="outline">
                                Owner
                            </Badge>
                        ) : null}
                        {member.status === "rejected" ? (
                            <Badge size="sm" variant="error">
                                <X aria-hidden className="size-3 text-destructive" />
                                Rejected
                            </Badge>
                        ) : null}
                    </div>
                    <p className="mt-px truncate text-xs text-muted-foreground">{subtitle}</p>
                </div>
            </div>

            {member.status === "pending" ? (
                <span aria-hidden className="hidden md:block" />
            ) : (
                <WorkspaceMemberRoleControls
                    isSelf={isSelf || Boolean(member.is_owner)}
                    member={member}
                    roles={roles}
                />
            )}

            <div className="flex justify-end md:w-20">
                <WorkspaceMemberActions
                    currentUserId={currentUserId}
                    member={member}
                    roles={roles}
                    viewerDefault={viewerDefault}
                />
            </div>
        </div>
    );
}
