import Link from "next/link";
import { AccessDeniedState } from "@/components/access/access-denied-state";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { BrokerSharingPanel } from "@/components/settings/broker-sharing-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageWorkspaceAccess } from "@/lib/rbac";
import { getBrokerAccounts } from "@/service/actions/broker";
import {
    approveWorkspaceMember,
    disableWorkspaceMember,
    getBrokerAccountGrants,
    getRbacMe,
    getWorkspaceMembers,
    getWorkspaceRoles,
    updateWorkspaceMemberRole
} from "@/service/actions/rbac";
import type { BrokerAccount } from "@/service/types/broker";
import type { BrokerAccountGrant, RoleDefinition, WorkspaceMember } from "@/service/types/rbac";

function memberLabel(member: WorkspaceMember): string {
    return member.display_name || member.auth_name || member.email || "Name missing";
}

function memberSubtitle(member: WorkspaceMember): string {
    const details = [member.email, member.status, member.role].filter(Boolean);
    if (details.length) {
        return details.join(" · ");
    }
    return "Ask this user to add a name during signup.";
}

function memberInitials(member: WorkspaceMember): string {
    const label = memberLabel(member);
    const parts = label.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return label.slice(0, 2).toUpperCase();
}

function sentenceCase(value: string): string {
    if (!value) {
        return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

const workspaceCapabilityLabels: Record<string, string> = {
    "workspace.manage_members": "Approve members and assign roles",
    "settings.manage_alpha": "Manage the shared Manasija Alpha API key",
    "settings.manage_llm": "Manage shared LLM provider keys and saved models",
    "settings.manage_mcp": "Manage shared MCP servers and authentication",
    "settings.view_llm_usage": "Open the LLM usage dashboard",
    "settings.use_mcp": "Use the shared MCP servers in broker chat",
    "alerts.manage": "Create and manage alerts",
    "alerts.view": "View alerts workspace",
    "watchlists.manage": "Manage watchlists",
    "watchlists.view": "View watchlists"
};

function workspaceCapabilitySummary(role: RoleDefinition): string[] {
    return role.permissions
        .filter((permission) => permission in workspaceCapabilityLabels)
        .map((permission) => workspaceCapabilityLabels[permission])
        .sort((left, right) => left.localeCompare(right));
}

async function approveMemberAction(formData: FormData) {
    "use server";
    await approveWorkspaceMember(String(formData.get("user_id") ?? ""), String(formData.get("role") ?? "viewer"));
}

async function updateRoleAction(formData: FormData) {
    "use server";
    await updateWorkspaceMemberRole(String(formData.get("user_id") ?? ""), String(formData.get("role") ?? "viewer"));
}

async function disableMemberAction(formData: FormData) {
    "use server";
    await disableWorkspaceMember(String(formData.get("user_id") ?? ""));
}

type AccountWithGrants = {
    account: BrokerAccount;
    grants: BrokerAccountGrant[];
};

async function loadAccountGrants(accounts: BrokerAccount[]): Promise<AccountWithGrants[]> {
    const grants = await Promise.all(accounts.map((account) => getBrokerAccountGrants(account.id)));
    return accounts.map((account, index) => ({ account, grants: grants[index] ?? [] }));
}

export default async function AccessSettingsPage() {
    const me = await getRbacMe();
    if (!canManageWorkspaceAccess(me)) {
        return (
            <AccessDeniedState
                title="Workspace access settings"
                description="Approve members, assign roles, and manage broker sharing from this page."
                reason="Your current role does not include workspace access management."
                backHref="/settings"
                backLabel="Go to settings"
            />
        );
    }

    const [members, roles, accounts] = await Promise.all([
        getWorkspaceMembers(),
        getWorkspaceRoles(),
        getBrokerAccounts()
    ]);
    const accountGrants = await loadAccountGrants(accounts);
    const viewerDefault = roles.find((role) => role.name === "viewer")?.name ?? roles[0]?.name ?? "viewer";

    return (
        <Shell>
            <div className="grid w-full max-w-5xl min-w-0 gap-8">
                <PageHeader
                    eyebrow="Workspace access"
                    title="Access and broker sharing"
                    description="Approve people, assign clear roles, and share broker accounts without exposing raw ids or reconnecting credentials."
                />

                <Alert variant="warning">
                    <AlertTitle>Shared workspace setup lives in Settings and LLM Usage</AlertTitle>
                    <AlertDescription>
                        Admins configure the shared Alpha API key in <Link className="underline" href="/settings#alpha">Settings → Alpha</Link>, shared LLM providers in{" "}
                        <Link className="underline" href="/settings#llm">Settings → LLM</Link>, shared MCP servers in{" "}
                        <Link className="underline" href="/settings#mcp">Settings → MCP</Link>, and usage visibility through the{" "}
                        <Link className="underline" href="/llm-usage">LLM Usage</Link> page. Role changes below control who can open or use those shared features.
                    </AlertDescription>
                </Alert>

                <section className="grid gap-4 border border-border bg-card p-5">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="type-step-eyebrow">Members</p>
                            <h2 className="mt-2 text-2xl font-semibold">Who can use this workspace</h2>
                            <p className="mt-2 text-sm text-muted-foreground">
                                Use roles for general access first, then add broker-account grants only where you need tighter control.
                            </p>
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {members.length} member{members.length === 1 ? "" : "s"} in this workspace
                        </div>
                    </div>

                    <div className="grid">
                        {members.map((member) => (
                            <div
                                className="grid gap-3 border-t border-border py-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center"
                                key={member.user_id}
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#E6E6E6] text-sm font-medium text-[#4A4540] dark:bg-[#2A2A2A] dark:text-[#B8B8B8]">
                                        {memberInitials(member)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                            <div className="truncate font-semibold">{memberLabel(member)}</div>
                                            <span className="rounded-[10px] bg-[#EAF3DE] px-2 py-1 text-xs font-medium tracking-normal text-[#3B6D11]">
                                                {sentenceCase(member.status)}
                                            </span>
                                            <span className="rounded-[10px] bg-[#FAEEDA] px-2 py-1 text-xs font-medium tracking-normal text-[#854F0B]">
                                                {sentenceCase(roles.find((role) => role.name === member.role)?.label ?? member.role)}
                                            </span>
                                        </div>
                                        <div className="text-sm text-muted-foreground">{member.email || memberSubtitle(member)}</div>
                                    </div>
                                </div>

                                <form action={member.status === "pending" ? approveMemberAction : updateRoleAction} className="flex flex-wrap gap-2 lg:justify-end">
                                    <input name="user_id" type="hidden" value={member.user_id} />
                                    <select
                                        className="h-10 min-w-40 border border-border bg-background px-3 py-2 text-sm"
                                        name="role"
                                        defaultValue={member.status === "pending" ? viewerDefault : member.role}
                                    >
                                        {roles.map((role) => (
                                            <option key={role.name} value={role.name}>
                                                {role.label}
                                            </option>
                                        ))}
                                    </select>
                                    <Button className="rounded-[var(--radius)] font-medium normal-case tracking-normal" type="submit">
                                        {member.status === "pending" ? "Approve" : "Update role"}
                                    </Button>
                                </form>

                                <form action={disableMemberAction} className="lg:justify-self-end">
                                    <input name="user_id" type="hidden" value={member.user_id} />
                                    <Button
                                        className="border-none bg-transparent font-medium normal-case tracking-normal text-[color:var(--color-text-tertiary,var(--text-muted))] hover:bg-[#FCEBEB] hover:text-[#A32D2D]"
                                        disabled={member.user_id === me.user_id}
                                        type="submit"
                                        variant="ghost"
                                    >
                                        Disable
                                    </Button>
                                </form>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="border border-border bg-card p-5">
                    <details>
                        <summary className="cursor-pointer text-2xl font-semibold marker:content-['']">
                            <span className="mr-2 text-muted-foreground">▸</span>What each role can do
                        </summary>
                        <div className="mt-4 grid gap-4">
                            <div>
                                <p className="type-step-eyebrow">Workspace capabilities</p>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    These role capabilities control shared setup areas like Alpha, LLM providers, MCP, and the LLM usage dashboard. Existing users are reconciled automatically when roles or workspace defaults change.
                                </p>
                            </div>

                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Role name</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead>Capabilities</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {roles.map((role) => {
                                        const capabilities = workspaceCapabilitySummary(role);
                                        return (
                                            <TableRow key={role.name}>
                                                <TableCell className="font-semibold">{role.label}</TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {role.name === "admin"
                                                        ? "Full workspace setup and access control."
                                                        : role.name === "operator"
                                                          ? "Uses the shared workspace setup and can open the LLM usage dashboard."
                                                          : role.name === "viewer"
                                                            ? "Consumes granted broker data without shared setup access."
                                                            : "Role-specific capability set."}
                                                </TableCell>
                                                <TableCell>
                                                    {capabilities.length ? (
                                                        <span>{capabilities.join(", ")}</span>
                                                    ) : (
                                                        <span className="text-muted-foreground">No workspace-level capabilities assigned.</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </details>
                </section>

                <section className="grid gap-4 border border-border bg-card p-5">
                    <div>
                        <p className="type-step-eyebrow">Broker accounts</p>
                        <h2 className="mt-2 text-2xl font-semibold">Share specific accounts</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Pick a person or a role from the list below, then choose exactly what they can do on that broker account.
                        </p>
                    </div>

                    <BrokerSharingPanel accountGrants={accountGrants} members={members} roles={roles} />
                </section>
            </div>
        </Shell>
    );
}
