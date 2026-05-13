import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSupportedBrokers } from "@/service/actions/broker";
import { AddBrokerForm } from "@/components/brokers/add-broker-form";
import { PageHeader, Shell } from "@/components/brokers/ui";
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
 <Button asChild variant="outline">
 <Link href="/brokers">
 <ArrowLeft className="size-4" aria-hidden="true" />
 Back to brokers
 </Link>
 </Button>
 }
 />
 <AddBrokerForm supportedBrokers={supportedBrokers} />
 </Shell>
 );
}
