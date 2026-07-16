"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query-keys";
import { updateWorkspaceMemberRole } from "@/service/actions/rbac";
import type { RoleDefinition, WorkspaceMember } from "@/service/types/rbac";
import { memberLabel, roleDisplayLabel } from "@/components/settings/workspace-member-utils";

type WorkspaceMemberRoleControlsProps = {
    member: WorkspaceMember;
    roles: RoleDefinition[];
    isSelf: boolean;
};

export function WorkspaceMemberRoleControls({
    member,
    roles,
    isSelf
}: WorkspaceMemberRoleControlsProps) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const [isPending, startTransition] = useTransition();
    const savedRole = member.role;
    const [draftRole, setDraftRole] = useState(savedRole);
    const hasChanges = draftRole !== savedRole;
    const assignableRoles = roles.filter((role) => ["admin", "operator", "viewer"].includes(role.name));

    useEffect(() => {
        setDraftRole(savedRole);
    }, [savedRole]);

    function onCancel() {
        setDraftRole(savedRole);
    }

    function onSave() {
        startTransition(async () => {
            try {
                await updateWorkspaceMemberRole(member.user_id, draftRole);
                toast.success(`Role updated for ${memberLabel(member)}`);
                void queryClient.invalidateQueries({ queryKey: queryKeys.access.members() });
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
            <SelectTrigger className="h-8 w-full min-w-0 text-sm md:w-[180px]">
                <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
                {assignableRoles.map((role) => (
                    <SelectItem key={role.name} value={role.name}>
                        {roleDisplayLabel(role.name, role.label)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );

    return (
        <div className="flex min-w-0 flex-col gap-2 md:items-start">
            <div className="flex w-full min-w-0 flex-col gap-1 md:w-[180px]">
                {isSelf ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger
                                render={<span className="inline-flex w-full md:w-[180px]">{select}</span>}
                            />
                            <TooltipPopup>You can&apos;t change your own role</TooltipPopup>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    select
                )}
            </div>

            <div className="flex min-h-0 w-full items-center md:w-[180px] md:justify-start">
                {!isSelf && hasChanges ? (
                    <div className="flex items-center gap-2">
                        <Button disabled={isPending} loading={isPending} onClick={onSave} size="xs" type="button">
                            Save
                        </Button>
                        <Button disabled={isPending} onClick={onCancel} size="xs" type="button" variant="ghost">
                            Cancel
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
