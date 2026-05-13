import { BrokerDataSearchConfigPanel } from "@/components/brokers/broker-data-search-config";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getBrokerDataSearchConfig } from "@/service/actions/broker";

export default async function BrokerDataConfigPage() {
 const config = await getBrokerDataSearchConfig();

 return (
 <Shell>
 <PageHeader
 eyebrow="Workspace"
 title="Broker data config"
 description="Choose the default broker cache for symbol search and inspect the latest instrument sync and holdings refresh state."
 />
 <BrokerDataSearchConfigPanel initialConfig={config} />
 </Shell>
 );
}
