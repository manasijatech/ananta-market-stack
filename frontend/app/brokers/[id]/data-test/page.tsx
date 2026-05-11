import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrokerDataTest } from "@/components/brokers/broker-data-test";
import { PageHeader, Shell, brokerNames } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import { getBrokerAccount, getDataCapabilities, getSessionStatus, getStreamStatus } from "@/service/actions/broker";

type BrokerDataTestPageProps = {
  params: Promise<{ id: string }>;
};

export default async function BrokerDataTestPage({ params }: BrokerDataTestPageProps) {
  const { id } = await params;
  const account = await getBrokerAccount(id);
  const [sessionStatus, capabilities, streamStatus] = await Promise.all([
    getSessionStatus(account.id, account.broker_code),
    getDataCapabilities(account.id),
    getStreamStatus(account.id)
  ]);
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

  return (
    <Shell>
      <PageHeader
        eyebrow={brokerNames[account.broker_code]}
        title={`${account.label} data APIs`}
        description="Exercise the uniform read-only broker data layer, inspect raw payloads, and test the websocket inspection flow."
        action={
          <Button asChild variant="outline">
            <Link href={`/brokers/${account.id}`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to broker
            </Link>
          </Button>
        }
      />
      <BrokerDataTest
        account={account}
        apiBaseUrl={apiBaseUrl}
        initialCapabilities={capabilities}
        initialStreamStatus={streamStatus}
        sessionActive={sessionStatus.session_active}
      />
    </Shell>
  );
}
