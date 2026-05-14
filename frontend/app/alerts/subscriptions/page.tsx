import { AlertsNav } from "@/components/alerts/alerts-nav";
import { SubscriptionsManager } from "@/components/alerts/subscriptions-manager";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getLiveSubscriptions } from "@/service/actions/alerts";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";

export default async function AlertSubscriptionsPage() {
 const [accounts, subscriptions, watchlists, systemConfig] = await Promise.all([
  getBrokerAccounts(),
  getLiveSubscriptions(),
  getWatchlists(),
  getSystemConfig()
 ]);

 return (
 <Shell>
 <PageHeader
 eyebrow="Alerts workspace"
 title="Subscribed symbols"
 description="Manage reusable symbol subscriptions that feed workflows and live data consumers."
 />
 <AlertsNav />
 <SubscriptionsManager
  accounts={accounts}
  alphaWebSocketConfig={systemConfig.alpha_websocket}
  initialSubscriptions={subscriptions}
  watchlists={watchlists}
 />
 </Shell>
 );
}
