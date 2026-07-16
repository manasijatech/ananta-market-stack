import { AccessDeniedState } from "@/components/access/access-denied-state";
import { PageHeader } from "@/components/brokers/ui";
import { AccessSetupNotice } from "@/components/settings/access-setup-notice";
import { BrokerSharingPanel } from "@/components/settings/broker-sharing-panel";
import { RolePermissionsPanel } from "@/components/settings/role-permissions-panel";
import { WorkspaceMemberRow } from "@/components/settings/workspace-member-row";
import { Badge } from "@/components/ui/badge";
import { canManageWorkspaceAccess } from "@/lib/rbac";
import { typography } from "@/lib/typography";
import { getBrokerAccounts } from "@/service/actions/broker";
import { getBrokerAccountGrants, getRbacMe, getWorkspaceMembers, getWorkspaceRoles } from "@/service/actions/rbac";
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
    const pendingMembers = members.filter((member) => member.status === "pending");
    const activeMembers = members.filter((member) => member.status === "active");

    return (
        <>
            <div className="w-full min-w-0 max-w-6xl">
                <PageHeader
                    description="Approve new users, set their role, then share broker accounts only where they need access."
                    title="Access"
                />

                <div className="grid gap-6">
                    <AccessSetupNotice />

                    <section className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="grid gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className={typography.sectionEyebrow}>People</p>
                                    {pendingMembers.length ? (
                                        <Badge size="sm" variant="warning">
                                            {pendingMembers.length} pending
                                        </Badge>
                                    ) : null}
                                </div>
                                <h2 className={typography.sectionTitle}>Approve workspace access</h2>
                                <p className={typography.sectionLead}>
                                    New account requests appear here. Choose a role, then approve.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-[13px] text-muted-foreground">
                                <span>{activeMembers.length} active</span>
                                <span aria-hidden="true">/</span>
                                <span>
                                    {members.length} total member{members.length === 1 ? "" : "s"}
                                </span>
                            </div>
                        </div>

                        <div className="grid overflow-hidden rounded-lg border border-border">
                            {members.length ? (
                                members.map((member: WorkspaceMember) => (
                                    <WorkspaceMemberRow
                                        currentUserId={me.user_id}
                                        key={member.user_id}
                                        member={member}
                                        roles={roles}
                                        viewerDefault={viewerDefault}
                                    />
                                ))
                            ) : (
                                <div className="px-4 py-8 text-sm text-muted-foreground">
                                    No members are waiting for approval.
                                </div>
                            )}
                        </div>

                        <RolePermissionsPanel roles={roles} />
                    </section>

                    <section className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:p-5">
                        <div className="grid gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className={typography.sectionEyebrow}>Broker accounts</p>
                                <Badge size="sm" variant="secondary">
                                    {accounts.length} connected
                                </Badge>
                            </div>
                            <h2 className={typography.sectionTitle}>Share broker accounts</h2>
                            <p className={typography.sectionLead}>
                                Add broker-account access after the person has workspace access.
                            </p>
                        </div>

                        <BrokerSharingPanel accountGrants={accountGrants} members={members} roles={roles} />
                    </section>
                </div>
            </div>
        </>
    );
}
