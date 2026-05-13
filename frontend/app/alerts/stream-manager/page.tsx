import { AlertsNav } from "@/components/alerts/alerts-nav";
import { StreamManager } from "@/components/alerts/stream-manager";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getLiveStreamsStatus } from "@/service/actions/alerts";

export default async function StreamManagerPage() {
 const status = await getLiveStreamsStatus();

 return (
 <Shell>
 <PageHeader
 eyebrow="Alerts workspace"
 title="Stream manager"
 description="Inspect live worker health, desired symbol subscriptions, and broker stream session state."
 />
 <AlertsNav />
 <StreamManager initialStatus={status} />
 </Shell>
 );
}
