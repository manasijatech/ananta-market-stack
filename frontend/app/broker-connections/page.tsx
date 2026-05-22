import { Suspense } from "react";
import { getBrokerAccounts } from "@/service/actions/broker";
import { BrokerCallbackHandler } from "@/components/brokers/broker-callback-handler";
import { NotificationsBanner } from "@/components/brokers/notifications-banner";
import { BrokerCard, PageHeader, PrimaryLink, Shell } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BrokerAccount } from "@/service/types/broker";

export default async function BrokersPage() {
    let accounts: BrokerAccount[] = [];
    let error = "";

    try {
        accounts = await getBrokerAccounts();
    } catch (caught) {
        error = caught instanceof Error ? caught.message : "Could not load broker accounts.";
    }

    return (
        <Shell>
            <PageHeader
                eyebrow="Broker accounts"
                title="Broker Connections"
                description="Manage broker credentials, session status, quotes, and portfolio data for your trading workspace."
                action={
                    <span data-onboarding="add-broker-action">
                        <PrimaryLink href="/broker-connections/new">+ Add broker</PrimaryLink>
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
                        <CardTitle className="text-2xl">No broker accounts yet</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="mx-auto max-w-xl text-muted-foreground">
                            Add your first broker account to start setting up sessions, quotes, and portfolio views.
                        </p>
                        <div className="mt-6">
                            <PrimaryLink href="/broker-connections/new">Add broker</PrimaryLink>
                        </div>
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
