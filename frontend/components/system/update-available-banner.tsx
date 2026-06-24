"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDeploymentUpdateStatus } from "@/service/actions/deployment";
import type { DeploymentUpdateStatus } from "@/service/types/deployment";

const DISMISS_STORAGE_PREFIX = "deployment-update-banner-dismissed:";

function dismissKey(status: DeploymentUpdateStatus): string {
    return `${DISMISS_STORAGE_PREFIX}${status.latest_digest ?? "unknown"}`;
}

function isDismissed(status: DeploymentUpdateStatus): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    return window.sessionStorage.getItem(dismissKey(status)) === "1";
}

export function UpdateAvailableBanner() {
    const [status, setStatus] = useState<DeploymentUpdateStatus | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        startTransition(async () => {
            try {
                const nextStatus = await getDeploymentUpdateStatus();
                setStatus(nextStatus);
                setDismissed(nextStatus ? isDismissed(nextStatus) : false);
            } catch {
                setStatus(null);
                setDismissed(false);
            }
        });
    }, []);

    function dismiss() {
        if (!status) {
            return;
        }
        window.sessionStorage.setItem(dismissKey(status), "1");
        setDismissed(true);
    }

    if (!status?.checks_enabled || !status.update_available || dismissed) {
        return null;
    }

    return (
        <section className="mb-4">
            <Alert variant="warning">
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                        <AlertTitle>A new system update is available</AlertTitle>
                        <AlertDescription>
                            Pull the latest container image to upgrade this instance. Your data volume
                            and generated secrets are preserved during a normal update.
                        </AlertDescription>
                        <div className="flex flex-wrap gap-3 text-sm font-semibold">
                            <Link
                                className="text-primary underline-offset-4 hover:underline"
                                href={status.docker_image_update_docs_url}
                                rel="noreferrer"
                                target="_blank"
                            >
                                Docker image update guide
                            </Link>
                            <Link
                                className="text-primary underline-offset-4 hover:underline"
                                href={status.self_hosting_update_docs_url}
                                rel="noreferrer"
                                target="_blank"
                            >
                                Self-hosting update guide
                            </Link>
                        </div>
                    </div>
                    <Button
                        disabled={isPending}
                        onClick={dismiss}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        Dismiss
                    </Button>
                </div>
            </Alert>
        </section>
    );
}
