import { SubscriptionsManager } from "@/components/alerts/subscriptions-manager";
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
 <SubscriptionsManager
  accounts={accounts}
  alphaWebSocketConfig={systemConfig.alpha_websocket}
  initialSubscriptions={subscriptions}
  watchlists={watchlists}
 />
 );
}
