import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import { getBrokerAccounts } from "@/service/actions/broker";
import {
    approveWorkspaceMember,
    disableWorkspaceMember,
    getRbacMe,
    getWorkspaceMembers,
    getWorkspaceRoles,
    updateWorkspaceMemberRole,
    upsertBrokerAccountGrant
} from "@/service/actions/rbac";

const brokerPermissions = [
    "broker.view",
    "broker.use_data",
    "broker.manage_sessions",
    "broker.manage_credentials",
    "broker.delete"
];

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

async function grantBrokerAccessAction(formData: FormData) {
    "use server";
    const permissions = brokerPermissions.filter((permission) => formData.get(permission) === "on");
    await upsertBrokerAccountGrant({
        accountId: String(formData.get("account_id") ?? ""),
        subjectType: String(formData.get("subject_type") ?? "user") as "user" | "role",
        subjectId: String(formData.get("subject_id") ?? ""),
        permissions
    });
}

export default async function AccessSettingsPage() {
    const me = await getRbacMe();
    if (!me.is_admin) {
        redirect("/dashboard");
    }
    const [members, roles, accounts] = await Promise.all([
        getWorkspaceMembers(),
        getWorkspaceRoles(),
        getBrokerAccounts()
    ]);

    return (
        <Shell>
            <PageHeader
                eyebrow="Workspace access"
                title="Members and broker grants"
                description="Approve users, assign roles, and share broker accounts without reconnecting credentials."
                action={
                    <Button asChild variant="secondary">
                        <Link href="/settings">Back to Settings</Link>
                    </Button>
                }
            />

            <section className="grid gap-4 border border-border bg-card p-5">
                <div>
                    <p className="type-step-eyebrow">Members</p>
                    <h2 className="mt-2 text-2xl font-semibold">Approval and roles</h2>
                </div>
                <div className="grid gap-3">
                    {members.map((member) => (
                        <div className="grid gap-3 border border-border bg-background p-4 lg:grid-cols-[1fr_auto_auto]" key={member.user_id}>
                            <div>
                                <div className="font-semibold">{member.display_name || member.user_id}</div>
                                <div className="mt-1 text-sm text-muted-foreground">
                                    {member.user_id} · {member.status} · {member.role}
                                </div>
                            </div>
                            <form action={member.status === "pending" ? approveMemberAction : updateRoleAction} className="flex gap-2">
                                <input name="user_id" type="hidden" value={member.user_id} />
                                <select className="border border-border bg-background px-3 py-2 text-sm" name="role" defaultValue={member.role === "pending" ? "viewer" : member.role}>
                                    {roles.map((role) => (
                                        <option key={role.name} value={role.name}>
                                            {role.label || role.name}
                                        </option>
                                    ))}
                                </select>
                                <Button type="submit">{member.status === "pending" ? "Approve" : "Update"}</Button>
                            </form>
                            <form action={disableMemberAction}>
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
                    <h2 className="mt-2 text-2xl font-semibold">Grant account access</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Grant to a user id for precise access, or to a role such as viewer/operator for account-level defaults.
                    </p>
                </div>
                <div className="grid gap-3">
                    {accounts.map((account) => (
                        <form action={grantBrokerAccessAction} className="grid gap-3 border border-border bg-background p-4" key={account.id}>
                            <input name="account_id" type="hidden" value={account.id} />
                            <div>
                                <div className="font-semibold">
                                    {account.label} · {account.broker_code}
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">{account.id}</div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-[160px_1fr]">
                                <select className="border border-border bg-background px-3 py-2 text-sm" name="subject_type" defaultValue="user">
                                    <option value="user">User</option>
                                    <option value="role">Role</option>
                                </select>
                                <input
                                    className="border border-border bg-background px-3 py-2 text-sm"
                                    name="subject_id"
                                    placeholder="User id or role name"
                                    required
                                />
                            </div>
                            <div className="flex flex-wrap gap-3 text-sm">
                                {brokerPermissions.map((permission) => (
                                    <label className="flex items-center gap-2" key={permission}>
                                        <input defaultChecked={permission === "broker.view" || permission === "broker.use_data"} name={permission} type="checkbox" />
                                        {permission}
                                    </label>
                                ))}
                            </div>
                            <Button className="w-fit" type="submit">
                                Save grant
                            </Button>
                        </form>
                    ))}
                </div>
            </section>
        </Shell>
    );
}
