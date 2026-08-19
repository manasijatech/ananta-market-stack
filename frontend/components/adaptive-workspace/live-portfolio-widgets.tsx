"use client";

import { useEffect, useState } from "react";
import { HoldingsTableCard } from "@/components/adaptive-workspace/holdings-table-card";
import { SessionStatusCard } from "@/components/adaptive-workspace/session-status-card";
import { WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { useDeskAccounts } from "@/hooks/use-desk-data";
import { getHoldings, getPortfolioFunds, getSessionStatus } from "@/service/actions/broker";
import type { BrokerCode, JsonObject, SessionStatus } from "@/service/types/broker";

type Props = {
    refreshNonce: number;
};

export function LiveHoldingsWidget({ refreshNonce }: Props) {
    const { account, error: accountError } = useDeskAccounts();
    const [output, setOutput] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        Promise.all([getHoldings(account.id), getPortfolioFunds(account.id).catch(() => ({}))])
            .then(([holdings, funds]) => {
                if (cancelled) return;
                setOutput({
                    account: { account_id: account.id, broker_code: account.broker_code, label: account.label },
                    data: { ...(holdings as JsonObject), ...(funds as JsonObject) },
                    ok: true
                });
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load holdings.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, refreshNonce]);

    return (
        <WidgetState error={error || accountError} loading={loading} loadingLabel="Loading portfolio">
            {output ? <HoldingsTableCard input={{}} name="broker_get_portfolio" output={output} status="success" /> : null}
        </WidgetState>
    );
}

export function LiveHealthWidget({ refreshNonce }: Props) {
    const { account, error: accountError } = useDeskAccounts();
    const [status, setStatus] = useState<SessionStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void getSessionStatus(account.id, account.broker_code as BrokerCode)
            .then((next) => {
                if (cancelled) return;
                setStatus(next);
                setError(null);
            })
            .catch((caught) => {
                if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load broker health.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [account, refreshNonce]);

    return (
        <WidgetState error={error || accountError} loading={loading} loadingLabel="Checking broker session">
            {status ? (
                <SessionStatusCard
                    input={{}}
                    name="broker_get_session_status"
                    output={{ ok: true, session: status }}
                    status="success"
                />
            ) : null}
        </WidgetState>
    );
}
