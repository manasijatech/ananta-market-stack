"use client";

import { useEffect, useState } from "react";
import { getInstrumentSyncStatus } from "@/service/actions/broker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatUserFacingError } from "@/lib/api-errors";
import type { InstrumentSyncResult } from "@/service/types/broker";

const ACTIVE_STATUSES = new Set(["running", "scheduled", "not_started", "pending"]);

function isActive(status: string | null | undefined): boolean {
    return Boolean(status && ACTIVE_STATUSES.has(status));
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
    const [active, setActive] = useState(isActive(initialStatus));

    useEffect(() => {
        let cancelled = false;

        async function poll() {
            try {
                const result = await getInstrumentSyncStatus(accountId);
                if (cancelled) {
                    return;
                }
                setStatus(result);
                const stillActive = isActive(result.sync_status);
                setActive(stillActive);
                if (stillActive) {
                    setMessage(
                        "Downloading the broker instrument master. Symbol search and alert symbol pickers will work once this finishes."
                    );
                } else if (result.sync_status === "failed") {
                    setMessage(
                        result.error ||
                            "Instrument sync failed. Open Test data APIs to retry sync, or click Verify on this broker account."
                    );
                    setActive(true);
                } else if (result.sync_status === "completed" || result.sync_status === "preserved") {
                    setMessage("");
                    setActive(false);
                }
            } catch (caught) {
                if (!cancelled) {
                    setActive(false);
                    setMessage(formatUserFacingError(caught, ""));
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
                {rowCount > 0 && status?.sync_status === "completed" ? ` (${rowCount.toLocaleString()} symbols indexed.)` : null}
            </AlertDescription>
        </Alert>
    );
}
