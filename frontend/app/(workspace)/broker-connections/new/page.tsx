import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSupportedBrokers } from "@/service/actions/broker";
import { AddBrokerForm } from "@/components/brokers/add-broker-form";
import { PageHeader } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import { AccessDeniedState } from "@/components/access/access-denied-state";
import { requireActiveWorkspace } from "@/lib/auth-guards";
import { canManageBrokerCredentials } from "@/lib/rbac";
import type { BrokerCode } from "@/service/types/broker";

type NewBrokerPageProps = {
    searchParams?: Promise<{ broker?: string | string[] }>;
};

export default async function NewBrokerPage({ searchParams }: NewBrokerPageProps) {
    const principal = await requireActiveWorkspace();
    if (!canManageBrokerCredentials(principal)) {
        return (
            <AccessDeniedState
                title="Add broker credentials"
                description="Broker credentials can only be added by workspace admins."
                reason="Your current role does not include broker credential management."
                backHref="/broker-connections"
                backLabel="Go to brokers"
            />
        );
    }

    const supportedBrokers = await getSupportedBrokers();
    const params = await searchParams;
    const requestedBroker = Array.isArray(params?.broker) ? params.broker[0] : params?.broker;
    const initialBroker = supportedBrokers.includes(requestedBroker as BrokerCode)
        ? (requestedBroker as BrokerCode)
        : undefined;

    return (
        <>
            <PageHeader
                title="Add broker credentials"
                description="Choose a broker and enter the required credentials. Session authorization can be completed on the detail page."
                action={
                    <Button render={<Link href="/broker-connections" />} variant="outline">
                        <ArrowLeft data-icon="inline-start" />
                        Back to brokers
                    </Button>
                }
            />
            <AddBrokerForm initialBroker={initialBroker} supportedBrokers={supportedBrokers} />
        </>
    );
}
