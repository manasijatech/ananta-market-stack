"use client";

import { Button } from "@/components/ui/button";
import {
    SelectContent,
    SelectItem,
    SelectRoot,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import type { RoleDefinition, WorkspaceMember } from "@/service/types/rbac";

type WorkspaceMemberRoleFormProps = {
    action: (formData: FormData) => void | Promise<void>;
    member: WorkspaceMember;
    roles: RoleDefinition[];
    viewerDefault: string;
};

export function WorkspaceMemberRoleForm({
    action,
    member,
    roles,
    viewerDefault
}: WorkspaceMemberRoleFormProps) {
    const selectedRole = member.status === "pending" ? viewerDefault : member.role;

    return (
        <form action={action} className="flex items-center gap-2 md:justify-end">
            <input name="user_id" type="hidden" value={member.user_id} />
            <SelectRoot defaultValue={selectedRole} name="role">
                <SelectTrigger className="w-40">
                    <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                    {roles.map((role) => (
                        <SelectItem key={role.name} value={role.name}>
                            {role.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </SelectRoot>
            <Button className="rounded-[var(--radius)] font-medium normal-case tracking-normal" type="submit">
                {member.status === "pending" ? "Approve" : "Update role"}
            </Button>
        </form>
    );
}
