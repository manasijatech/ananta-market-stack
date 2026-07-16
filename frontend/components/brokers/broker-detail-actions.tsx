"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBrokerAccount, verifyBrokerAccount } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function BrokerDetailActions({
    accountId,
    verified,
    permissions = []
}: {
    accountId: string;
    verified: boolean;
    permissions?: string[];
}) {
    const router = useRouter();
    const [message, setMessage] = useState("");
    const [isPending, startTransition] = useTransition();
    const canManageSessions = permissions.includes("broker.manage_sessions");
    const canUseData = permissions.includes("broker.use_data");
    const canDelete = permissions.includes("broker.delete");
    const verifyDisabledReason = "You need session-management access on this broker account to verify or refresh it.";
    const dataDisabledReason =
        "You need portfolio and market-data access on this broker account to open the data tools.";
    const deleteDisabledReason = "Only users with delete access can remove this broker account.";

    function verify() {
        setMessage("");
        startTransition(async () => {
            try {
                const result = await verifyBrokerAccount(accountId);
                const parts = [
                    result.ok ? "Connection verified." : result.message || "Verification failed.",
                    result.instrument_sync_message
                ].filter(Boolean);
                setMessage(parts.join(" "));
            } catch (error) {
                setMessage(parseActionError(error).message);
            }
        });
    }

    function remove() {
        if (!window.confirm("Delete this broker account and its stored credentials?")) {
            return;
        }
        setMessage("");
        startTransition(async () => {
            try {
                await deleteBrokerAccount(accountId);
                router.push("/broker-connections");
            } catch (error) {
                setMessage(parseActionError(error).message);
            }
        });
    }

    return (
        <div>
            <h2 className="text-sm font-semibold">Actions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Verify the connection or open developer diagnostics.</p>
            <div className="mt-4 flex flex-wrap gap-2">
                {canManageSessions ? (
                    <Button disabled={isPending} onClick={verify} type="button">
                        Verify
                    </Button>
                ) : (
                    <span title={verifyDisabledReason}>
                        <Button disabled type="button">
                            Verify
                        </Button>
                    </span>
                )}
                {verified ? (
                    canUseData ? (
                        <Button asChild disabled={isPending} type="button" variant="outline">
                            <Link href={`/broker-connections/${accountId}/data-test`}>Dev tools</Link>
                        </Button>
                    ) : (
                        <span title={dataDisabledReason}>
                            <Button disabled type="button" variant="outline">
                                Dev tools
                            </Button>
                        </span>
                    )
                ) : null}
                {canDelete ? (
                    <Button disabled={isPending} onClick={remove} type="button" variant="destructive">
                        Delete
                    </Button>
                ) : (
                    <span title={deleteDisabledReason}>
                        <Button disabled type="button" variant="destructive">
                            Delete
                        </Button>
                    </span>
                )}
                {!canManageSessions && !canUseData && !canDelete ? (
                    <p className="text-sm text-muted-foreground">
                        You currently have view-only access to this broker account.
                    </p>
                ) : null}
            </div>
            {message ? (
                <Alert className="mt-4">
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            ) : null}
        </div>
    );
}
