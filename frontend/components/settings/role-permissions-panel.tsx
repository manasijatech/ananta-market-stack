"use client";

import { useState } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import {
    Collapsible,
    CollapsiblePanel,
    CollapsibleTrigger
} from "@/components/ui/collapsible";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import type { RoleDefinition } from "@/service/types/rbac";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";

const workspaceCapabilityLabels: Record<string, string> = {
    "workspace.manage_members": "Approve members and assign roles",
    "settings.manage_alpha": "Manage the shared Drishti API key",
    "settings.manage_llm": "Manage shared LLM provider keys and saved models",
    "settings.manage_mcp": "Manage shared MCP servers and authentication",
    "settings.view_llm_usage": "Open the LLM usage dashboard",
    "settings.use_mcp": "Use the shared MCP servers in broker chat",
    "alerts.manage": "Create and manage alerts",
    "alerts.view": "View alerts workspace",
    "watchlists.manage": "Manage watchlists",
    "watchlists.view": "View watchlists"
};

const featureRows = Object.entries(workspaceCapabilityLabels)
    .map(([permission, label]) => ({ permission, label }))
    .sort((left, right) => left.label.localeCompare(right.label));

function permissionLabel(permission: string): string {
    return (
        workspaceCapabilityLabels[permission] ??
        permission
            .split(".")
            .map((part) => part.replaceAll("_", " "))
            .join(" / ")
    );
}

function roleHasPermission(role: RoleDefinition, permission: string): boolean {
    return role.permissions.includes(permission);
}

function PermissionCell({ allowed }: { allowed: boolean }) {
    if (allowed) {
        return (
            <span className="inline-flex items-center justify-center text-success-foreground">
                <Check aria-label="Allowed" className="size-4" />
            </span>
        );
    }

    return (
        <span className="inline-flex items-center justify-center text-muted-foreground/60">
            <Minus aria-label="Not allowed" className="size-4" />
        </span>
    );
}

export function RolePermissionsPanel({ roles }: { roles: RoleDefinition[] }) {
    const [open, setOpen] = useState(false);
    const permissionRows = Array.from(
        new Set([...featureRows.map((row) => row.permission), ...roles.flatMap((role) => role.permissions)])
    )
        .map((permission) => ({ permission, label: permissionLabel(permission) }))
        .sort((left, right) => left.label.localeCompare(right.label));

    return (
        <Collapsible className="rounded-lg border border-border bg-background" onOpenChange={setOpen} open={open}>
            <CollapsibleTrigger
                className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left",
                    typography.sectionTitle,
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                )}
            >
                Role permissions
                <ChevronDown
                    aria-hidden
                    className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        open && "rotate-180"
                    )}
                />
            </CollapsibleTrigger>
            <CollapsiblePanel>
                <div className="px-4 pb-4">
                    <Table className="min-w-[720px]" variant="card">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="h-9 min-w-72 text-xs font-medium text-muted-foreground">
                                    Permission
                                </TableHead>
                                {roles.map((role) => (
                                    <TableHead
                                        className="h-9 w-28 text-center text-xs font-medium text-muted-foreground"
                                        key={role.name}
                                    >
                                        {role.label}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {permissionRows.map(({ permission, label }) => (
                                <TableRow key={permission}>
                                    <TableCell className="py-2.5 align-top">
                                        <div className="grid gap-1">
                                            <span className="text-[13px] text-foreground">{label}</span>
                                            <span className="font-mono text-[11px] text-muted-foreground">
                                                {permission}
                                            </span>
                                        </div>
                                    </TableCell>
                                    {roles.map((role) => (
                                        <TableCell className="py-2.5 text-center align-top" key={role.name}>
                                            <PermissionCell allowed={roleHasPermission(role, permission)} />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CollapsiblePanel>
        </Collapsible>
    );
}
