"use client";

import { useEffect, useState } from "react";
import { HoldingsTableCard } from "@/components/adaptive-workspace/holdings-table-card";
import { SessionStatusCard } from "@/components/adaptive-workspace/session-status-card";
import { DeskAccountState, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { useDeskAccounts } from "@/hooks/use-desk-data";
import { getHoldings, getPortfolioFunds, getSessionStatus } from "@/service/actions/broker";
import type { BrokerCode, JsonObject, SessionStatus } from "@/service/types/broker";

type Props = {
    refreshNonce: number;
};

export function LiveHoldingsWidget({ refreshNonce }: Props) {
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const [output, setOutput] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account) {
            if (!accountsLoading) setLoading(false);
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
    }, [account, accountsLoading, refreshNonce]);

    return (
        <WidgetState error={error || accountError} loading={accountsLoading || loading} loadingLabel="Loading portfolio">
            <DeskAccountState account={account} accounts={accounts}>
                {output ? <HoldingsTableCard input={{}} name="broker_get_portfolio" output={output} status="success" /> : null}
            </DeskAccountState>
        </WidgetState>
    );
}

export function LiveHealthWidget({ refreshNonce }: Props) {
    const { account, accounts, error: accountError, loading: accountsLoading } = useDeskAccounts();
    const [status, setStatus] = useState<SessionStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!account) {
            if (!accountsLoading) setLoading(false);
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
    }, [account, accountsLoading, refreshNonce]);

    return (
        <WidgetState error={error || accountError} loading={accountsLoading || loading} loadingLabel="Checking broker session">
            <DeskAccountState account={account} accounts={accounts}>
                {status ? (
                    <SessionStatusCard
                        input={{}}
                        name="broker_get_session_status"
                        output={{ ok: true, session: status }}
                        status="success"
                    />
                ) : null}
            </DeskAccountState>
        </WidgetState>
    );
}
