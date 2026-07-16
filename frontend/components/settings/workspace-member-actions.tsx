"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { IconBan, IconDotsVertical } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Menu,
    MenuItem,
    MenuPopup,
    MenuTrigger
} from "@/components/ui/menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogPanel,
    DialogTitle
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import {
    approveWorkspaceMember,
    disableWorkspaceMember,
    enableWorkspaceMember,
    removeWorkspaceMember
} from "@/service/actions/rbac";
import type { RoleDefinition, WorkspaceMember } from "@/service/types/rbac";
import { memberLabel, roleDisplayLabel } from "@/components/settings/workspace-member-utils";

type WorkspaceMemberActionsProps = {
    currentUserId: string;
    member: WorkspaceMember;
    roles: RoleDefinition[];
    viewerDefault: string;
};

export function WorkspaceMemberActions({ currentUserId, member, roles, viewerDefault }: WorkspaceMemberActionsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
    const [disableDialogOpen, setDisableDialogOpen] = useState(false);
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const [approvalRole, setApprovalRole] = useState(viewerDefault);
    const isSelf = member.user_id === currentUserId;
    const isProtectedOwner = Boolean(member.is_owner);
    const assignableRoles = roles.filter((role) => ["admin", "operator", "viewer"].includes(role.name));

    if (isSelf || isProtectedOwner) {
        return <span aria-hidden className="size-8" />;
    }

    function refresh() {
        router.refresh();
    }

    function onApprove() {
        startTransition(async () => {
            try {
                await approveWorkspaceMember(member.user_id, approvalRole);
                setApprovalDialogOpen(false);
                toast.success(`Approved ${memberLabel(member)}`, {
                    icon: <Check className="size-4 text-success-foreground" />
                });
                refresh();
            } catch {
                toast.error("Could not approve request. Try again.");
            }
        });
    }

    function onDisable() {
        startTransition(async () => {
            try {
                await disableWorkspaceMember(member.user_id);
                setDisableDialogOpen(false);
                toast.success(`Disabled ${memberLabel(member)}`);
                refresh();
            } catch {
                toast.error("Could not disable account. Try again.");
            }
        });
    }

    function onEnable() {
        startTransition(async () => {
            try {
                await enableWorkspaceMember(member.user_id);
                toast.success(`Enabled ${memberLabel(member)}`, {
                    icon: <Check className="size-4 text-success-foreground" />
                });
                refresh();
            } catch {
                toast.error("Could not enable account. Try again.");
            }
        });
    }

    function onRemove() {
        startTransition(async () => {
            try {
                await removeWorkspaceMember(member.user_id);
                setRemoveDialogOpen(false);
                toast.success(member.status === "pending" ? "Request removed" : `Removed ${memberLabel(member)}`);
                refresh();
            } catch {
                toast.error("Could not remove account. Try again.");
            }
        });
    }

    const requestLabel = member.email || member.auth_name || memberLabel(member);
    const removeTitle = member.status === "pending" ? "Remove workspace request" : "Remove workspace member";
    const removeDescription =
        member.status === "pending"
            ? `Remove ${requestLabel}'s pending workspace request? They will no longer appear in this approval list.`
            : `Remove ${requestLabel} from this workspace? They will lose access immediately.`;

    if (member.status === "pending") {
        return (
            <>
                <div className="flex items-center justify-end gap-1">
                    <Button
                        aria-label={`Approve ${memberLabel(member)}`}
                        className="size-8 text-success-foreground hover:bg-success/10 hover:text-success-foreground"
                        disabled={isPending}
                        onClick={() => setApprovalDialogOpen(true)}
                        size="icon-sm"
                        title="Approve request"
                        type="button"
                        variant="ghost"
                    >
                        <Check className="size-4" />
                    </Button>
                    <Button
                        aria-label={`Remove ${memberLabel(member)} request`}
                        className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isPending}
                        onClick={() => setRemoveDialogOpen(true)}
                        size="icon-sm"
                        title="Remove request"
                        type="button"
                        variant="ghost"
                    >
                        <X className="size-4" />
                    </Button>
                </div>

                <Dialog onOpenChange={setApprovalDialogOpen} open={approvalDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Approve workspace access</DialogTitle>
                            <DialogDescription>
                                Choose the role to assign before approving {memberLabel(member)}.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogPanel>
                            <RadioGroup
                                aria-label="Workspace role"
                                onValueChange={(value) => {
                                    if (value) {
                                        setApprovalRole(value);
                                    }
                                }}
                                value={approvalRole}
                            >
                                {assignableRoles.map((role) => (
                                    <label
                                        className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background px-3 py-3 text-sm hover:bg-muted/40 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
                                        key={role.name}
                                    >
                                        <Radio className="mt-0.5" value={role.name} />
                                        <span className="grid gap-1">
                                            <span className="font-medium text-foreground">
                                                {roleDisplayLabel(role.name, role.label)}
                                            </span>
                                            <span className="text-xs leading-5 text-muted-foreground">
                                                {role.name === "admin"
                                                    ? "Can manage setup, members, broker credentials, LLM keys, and MCP."
                                                    : role.name === "operator"
                                                      ? "Can use the workspace and shared data without changing admin setup."
                                                      : "Can view allowed workspace areas without setup or configuration access."}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </RadioGroup>
                        </DialogPanel>
                        <DialogFooter>
                            <Button
                                disabled={isPending}
                                onClick={() => setApprovalDialogOpen(false)}
                                type="button"
                                variant="outline"
                            >
                                Cancel
                            </Button>
                            <Button disabled={isPending} loading={isPending} onClick={onApprove} type="button">
                                <Check data-icon="inline-start" className="text-success-foreground" />
                                Approve
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
                <AlertDialog onOpenChange={setRemoveDialogOpen} open={removeDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader className="flex-row items-start gap-4 text-left sm:text-left">
                            <AlertDialogMedia className="mx-0 bg-destructive/10 text-destructive">
                                <X className="size-5" />
                            </AlertDialogMedia>
                            <div className="grid min-w-0 gap-2">
                                <AlertDialogTitle>{removeTitle}</AlertDialogTitle>
                                <AlertDialogDescription>{removeDescription}</AlertDialogDescription>
                            </div>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                disabled={isPending}
                                loading={isPending}
                                onClick={onRemove}
                                variant="destructive"
                            >
                                <X data-icon="inline-start" />
                                Remove
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </>
        );
    }

    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button
                        aria-label="Member actions"
                        className="size-8"
                        disabled={isPending}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                    >
                        <IconDotsVertical className="size-4" />
                    </Button>
                }
            />
            <MenuPopup align="end" className="min-w-48">
                {member.status === "disabled" ? (
                    <MenuItem closeOnClick disabled={isPending} onClick={onEnable}>
                        <Check className="size-4 text-success-foreground" />
                        Enable account
                    </MenuItem>
                ) : (
                    <MenuItem
                        className="text-warning-foreground focus:text-warning-foreground"
                        closeOnClick
                        disabled={isPending}
                        onClick={() => setDisableDialogOpen(true)}
                    >
                        <IconBan className="size-4 text-warning-foreground" />
                        Disable account
                    </MenuItem>
                )}
                <MenuItem closeOnClick disabled={isPending} onClick={() => setRemoveDialogOpen(true)} variant="destructive">
                    <X className="size-4 text-destructive" />
                    Remove from workspace
                </MenuItem>
            </MenuPopup>
            <AlertDialog onOpenChange={setDisableDialogOpen} open={disableDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader className="flex-row items-start gap-4 text-left sm:text-left">
                        <AlertDialogMedia className="mx-0 bg-warning/10 text-warning-foreground">
                            <IconBan className="size-5" />
                        </AlertDialogMedia>
                        <div className="grid min-w-0 gap-2">
                            <AlertDialogTitle>Disable account</AlertDialogTitle>
                            <AlertDialogDescription>
                                Disable {requestLabel}? They will lose workspace access until an admin enables them again.
                            </AlertDialogDescription>
                        </div>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isPending} loading={isPending} onClick={onDisable}>
                            Disable account
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog onOpenChange={setRemoveDialogOpen} open={removeDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader className="flex-row items-start gap-4 text-left sm:text-left">
                        <AlertDialogMedia className="mx-0 bg-destructive/10 text-destructive">
                            <X className="size-5" />
                        </AlertDialogMedia>
                        <div className="grid min-w-0 gap-2">
                            <AlertDialogTitle>{removeTitle}</AlertDialogTitle>
                            <AlertDialogDescription>{removeDescription}</AlertDialogDescription>
                        </div>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isPending} loading={isPending} onClick={onRemove} variant="destructive">
                            <X data-icon="inline-start" />
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Menu>
    );
}
