"use client";

import { useEffect, useState } from "react";
import { getInstrumentSyncStatus } from "@/service/actions/broker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatUserFacingError } from "@/lib/api-errors";
import type { InstrumentSyncResult } from "@/service/types/broker";

const RUNNING_STATUSES = new Set(["running"]);

function isRunning(status: string | null | undefined): boolean {
    return Boolean(status && RUNNING_STATUSES.has(status));
}

export function InstrumentSyncBanner({
    accountId,
    initialMessage,
    initialStatus
}: {
    accountId: string;
    initialMessage?: string | null;
    initialStatus?: string | null;
}) {
    const [status, setStatus] = useState<InstrumentSyncResult | null>(null);
    const [message, setMessage] = useState(initialMessage ?? "");
    const [active, setActive] = useState(isRunning(initialStatus));

    useEffect(() => {
        let cancelled = false;
        let attemptsWithoutProgress = 0;

        async function poll() {
            try {
                const result = await getInstrumentSyncStatus(accountId);
                if (cancelled) {
                    return;
                }
                setStatus(result);
                const stillRunning = isRunning(result.sync_status);
                setActive(stillRunning);

                if (stillRunning) {
                    attemptsWithoutProgress += 1;
                    setMessage(
                        "Downloading the broker instrument master. Symbol search and alert symbol pickers will work once this finishes."
                    );
                    return;
                }

                attemptsWithoutProgress = 0;

                if (result.sync_status === "failed") {
                    setMessage(
                        result.error ||
                            "Instrument sync failed. Open Test data APIs to retry sync, or click Verify on this broker account."
                    );
                    setActive(true);
                } else if (result.sync_status === "completed" || result.sync_status === "preserved") {
                    setMessage("");
                    setActive(false);
                } else if (result.sync_status === "not_started" || result.sync_status === "pending") {
                    setMessage("");
                    setActive(false);
                }
            } catch (caught) {
                if (!cancelled) {
                    attemptsWithoutProgress += 1;
                    if (attemptsWithoutProgress >= 3) {
                        setActive(false);
                        setMessage(formatUserFacingError(caught, ""));
                    }
                }
            }
        }

        void poll();
        const timer = window.setInterval(() => {
            void poll();
        }, 4000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [accountId]);

    if (!active && !message) {
        return null;
    }

    const rowCount = status?.row_count ?? 0;
    const title =
        status?.sync_status === "failed"
            ? "Instrument sync failed"
            : status?.sync_status === "completed" || status?.sync_status === "preserved"
              ? "Instrument sync ready"
              : "Syncing instruments";

    return (
        <Alert className="mb-6" variant={status?.sync_status === "failed" ? "destructive" : "default"}>
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>
                {message}
                {rowCount > 0 && status?.sync_status === "completed"
                    ? ` (${rowCount.toLocaleString()} symbols indexed.)`
                    : null}
            </AlertDescription>
        </Alert>
    );
}
