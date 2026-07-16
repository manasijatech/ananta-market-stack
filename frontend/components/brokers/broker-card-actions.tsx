"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { getSessionStatus, verifyBrokerAccount } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { Button } from "@/components/ui/button";
import type { BrokerAccount } from "@/service/types/broker";

export function BrokerCardActions({ account }: { account: BrokerAccount }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const canManageSessions = account.access_permissions?.includes("broker.manage_sessions") ?? false;
    const verified = Boolean(account.last_verified_at);
    const sessionReady = account.session_status === "active" || account.session_status === "automation_ready";

    function rememberPendingBrokerLogin() {
        window.localStorage.setItem(
            "ananta-market-stack:pending-broker-login",
            JSON.stringify({
                accountId: account.id,
                broker: account.broker_code,
                createdAt: Date.now()
            })
        );
    }

    function verify() {
        startTransition(async () => {
            try {
                const result = await verifyBrokerAccount(account.id);
                if (result.ok) {
                    toast.success(`${account.label} verified.`, {
                        description: result.instrument_sync_message || undefined
                    });
                    router.refresh();
                } else {
                    toast.error(`Could not verify ${account.label}.`, {
                        description: result.message || undefined
                    });
                }
            } catch (error) {
                toast.error(`Could not verify ${account.label}.`, {
                    description: parseActionError(error).message
                });
            }
        });
    }

    function openLogin() {
        startTransition(async () => {
            try {
                const status = await getSessionStatus(account.id, account.broker_code);
                if ("login_url" in status && status.login_url) {
                    rememberPendingBrokerLogin();
                    window.open(status.login_url, "_blank", "noopener,noreferrer");
                    return;
                }
                toast.info("Open the account page to activate this broker session.");
            } catch (error) {
                toast.error(`Could not open login for ${account.label}.`, {
                    description: parseActionError(error).message
                });
            }
        });
    }

    return (
        <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" type="button" variant="outline">
                <Link href={`/broker-connections/${account.id}`}>Open</Link>
            </Button>
            {canManageSessions && !verified ? (
                <Button disabled={isPending} onClick={verify} size="sm" type="button" variant="outline">
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    Verify
                </Button>
            ) : null}
            {canManageSessions && !sessionReady ? (
                <Button disabled={isPending} onClick={openLogin} size="sm" type="button">
                    <ExternalLink aria-hidden="true" className="size-4" />
                    Login
                </Button>
            ) : null}
        </div>
    );
}
