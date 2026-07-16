import { AccessDeniedState } from "@/components/access/access-denied-state";
import { PageHeader } from "@/components/brokers/ui";
import { AccessSetupNotice } from "@/components/settings/access-setup-notice";
import { BrokerSharingPanel } from "@/components/settings/broker-sharing-panel";
import { WorkspaceMembersLivePanel } from "@/components/settings/workspace-members-live-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { canManageWorkspaceAccess } from "@/lib/rbac";
import { typography } from "@/lib/typography";
import { getBrokerAccounts } from "@/service/actions/broker";
import { getBrokerAccountGrants, getRbacMe, getWorkspaceMembers, getWorkspaceRoles } from "@/service/actions/rbac";
import type { BrokerAccount } from "@/service/types/broker";
import type { BrokerAccountGrant } from "@/service/types/rbac";

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
    const assignableRoles = roles.filter((role) => ["admin", "operator", "viewer"].includes(role.name));
    const viewerDefault = assignableRoles.find((role) => role.name === "viewer")?.name ?? assignableRoles[0]?.name ?? "viewer";

    return (
        <>
            <div className="w-full min-w-0 max-w-6xl">
                <PageHeader
                    description="Approve new users, set their role, then share broker accounts only where they need access."
                    title="Access"
                />

                <div className="grid gap-5">
                    <AccessSetupNotice />

                    <WorkspaceMembersLivePanel
                        currentUserId={me.user_id}
                        initialMembers={members}
                        roles={assignableRoles}
                        viewerDefault={viewerDefault}
                    />

                    <Card>
                        <CardHeader>
                            <div className="flex flex-wrap items-center gap-2">
                                <p className={typography.sectionEyebrow}>Broker accounts</p>
                                <Badge size="sm" variant="secondary">
                                    {accounts.length} connected
                                </Badge>
                            </div>
                            <CardTitle className={typography.sectionTitle}>Share broker accounts</CardTitle>
                            <CardDescription className={typography.sectionLead}>
                                Add broker-account access after the person has workspace access.
                            </CardDescription>
                        </CardHeader>
                        <CardPanel>
                            <BrokerSharingPanel accountGrants={accountGrants} members={members} roles={roles} />
                        </CardPanel>
                    </Card>
                </div>
            </div>
        </>
    );
}
