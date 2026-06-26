"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipPopup,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { approveWorkspaceMember, updateWorkspaceMemberRole } from "@/service/actions/rbac";
import type { RoleDefinition, WorkspaceMember } from "@/service/types/rbac";
import { memberLabel } from "@/components/settings/workspace-member-utils";
import { cn } from "@/lib/utils";

type WorkspaceMemberRoleControlsProps = {
    member: WorkspaceMember;
    roles: RoleDefinition[];
    viewerDefault: string;
    isSelf: boolean;
};

export function WorkspaceMemberRoleControls({
    member,
    roles,
    viewerDefault,
    isSelf
}: WorkspaceMemberRoleControlsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const savedRole = member.status === "pending" ? viewerDefault : member.role;
    const [draftRole, setDraftRole] = useState(savedRole);
    const hasChanges = draftRole !== savedRole;

    useEffect(() => {
        setDraftRole(savedRole);
    }, [savedRole]);

    function onCancel() {
        setDraftRole(savedRole);
    }

    function onSave() {
        startTransition(async () => {
            try {
                if (member.status === "pending") {
                    await approveWorkspaceMember(member.user_id, draftRole);
                    toast.success(`Approved ${memberLabel(member)}`);
                } else {
                    await updateWorkspaceMemberRole(member.user_id, draftRole);
                    toast.success(`Role updated for ${memberLabel(member)}`);
                }
                router.refresh();
            } catch {
                toast.error("Could not update role. Try again.");
            }
        });
    }

    const select = (
        <Select
            disabled={isSelf || isPending}
            onValueChange={(value) => {
                if (value) {
                    setDraftRole(value);
                }
            }}
            value={draftRole}
        >
            <SelectTrigger className="h-8 w-[140px] text-sm">
                <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
                {roles.map((role) => (
                    <SelectItem key={role.name} value={role.name}>
                        {role.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );

    return (
        <div className="contents">
            <div className="flex w-[140px] flex-col gap-1">
                {isSelf ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger
                                render={<span className="inline-flex w-[140px]">{select}</span>}
                            />
                            <TooltipPopup>You can&apos;t change your own role</TooltipPopup>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    select
                )}
                {isSelf ? (
                    <p className="text-[11px] text-muted-foreground">You can&apos;t change your own role</p>
                ) : null}
            </div>

            <div className="flex w-[120px] items-center">
                {!isSelf && hasChanges ? (
                    <div className="flex items-center gap-2">
                        <button
                            className={cn(
                                "text-[13px] font-medium text-primary underline-offset-4 hover:underline",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isPending && "pointer-events-none opacity-40"
                            )}
                            disabled={isPending}
                            onClick={onSave}
                            type="button"
                        >
                            {member.status === "pending" ? "Approve" : "Save"}
                        </button>
                        <button
                            className={cn(
                                "text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isPending && "pointer-events-none opacity-40"
                            )}
                            disabled={isPending}
                            onClick={onCancel}
                            type="button"
                        >
                            Cancel
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
