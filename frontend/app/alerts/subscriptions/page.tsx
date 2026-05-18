import { SubscriptionsManager } from "@/components/alerts/subscriptions-manager";
import { getLiveSubscriptions } from "@/service/actions/alerts";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";

export default async function AlertSubscriptionsPage() {
 const [accounts, subscriptions, watchlists, systemConfig] = await Promise.all([
  getBrokerAccounts(),
  getLiveSubscriptions(),
  getWatchlists(),
  getSystemConfig()
 ]);
 const metadataRows = await getAlphaSymbolMetadata(subscriptions.map((item) => item.symbol)).catch(() => []);
 const symbolMetadata = Object.fromEntries(metadataRows.map((item) => [item.symbol.toUpperCase(), item]));

 return (
 <SubscriptionsManager
  accounts={accounts}
  alphaWebSocketConfig={systemConfig.alpha_websocket}
  initialSubscriptions={subscriptions}
  symbolMetadata={symbolMetadata}
  watchlists={watchlists}
 />
 );
}
