"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disableWorkspaceMember, removeWorkspaceMember } from "@/service/actions/rbac";
import type { WorkspaceMember } from "@/service/types/rbac";

type WorkspaceMemberActionsProps = {
    currentUserId: string;
    member: WorkspaceMember;
};

export function WorkspaceMemberActions({ currentUserId, member }: WorkspaceMemberActionsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const isSelf = member.user_id === currentUserId;

    function refresh() {
        startTransition(() => {
            router.refresh();
        });
    }

    function onDisable() {
        if (isSelf) {
            return;
        }
        if (!window.confirm(`Disable ${member.email || member.auth_name || "this member"}? They will lose workspace access until re-approved.`)) {
            return;
        }
        startTransition(async () => {
            await disableWorkspaceMember(member.user_id);
            refresh();
        });
    }

    function onRemove() {
        if (isSelf) {
            return;
        }
        if (!window.confirm(`Remove ${member.email || member.auth_name || "this member"} from this workspace?`)) {
            return;
        }
        startTransition(async () => {
            await removeWorkspaceMember(member.user_id);
            refresh();
        });
    }

    if (isSelf) {
        return <span className="text-sm text-muted-foreground">You</span>;
    }

    return (
        <div className="flex flex-wrap items-center justify-end gap-2">
            {member.status !== "disabled" ? (
                <Button disabled={isPending} onClick={onDisable} size="sm" type="button" variant="outline">
                    Disable
                </Button>
            ) : null}
            <Button disabled={isPending} onClick={onRemove} size="sm" type="button" variant="destructive">
                Remove
            </Button>
        </div>
    );
}
