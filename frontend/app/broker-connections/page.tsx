import { Suspense } from "react";
import { AccessDeniedState } from "@/components/access/access-denied-state";
import { getBrokerAccounts } from "@/service/actions/broker";
import { BrokerCallbackHandler } from "@/components/brokers/broker-callback-handler";
import { NotificationsBanner } from "@/components/brokers/notifications-banner";
import { BrokerCard, PageHeader, Shell } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BrokerAccount } from "@/service/types/broker";
import { canManageBrokerCredentials } from "@/lib/rbac";
import { formatUserFacingError, isPermissionDeniedError } from "@/lib/api-errors";
import { getRbacMe } from "@/service/actions/rbac";
import Link from "next/link";

export default async function BrokersPage() {
    let accounts: BrokerAccount[] = [];
    let error = "";
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
                    backHref="/dashboard"
                />
            );
        }
        error = formatUserFacingError(caught, "Could not load broker accounts.");
    }

    const canAddBroker = canManageBrokerCredentials(principal);
    const addBrokerReason = canAddBroker
        ? ""
        : "Only admins or members with credential-management access can add broker accounts.";

    return (
        <Shell>
            <PageHeader
                eyebrow="Broker accounts"
                title="Broker Connections"
                description="Manage broker credentials, session status, quotes, and portfolio data for your trading workspace."
                action={
                    <span data-onboarding="add-broker-action">
                        {canAddBroker ? (
                            <Button asChild className="min-h-11 w-full font-extrabold min-[520px]:w-auto">
                                <Link href="/broker-connections/new">+ Add broker</Link>
                            </Button>
                        ) : (
                            <span title={addBrokerReason}>
                                <Button className="min-h-11 w-full font-extrabold min-[520px]:w-auto" disabled type="button">
                                    + Add broker
                                </Button>
                            </span>
                        )}
                    </span>
                }
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

            {!error && accounts.length === 0 ? (
                <Card className="border-dashed text-center">
                    <CardHeader>
                        <CardTitle className="text-2xl">
                            {canAddBroker ? "No broker accounts yet" : "No broker accounts are shared with you yet"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="mx-auto max-w-xl text-muted-foreground">
                            {canAddBroker
                                ? "Add your first broker account to start setting up sessions, quotes, and portfolio views."
                                : "Ask a workspace admin to share a broker account with at least `View account` access. Shared accounts will appear here automatically."}
                        </p>
                        {canAddBroker ? (
                            <div className="mt-6">
                                <Button asChild className="min-h-11 font-extrabold">
                                    <Link href="/broker-connections/new">Add broker</Link>
                                </Button>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            ) : null}

            {accounts.length ? (
                <section className="grid gap-4 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
                    {accounts.map((account) => (
                        <BrokerCard account={account} key={account.id} />
                    ))}
                </section>
            ) : null}
        </Shell>
    );
}
