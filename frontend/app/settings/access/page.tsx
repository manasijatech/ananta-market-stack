import { AccessDeniedState } from "@/components/access/access-denied-state";
import { PageHeader } from "@/components/brokers/ui";
import { Shell } from "@/components/brokers/shell";
import { AccessSetupNotice } from "@/components/settings/access-setup-notice";
import { BrokerSharingPanel } from "@/components/settings/broker-sharing-panel";
import { RolePermissionsPanel } from "@/components/settings/role-permissions-panel";
import { WorkspaceMemberRow } from "@/components/settings/workspace-member-row";
import { Badge } from "@/components/ui/badge";
import { canManageWorkspaceAccess } from "@/lib/rbac";
import { typography } from "@/lib/typography";
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
                <PageHeader
                    description="Approve people, assign clear roles, and share broker accounts without exposing raw ids or reconnecting credentials."
                    eyebrow="Workspace access"
                    title="Access and broker sharing"
                />

                <div>
                    <AccessSetupNotice />

                    <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
                        <section className="grid gap-4 rounded-lg bg-card p-5">
                            <div className="grid gap-2">
                                <p className={typography.sectionEyebrow}>Broker accounts</p>
                                <h2 className={typography.sectionTitle}>Share specific accounts</h2>
                                <p className={typography.sectionLead}>
                                    Pick a person or a role from the list below, then choose exactly what they can do on
                                    that broker account.
                                </p>
                            </div>

                            <BrokerSharingPanel accountGrants={accountGrants} members={members} roles={roles} />
                        </section>

                        <section className="grid gap-4 rounded-lg bg-card p-5">
                            <div className="grid gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className={typography.sectionEyebrow}>Members</p>
                                    <Badge size="sm" variant="secondary">
                                        {members.length} member{members.length === 1 ? "" : "s"}
                                    </Badge>
                                </div>
                                <h2 className={typography.sectionTitle}>Who can use this workspace</h2>
                                <p className={typography.sectionLead}>
                                    Use roles for general access first, then add broker-account grants only where you
                                    need tighter control.
                                </p>
                            </div>

                            <div className="grid rounded-lg bg-card">
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
