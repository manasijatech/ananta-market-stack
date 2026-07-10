"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconBan, IconDotsVertical, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
    Menu,
    MenuItem,
    MenuPopup,
    MenuTrigger
} from "@/components/ui/menu";
import { disableWorkspaceMember, removeWorkspaceMember } from "@/service/actions/rbac";
import type { WorkspaceMember } from "@/service/types/rbac";
import { cn } from "@/lib/utils";

type WorkspaceMemberActionsProps = {
    currentUserId: string;
    member: WorkspaceMember;
};

export function WorkspaceMemberActions({ currentUserId, member }: WorkspaceMemberActionsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const isSelf = member.user_id === currentUserId;

    if (isSelf) {
        return <span aria-hidden className="size-8" />;
    }

    function refresh() {
        startTransition(() => {
            router.refresh();
        });
    }

    function onDisable() {
        if (
            !window.confirm(
                `Disable ${member.email || member.auth_name || "this member"}? They will lose workspace access until re-approved.`
            )
        ) {
            return;
        }
        startTransition(async () => {
            await disableWorkspaceMember(member.user_id);
            refresh();
        });
    }

    function onRemove() {
        if (!window.confirm(`Remove ${member.email || member.auth_name || "this member"} from this workspace?`)) {
            return;
        }
        startTransition(async () => {
            await removeWorkspaceMember(member.user_id);
            refresh();
        });
    }

    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button
                        aria-label="Member actions"
                        className="size-8"
                        disabled={isPending}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                    >
                        <IconDotsVertical className="size-4" />
                    </Button>
                }
            />
            <MenuPopup align="end" className="min-w-48">
                {member.status !== "disabled" ? (
                    <MenuItem
                        className="text-warning-foreground focus:text-warning-foreground"
                        closeOnClick
                        disabled={isPending}
                        onClick={onDisable}
                    >
                        <IconBan className={cn("size-4 text-warning-foreground")} />
                        Disable account
                    </MenuItem>
                ) : null}
                <MenuItem closeOnClick disabled={isPending} onClick={onRemove} variant="destructive">
                    <IconTrash className="size-4" />
                    Remove from workspace
                </MenuItem>
            </MenuPopup>
        </Menu>
    );
}
