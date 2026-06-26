import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSupportedBrokers } from "@/service/actions/broker";
import { AddBrokerForm } from "@/components/brokers/add-broker-form";
import { PageHeader } from "@/components/brokers/ui";
import { Shell } from "@/components/brokers/shell";
import { Button } from "@/components/ui/button";

export default async function NewBrokerPage() {
    const supportedBrokers = await getSupportedBrokers();

    return (
        <Shell>
            <PageHeader
                eyebrow="New broker"
                title="Add broker credentials"
                description="Choose a broker and enter the required credentials. Session authorization can be completed on the detail page."
                action={
                    <Button render={<Link href="/broker-connections" />} variant="outline">
                        <ArrowLeft data-icon="inline-start" />
                        Back to brokers
                    </Button>
                }
            />
            <AddBrokerForm supportedBrokers={supportedBrokers} />
        </Shell>
    );
}
