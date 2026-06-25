import { AccessDeniedState } from "@/components/access/access-denied-state";
import { Shell } from "@/components/brokers/shell";
import { AccessSetupNotice } from "@/components/settings/access-setup-notice";
import { BrokerSharingPanel } from "@/components/settings/broker-sharing-panel";
import { RolePermissionsPanel } from "@/components/settings/role-permissions-panel";
import { WorkspaceMemberRow } from "@/components/settings/workspace-member-row";
import { Badge } from "@/components/ui/badge";
import { canManageWorkspaceAccess } from "@/lib/rbac";
import { getBrokerAccounts } from "@/service/actions/broker";
import {
    getBrokerAccountGrants,
    getRbacMe,
    getWorkspaceMembers,
    getWorkspaceRoles
} from "@/service/actions/rbac";
import type { BrokerAccount } from "@/service/types/broker";
import type { BrokerAccountGrant, WorkspaceMember } from "@/service/types/rbac";

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
            <div className="w-full min-w-0">
                <header className="mb-6 border-b border-border pb-5">
                    <p className="mb-3 text-xs text-muted-foreground">Workspace access</p>
                    <h1 className="text-[22px] font-medium text-foreground">Access and broker sharing</h1>
                    <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">
                        Approve people, assign clear roles, and share broker accounts without exposing raw ids or
                        reconnecting credentials.
                    </p>
                </header>

                <div>
                    <AccessSetupNotice />

                    <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
                        <section className="grid gap-4 rounded-md bg-card p-5">
                            <div className="grid gap-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                                    Broker accounts
                                </p>
                                <h2 className="text-[15px] font-medium text-foreground">Share specific accounts</h2>
                                <p className="text-[13px] text-muted-foreground">
                                    Pick a person or a role from the list below, then choose exactly what they can do on
                                    that broker account.
                                </p>
                            </div>

                            <BrokerSharingPanel accountGrants={accountGrants} members={members} roles={roles} />
                        </section>

                        <section className="grid gap-4 rounded-md bg-card p-5">
                            <div className="grid gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                                        Members
                                    </p>
                                    <Badge size="sm" variant="secondary">
                                        {members.length} member{members.length === 1 ? "" : "s"}
                                    </Badge>
                                </div>
                                <h2 className="text-[15px] font-medium text-foreground">Who can use this workspace</h2>
                                <p className="text-[13px] text-muted-foreground">
                                    Use roles for general access first, then add broker-account grants only where you
                                    need tighter control.
                                </p>
                            </div>

                            <div className="grid rounded-md bg-card">
                                {members.map((member: WorkspaceMember) => (
                                    <WorkspaceMemberRow
                                        currentUserId={me.user_id}
                                        key={member.user_id}
                                        member={member}
                                        roles={roles}
                                        viewerDefault={viewerDefault}
                                    />
                                ))}
                            </div>

                            <RolePermissionsPanel roles={roles} />
                        </section>
                    </div>
                </div>
            </div>
        </Shell>
    );
}
