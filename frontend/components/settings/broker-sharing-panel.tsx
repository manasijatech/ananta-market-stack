"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconArrowRight, IconWallet } from "@tabler/icons-react";
import { Pencil, Plus } from "lucide-react";
import { AccessGrantEditor } from "@/components/settings/access-grant-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
    DialogPanel,
    DialogPopup,
    DialogTitle
} from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import type { BrokerAccount } from "@/service/types/broker";
import type { BrokerAccountGrant, RoleDefinition, WorkspaceMember } from "@/service/types/rbac";
import { cn } from "@/lib/utils";

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

function grantTypeVariant(subjectType: BrokerAccountGrant["subject_type"]): "info" | "secondary" {
    return subjectType === "user" ? "info" : "secondary";
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

function GrantSection({
    description,
    grants,
    isGrantEditable,
    onEdit,
    title
}: {
    description: string;
    grants: BrokerAccountGrant[];
    isGrantEditable: (grant: BrokerAccountGrant) => boolean;
    onEdit: (grant: BrokerAccountGrant) => void;
    title: string;
}) {
    if (!grants.length) {
        return null;
    }

    return (
        <section className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Badge size="sm" variant="secondary">
                    {grants.length}
                </Badge>
            </div>
            <Table variant="card">
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead>Subject</TableHead>
                        <TableHead>Access</TableHead>
                        <TableHead className="w-12 text-right">Edit</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {grants.map((grant) => (
                        <TableRow key={grant.id}>
                            <TableCell className="min-w-52 py-3 align-top">
                                <div className="flex min-w-0 flex-col gap-1">
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <span className="truncate font-medium">{grant.subject_label}</span>
                                        <Badge size="sm" variant={grantTypeVariant(grant.subject_type)}>
                                            {grant.subject_type === "user" ? "Person" : "Role default"}
                                        </Badge>
                                    </div>
                                    {grant.subject_subtitle ? (
                                        <span className="truncate text-xs text-muted-foreground">
                                            {grant.subject_subtitle}
                                        </span>
                                    ) : null}
                                </div>
                            </TableCell>
                            <TableCell className="min-w-72 whitespace-normal py-3 align-top text-sm text-muted-foreground">
                                {permissionSummary(grant)}
                            </TableCell>
                            <TableCell className="py-3 text-right align-top">
                                {isGrantEditable(grant) ? (
                                    <Button
                                        aria-label={`Edit access grant for ${grant.subject_label}`}
                                        onClick={() => onEdit(grant)}
                                        size="icon-sm"
                                        title="Edit grant"
                                        type="button"
                                        variant="ghost"
                                    >
                                        <Pencil aria-hidden="true" className="size-4" />
                                    </Button>
                                ) : (
                                    <span className="inline-flex size-8" />
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </section>
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
    const [grantDialogOpen, setGrantDialogOpen] = useState(false);
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
        setGrantDialogOpen(true);
    }

    function openEditGrant(grant: BrokerAccountGrant) {
        setEditingSubjectKey(`${grant.subject_type}:${grant.subject_id}`);
        setGrantDialogOpen(true);
    }

    function closeGrantDialog() {
        setGrantDialogOpen(false);
        setEditingSubjectKey(undefined);
    }

    const roleGrants = selected.grants.filter((grant) => grant.subject_type === "role");
    const userGrants = selected.grants.filter((grant) => grant.subject_type === "user");
    const membersById = new Map(members.map((member) => [member.user_id, member]));

    function isGrantEditable(grant: BrokerAccountGrant): boolean {
        if (grant.subject_type === "role") {
            return grant.subject_id !== "admin";
        }
        return membersById.get(grant.subject_id)?.role !== "admin";
    }

    return (
        <div className="grid overflow-hidden rounded-lg border border-border bg-background lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="max-h-[560px] overflow-y-auto border-b border-border bg-muted/35 p-1 lg:border-r lg:border-b-0">
                {accountGrants.map(({ account, grants }) => {
                    const selectedAccount = account.id === selected.account.id;
                    return (
                        <button
                            className={cn(
                                "grid w-full gap-1.5 rounded-md px-3 py-3 text-left text-sm transition-colors",
                                "hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selectedAccount ? "bg-background text-foreground" : "text-muted-foreground"
                            )}
                            key={account.id}
                            onClick={() => {
                                setSelectedAccountId(account.id);
                                setGrantDialogOpen(false);
                                setEditingSubjectKey(undefined);
                            }}
                            type="button"
                        >
                            <span className="flex min-w-0 items-center justify-between gap-2">
                                <span className="truncate font-medium">{account.label}</span>
                                <Badge size="sm" variant={selectedAccount ? "default" : "secondary"}>
                                    {grants.length}
                                </Badge>
                            </span>
                            <span className="truncate text-xs">{account.broker_code}</span>
                        </button>
                    );
                })}
            </div>

            <div className="grid min-w-0 gap-4 p-4 sm:p-5">
                <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-semibold">{selected.account.label}</h3>
                            <Badge size="sm" variant="outline">
                                {selected.account.broker_code}
                            </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Define account-level access for people and role defaults.
                        </p>
                    </div>
                    <Badge size="sm" variant={selected.grants.length ? "success" : "secondary"}>
                        {selected.grants.length} grant{selected.grants.length === 1 ? "" : "s"}
                    </Badge>
                </div>

                {selected.grants.length ? (
                    <div className="grid gap-5">
                        <GrantSection
                            description="Baseline access inherited by everyone with this workspace role."
                            grants={roleGrants}
                            isGrantEditable={isGrantEditable}
                            onEdit={openEditGrant}
                            title="Role defaults"
                        />
                        <GrantSection
                            description="Individual overrides for specific workspace members."
                            grants={userGrants}
                            isGrantEditable={isGrantEditable}
                            onEdit={openEditGrant}
                            title="People"
                        />
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
                        <Plus aria-hidden="true" className="size-4" />
                        New grant
                    </Button>
                </div>

                <Dialog onOpenChange={setGrantDialogOpen} open={grantDialogOpen}>
                    <DialogPopup className="max-w-3xl">
                        <DialogHeader>
                            <DialogTitle>{editingSubjectKey ? "Edit grant" : "New grant"}</DialogTitle>
                            <DialogDescription>
                                {editingSubjectKey
                                    ? `Update access for ${selected.account.label}.`
                                    : `Grant ${selected.account.label} access to a person or role.`}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogPanel className="pt-2">
                            <AccessGrantEditor
                                accountId={selected.account.id}
                                grants={selected.grants}
                                initialSubjectKey={editingSubjectKey}
                                key={`${selected.account.id}:${editingSubjectKey ?? "add"}`}
                                members={members}
                                onCancel={closeGrantDialog}
                                onSaved={closeGrantDialog}
                                roles={roles}
                            />
                        </DialogPanel>
                    </DialogPopup>
                </Dialog>
            </div>
        </div>
    );
}
