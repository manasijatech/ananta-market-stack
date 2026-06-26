"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseActionError } from "@/components/brokers/action-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger
} from "@/components/ui/select";
import { upsertBrokerAccountGrant } from "@/service/actions/rbac";
import type { BrokerAccountGrant, RoleDefinition, WorkspaceMember } from "@/service/types/rbac";

const brokerPermissions = [
    "broker.view",
    "broker.use_data",
    "broker.manage_sessions",
    "broker.manage_credentials",
    "broker.delete"
] as const;

const defaultPermissions = ["broker.view", "broker.use_data"];

type BrokerPermission = (typeof brokerPermissions)[number];

type SubjectOption = {
    key: string;
    subjectType: "user" | "role";
    subjectId: string;
    label: string;
    subtitle?: string;
    group: "People" | "Role defaults";
    isAdmin: boolean;
};

function memberLabel(member: WorkspaceMember): string {
    return member.display_name || member.auth_name || member.email || "Unnamed member";
}

function permissionLabel(permission: BrokerPermission): string {
    if (permission === "broker.view") return "View account";
    if (permission === "broker.use_data") return "Use portfolio and market data";
    if (permission === "broker.manage_sessions") return "Refresh sessions";
    if (permission === "broker.manage_credentials") return "Edit credentials";
    return "Delete account";
}

function permissionSummary(permissions: string[]): string {
    if (!permissions.length) {
        return "No access saved yet";
    }
    return permissions
        .map((permission) => permissionLabel(permission as BrokerPermission))
        .join(", ");
}

function subjectSelectLabel(option?: SubjectOption): string {
    if (!option) {
        return "";
    }
    if (option.subtitle && option.group === "People") {
        return `${option.label} - ${option.subtitle}`;
    }
    return option.label;
}

function normalizePermissions(permissions: string[], isAdmin: boolean): string[] {
    if (isAdmin) {
        return [...brokerPermissions];
    }
    return brokerPermissions.filter((permission) => permissions.includes(permission));
}

function buildSubjectOptions(members: WorkspaceMember[], roles: RoleDefinition[]): SubjectOption[] {
    const people = members
        .filter((member) => member.status !== "disabled")
        .map((member) => ({
            key: `user:${member.user_id}`,
            subjectType: "user" as const,
            subjectId: member.user_id,
            label: memberLabel(member),
            subtitle: member.email ?? undefined,
            group: "People" as const,
            isAdmin: member.status === "active" && member.role === "admin"
        }));
    const roleDefaults = roles.map((role) => ({
        key: `role:${role.name}`,
        subjectType: "role" as const,
        subjectId: role.name,
        label: role.label,
        subtitle: role.name === "admin" ? "Admins always keep full broker access." : "Role default",
        group: "Role defaults" as const,
        isAdmin: role.name === "admin"
    }));
    return [...people, ...roleDefaults];
}

export function AccessGrantEditor({
    accountId,
    grants,
    members,
    roles,
    initialSubjectKey
}: {
    accountId: string;
    grants: BrokerAccountGrant[];
    members: WorkspaceMember[];
    roles: RoleDefinition[];
    initialSubjectKey?: string;
}) {
    const router = useRouter();
    const [message, setMessage] = useState("");
    const [isPending, startTransition] = useTransition();
    const subjectOptions = useMemo(() => buildSubjectOptions(members, roles), [members, roles]);
    const grantsByKey = useMemo(
        () => new Map(grants.map((grant) => [`${grant.subject_type}:${grant.subject_id}`, grant])),
        [grants]
    );
    const [selectedKey, setSelectedKey] = useState(initialSubjectKey ?? subjectOptions[0]?.key ?? "");
    const selectedSubject = subjectOptions.find((option) => option.key === selectedKey) ?? subjectOptions[0];
    const selectedGrant = selectedSubject ? grantsByKey.get(selectedSubject.key) : undefined;

    function derivePermissions(subjectKey: string): string[] {
        const option = subjectOptions.find((item) => item.key === subjectKey);
        if (!option) {
            return [];
        }
        const savedGrant = grantsByKey.get(subjectKey);
        if (savedGrant) {
            return normalizePermissions(savedGrant.permissions, option.isAdmin);
        }
        return option.isAdmin ? [...brokerPermissions] : [...defaultPermissions];
    }

    const [selectedPermissions, setSelectedPermissions] = useState<string[]>(derivePermissions(selectedKey));

    useEffect(() => {
        if (initialSubjectKey && initialSubjectKey !== selectedKey) {
            setSelectedKey(initialSubjectKey);
        }
    }, [initialSubjectKey, selectedKey]);

    useEffect(() => {
        const fallbackKey = subjectOptions[0]?.key ?? "";
        if (!selectedSubject && fallbackKey !== selectedKey) {
            setSelectedKey(fallbackKey);
            return;
        }
        setSelectedPermissions(derivePermissions(selectedSubject?.key ?? fallbackKey));
    }, [grantsByKey, selectedKey, selectedSubject, subjectOptions]);

    function togglePermission(permission: BrokerPermission, checked: boolean) {
        if (selectedSubject?.isAdmin) {
            return;
        }
        setSelectedPermissions((current) => {
            if (checked) {
                return brokerPermissions.filter((item) => current.includes(item) || item === permission);
            }
            return current.filter((item) => item !== permission);
        });
    }

    function saveGrant() {
        if (!selectedSubject) {
            return;
        }
        setMessage("");
        startTransition(async () => {
            try {
                await upsertBrokerAccountGrant({
                    accountId,
                    subjectType: selectedSubject.subjectType,
                    subjectId: selectedSubject.subjectId,
                    permissions: normalizePermissions(selectedPermissions, selectedSubject.isAdmin)
                });
                setMessage("Access grant saved.");
                router.refresh();
            } catch (error) {
                setMessage(parseActionError(error).message);
            }
        });
    }

    const effectivePermissions = normalizePermissions(selectedPermissions, selectedSubject?.isAdmin ?? false);

    return (
        <div className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid gap-2">
                    <label className="text-sm font-semibold" htmlFor={`subject-${accountId}`}>
                        Grant access to
                    </label>
                    <Select onValueChange={(value) => setSelectedKey(value ?? "")} value={selectedSubject?.key ?? ""}>
                        <SelectTrigger id={`subject-${accountId}`}>
                            <span className="min-w-0 truncate">
                                {subjectSelectLabel(selectedSubject) || "Select person or role"}
                            </span>
                        </SelectTrigger>
                        <SelectContent>
                            {(["People", "Role defaults"] as const).map((group) => {
                                const options = subjectOptions.filter((option) => option.group === group);
                                if (!options.length) {
                                    return null;
                                }
                                return (
                                    <SelectGroup key={group}>
                                        <SelectLabel>{group}</SelectLabel>
                                        {options.map((option) => (
                                            <SelectItem key={option.key} value={option.key}>
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate">{option.label}</span>
                                                    {option.subtitle && option.group === "People" ? (
                                                        <span className="truncate text-xs text-muted-foreground group-data-[highlighted]:text-primary-foreground/80">
                                                            {option.subtitle}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                );
                            })}
                        </SelectContent>
                    </Select>
                    {selectedSubject?.subtitle ? (
                        <div className="text-sm text-muted-foreground">{selectedSubject.subtitle}</div>
                    ) : null}
                </div>
                <div className="grid gap-2">
                    <div className="text-sm font-semibold">Saved access for this selection</div>
                    <div className="border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                        {selectedGrant
                            ? permissionSummary(normalizePermissions(selectedGrant.permissions, selectedSubject?.isAdmin ?? false))
                            : permissionSummary(effectivePermissions)}
                    </div>
                </div>
            </div>

            {selectedSubject?.isAdmin ? (
                <Alert>
                    <AlertDescription>
                        Admins always keep full broker access. All permissions stay enabled for this selection.
                    </AlertDescription>
                </Alert>
            ) : (
                <div className="text-sm text-muted-foreground">
                    Start with `View account` and `Use portfolio and market data`, then add session or credential access only when needed.
                </div>
            )}

            <div className="grid gap-3">
                {brokerPermissions.map((permission) => {
                    const checked = effectivePermissions.includes(permission);
                    return (
                        <label className="flex items-center gap-3" key={permission}>
                            <Checkbox
                                checked={checked}
                                disabled={isPending || selectedSubject?.isAdmin}
                                onCheckedChange={(value) => togglePermission(permission, value === true)}
                            />
                            <span className="text-sm font-semibold">{permissionLabel(permission)}</span>
                        </label>
                    );
                })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Button disabled={isPending || !selectedSubject} onClick={saveGrant} type="button">
                    {isPending ? "Saving..." : "Save access grant"}
                </Button>
                {message ? <div className="text-sm text-muted-foreground">{message}</div> : null}
            </div>
        </div>
    );
}
