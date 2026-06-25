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

function roleHasPermission(role: RoleDefinition | undefined, permission: string): boolean {
    return Boolean(role?.permissions.includes(permission));
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
    const adminRole = roles.find((role) => role.name === "admin");
    const viewerRole = roles.find((role) => role.name === "viewer");

    return (
        <Collapsible className="border-y border-border/50" onOpenChange={setOpen} open={open}>
            <CollapsibleTrigger
                className={cn(
                    "flex min-h-10 w-full items-center justify-between gap-3 px-1 text-left",
                    "text-[15px] font-medium text-foreground",
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
                <div className="pb-4 pt-2">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="h-9 text-xs font-medium text-muted-foreground">Feature</TableHead>
                                <TableHead className="h-9 w-24 text-center text-xs font-medium text-muted-foreground">
                                    Admin
                                </TableHead>
                                <TableHead className="h-9 w-24 text-center text-xs font-medium text-muted-foreground">
                                    Viewer
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {featureRows.map(({ permission, label }) => (
                                <TableRow key={permission}>
                                    <TableCell className="py-2.5 text-[13px] text-foreground">{label}</TableCell>
                                    <TableCell className="py-2.5 text-center">
                                        <PermissionCell allowed={roleHasPermission(adminRole, permission)} />
                                    </TableCell>
                                    <TableCell className="py-2.5 text-center">
                                        <PermissionCell allowed={roleHasPermission(viewerRole, permission)} />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CollapsiblePanel>
        </Collapsible>
    );
}
