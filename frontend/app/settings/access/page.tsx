import Link from "next/link";
import { AccessDeniedState } from "@/components/access/access-denied-state";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { AccessGrantEditor } from "@/components/settings/access-grant-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import type { BrokerAccountGrant, WorkspaceMember } from "@/service/types/rbac";

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

function permissionLabel(permission: string): string {
    if (permission === "broker.view") return "View account";
    if (permission === "broker.use_data") return "Use portfolio and market data";
    if (permission === "broker.manage_sessions") return "Refresh sessions";
    if (permission === "broker.manage_credentials") return "Edit credentials";
    return "Delete account";
}

function permissionSummary(grant: BrokerAccountGrant): string {
    if (!grant.permissions.length) {
        return "No access";
    }
    return grant.permissions.map((permission) => permissionLabel(permission)).join(", ");
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
            <PageHeader
                eyebrow="Workspace access"
                title="Access and broker sharing"
                description="Approve people, assign clear roles, and share broker accounts without exposing raw ids or reconnecting credentials."
                action={
                    <Button asChild variant="secondary">
                        <Link href="/settings">Back to Settings</Link>
                    </Button>
                }
            />

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

                <div className="grid gap-3">
                    {members.map((member) => (
                        <div className="grid gap-4 border border-border bg-background p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]" key={member.user_id}>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="truncate text-lg font-semibold">{memberLabel(member)}</div>
                                    <span className="border border-border px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        {member.status}
                                    </span>
                                    <span className="border border-border px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        {roles.find((role) => role.name === member.role)?.label ?? member.role}
                                    </span>
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">{memberSubtitle(member)}</div>
                                {!member.display_name && !member.auth_name ? (
                                    <div className="mt-3 text-sm text-amber-700">
                                        This member does not have a readable name yet. Ask them to use the name field when creating their account.
                                    </div>
                                ) : null}
                            </div>

                            <form action={member.status === "pending" ? approveMemberAction : updateRoleAction} className="flex flex-wrap gap-2 lg:justify-end">
                                <input name="user_id" type="hidden" value={member.user_id} />
                                <select
                                    className="min-w-40 border border-border bg-background px-3 py-2 text-sm"
                                    name="role"
                                    defaultValue={member.status === "pending" ? viewerDefault : member.role}
                                >
                                    {roles.map((role) => (
                                        <option key={role.name} value={role.name}>
                                            {role.label}
                                        </option>
                                    ))}
                                </select>
                                <Button type="submit">{member.status === "pending" ? "Approve" : "Update role"}</Button>
                            </form>

                            <form action={disableMemberAction} className="lg:justify-self-end">
                                <input name="user_id" type="hidden" value={member.user_id} />
                                <Button disabled={member.user_id === me.user_id} type="submit" variant="secondary">
                                    Disable
                                </Button>
                            </form>
                        </div>
                    ))}
                </div>
            </section>

            <section className="mt-6 grid gap-4 border border-border bg-card p-5">
                <div>
                    <p className="type-step-eyebrow">Broker accounts</p>
                    <h2 className="mt-2 text-2xl font-semibold">Share specific accounts</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Pick a person or a role from the list below, then choose exactly what they can do on that broker account.
                    </p>
                </div>

                <div className="grid gap-4">
                    {accountGrants.map(({ account, grants }) => (
                        <div className="grid gap-4 border border-border bg-background p-4" key={account.id}>
                            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                                <div>
                                    <div className="text-lg font-semibold">
                                        {account.label} · {account.broker_code}
                                    </div>
                                    <div className="mt-1 text-sm text-muted-foreground">
                                        Share this account without exposing credentials or internal identifiers.
                                    </div>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    {grants.length} grant{grants.length === 1 ? "" : "s"} configured
                                </div>
                            </div>

                            {grants.length ? (
                                <div className="grid gap-3">
                                    {grants.map((grant) => (
                                        <div className="border border-border bg-card p-3" key={grant.id}>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-semibold">{grant.subject_label}</span>
                                                <span className="border border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                                    {grant.subject_type === "user" ? "Person" : "Role default"}
                                                </span>
                                            </div>
                                            {grant.subject_subtitle ? (
                                                <div className="mt-1 text-sm text-muted-foreground">{grant.subject_subtitle}</div>
                                            ) : null}
                                            <div className="mt-2 text-sm">{permissionSummary(grant)}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <Alert>
                                    <AlertDescription>No extra grants yet. Only admins can currently use this account.</AlertDescription>
                                </Alert>
                            )}

                            <AccessGrantEditor accountId={account.id} grants={grants} members={members} roles={roles} />
                        </div>
                    ))}
                </div>
            </section>
        </Shell>
    );
}
