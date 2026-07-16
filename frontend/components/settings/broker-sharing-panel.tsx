"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconArrowRight, IconWallet } from "@tabler/icons-react";
import { Pencil } from "lucide-react";
import { AccessGrantEditor } from "@/components/settings/access-grant-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { BrokerAccount } from "@/service/types/broker";
import type { BrokerAccountGrant, RoleDefinition, WorkspaceMember } from "@/service/types/rbac";

type AccountWithGrants = {
    account: BrokerAccount;
    grants: BrokerAccountGrant[];
};

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

function BrokerAccountsEmptyState() {
    return (
        <Empty className="items-start rounded-lg border border-border bg-card px-5 py-8 text-left md:py-10">
            <EmptyHeader className="items-start text-left">
                <EmptyMedia className="mb-3" variant="icon">
                    <IconWallet aria-hidden className="size-6 text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle className="text-sm font-medium">No broker accounts connected</EmptyTitle>
                <EmptyDescription className="text-[13px]">
                    Connect a broker account first, then return here to share access.
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="items-start">
                <Button render={<Link href="/broker-connections" />} variant="ghost">
                    Go to Broker Connections
                    <IconArrowRight aria-hidden className="size-4" />
                </Button>
            </EmptyContent>
        </Empty>
    );
}

export function BrokerSharingPanel({
    accountGrants,
    members,
    roles
}: {
    accountGrants: AccountWithGrants[];
    members: WorkspaceMember[];
    roles: RoleDefinition[];
}) {
    const [selectedAccountId, setSelectedAccountId] = useState(accountGrants[0]?.account.id ?? "");
    const [expandedForm, setExpandedForm] = useState(false);
    const [editingSubjectKey, setEditingSubjectKey] = useState<string | undefined>();
    const selected = useMemo(
        () => accountGrants.find(({ account }) => account.id === selectedAccountId) ?? accountGrants[0],
        [accountGrants, selectedAccountId]
    );

    if (!selected) {
        return <BrokerAccountsEmptyState />;
    }

    function openAddGrant() {
        setEditingSubjectKey(undefined);
        setExpandedForm((current) => !current || Boolean(editingSubjectKey));
    }

    function openEditGrant(grant: BrokerAccountGrant) {
        setEditingSubjectKey(`${grant.subject_type}:${grant.subject_id}`);
        setExpandedForm(true);
    }

    return (
        <div className="grid overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="max-h-[520px] overflow-y-auto border-b border-border lg:border-r lg:border-b-0">
                {accountGrants.map(({ account, grants }) => {
                    const selectedAccount = account.id === selected.account.id;
                    return (
                        <button
                            className={`grid w-full gap-1 border-b border-border px-4 py-3 text-left text-sm transition-colors hover:bg-accent/40 ${
                                selectedAccount ? "bg-accent/30" : "bg-card"
                            }`}
                            key={account.id}
                            onClick={() => {
                                setSelectedAccountId(account.id);
                                setExpandedForm(false);
                                setEditingSubjectKey(undefined);
                            }}
                            type="button"
                        >
                            <span className="flex min-w-0 items-center justify-between gap-2">
                                <span className="truncate font-semibold">{account.label}</span>
                                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-primary bg-primary text-xs font-semibold text-primary-foreground">
                                    {grants.length}
                                </span>
                            </span>
                            <span className="truncate text-xs text-muted-foreground">{account.broker_code}</span>
                        </button>
                    );
                })}
            </div>

            <div className="grid min-w-0 gap-4 p-4">
                <div className="flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold">{selected.account.label}</h3>
                        <p className="text-sm text-muted-foreground">{selected.account.broker_code}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                        {selected.grants.length} grant{selected.grants.length === 1 ? "" : "s"} configured
                    </div>
                </div>

                {selected.grants.length ? (
                    <div className="grid gap-2">
                        {selected.grants.map((grant) => (
                            <div
                                className="grid gap-3 rounded-lg border border-border bg-background p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                                key={grant.id}
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">{grant.subject_label}</span>
                                        <span className="border border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                            {grant.subject_type === "user" ? "Person" : "Role default"}
                                        </span>
                                    </div>
                                    {grant.subject_subtitle ? (
                                        <div className="mt-1 text-sm text-muted-foreground">
                                            {grant.subject_subtitle}
                                        </div>
                                    ) : null}
                                    <div className="mt-1 truncate text-sm">{permissionSummary(grant)}</div>
                                </div>
                                <Button
                                    aria-label="Edit grant"
                                    onClick={() => openEditGrant(grant)}
                                    size="icon"
                                    title="Edit grant"
                                    type="button"
                                    variant="secondary"
                                >
                                    <Pencil className="size-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Alert>
                        <AlertDescription>
                            No extra grants yet. Only admins can currently use this account.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="border-t border-border pt-4">
                    <Button onClick={openAddGrant} type="button" variant="secondary">
                        {editingSubjectKey ? "Edit selected grant" : expandedForm ? "Hide grant form" : "Add grant"}
                    </Button>
                </div>

                {expandedForm ? (
                    <div className="rounded-lg border border-border bg-background p-4">
                        <AccessGrantEditor
                            accountId={selected.account.id}
                            grants={selected.grants}
                            initialSubjectKey={editingSubjectKey}
                            key={`${selected.account.id}:${editingSubjectKey ?? "add"}`}
                            members={members}
                            roles={roles}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    );
}
