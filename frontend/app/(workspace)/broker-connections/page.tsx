import { Suspense } from "react";
import { AccessDeniedState } from "@/components/access/access-denied-state";
import { getBrokerAccounts, getSupportedBrokers } from "@/service/actions/broker";
import { BrokerAddOptions } from "@/components/brokers/broker-add-options";
import { BrokerCallbackHandler } from "@/components/brokers/broker-callback-handler";
import { NotificationsBanner } from "@/components/brokers/notifications-banner";
import { BrokerAccountsEmpty, BrokerCard, PageHeader } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { BrokerAccount, BrokerCode } from "@/service/types/broker";
import { canManageBrokerCredentials } from "@/lib/rbac";
import { formatUserFacingError, isPermissionDeniedError } from "@/lib/api-errors";
import { getRbacMe } from "@/service/actions/rbac";

export default async function BrokersPage() {
    let accounts: BrokerAccount[] = [];
    let supportedBrokers: BrokerCode[] = [];
    let error = "";
    let brokerOptionsError = "";
    let principal = null;

    try {
        [accounts, principal] = await Promise.all([getBrokerAccounts(), getRbacMe()]);
    } catch (caught) {
        if (isPermissionDeniedError(caught)) {
            return (
                <AccessDeniedState
                    title="Broker connections"
                    description="Connected broker accounts appear here when your role is allowed to use them."
                    reason="Your account is not allowed to browse broker connections right now."
                    backHref="/broker-connections"
                />
            );
        }
        error = formatUserFacingError(caught, "Could not load broker accounts.");
    }

    const canAddBroker = canManageBrokerCredentials(principal);

    if (!error && canAddBroker) {
        try {
            supportedBrokers = await getSupportedBrokers();
        } catch (caught) {
            brokerOptionsError = formatUserFacingError(caught, "Could not load broker options.");
        }
    }

    return (
        <>
            <PageHeader
                title="Broker Connections"
                description="Manage broker credentials, session status, quotes, and portfolio data for your trading workspace."
            />

            <div className="mb-6">
                <NotificationsBanner />
            </div>

            <Suspense fallback={null}>
                <BrokerCallbackHandler accounts={accounts} />
            </Suspense>

            {error ? (
                <Alert variant="warning">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            {!error && brokerOptionsError ? (
                <div className="mb-6">
                    <Alert variant="warning">
                        <AlertDescription>{brokerOptionsError}</AlertDescription>
                    </Alert>
                </div>
            ) : null}

            {!error && canAddBroker ? (
                <div className="mb-6">
                    <BrokerAddOptions connectedCount={accounts.length} supportedBrokers={supportedBrokers} />
                </div>
            ) : null}

            {!error && accounts.length === 0 ? <BrokerAccountsEmpty canAddBroker={canAddBroker} /> : null}

            {accounts.length ? (
                <section className="grid gap-4 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
                    {accounts.map((account) => (
                        <BrokerCard account={account} key={account.id} />
                    ))}
                </section>
            ) : null}
        </>
    );
}
