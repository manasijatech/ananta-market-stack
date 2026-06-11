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
    const canDelete = permissions.includes("broker.delete");

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
            <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">Account actions</h2>
            <div className="mt-4 flex flex-wrap gap-3">
                {canManageSessions ? (
                    <Button disabled={isPending} onClick={verify} type="button">
                        Verify
                    </Button>
                ) : null}
                {verified ? (
                    <Button asChild disabled={isPending} type="button" variant="outline">
                        <Link href={`/broker-connections/${accountId}/data-test`}>Test data APIs</Link>
                    </Button>
                ) : null}
                {canDelete ? (
                    <Button disabled={isPending} onClick={remove} type="button" variant="destructive">
                        Delete
                    </Button>
                ) : null}
                {!canManageSessions && !canDelete ? (
                    <p className="text-sm text-muted-foreground">You have read-only access to this broker account.</p>
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
