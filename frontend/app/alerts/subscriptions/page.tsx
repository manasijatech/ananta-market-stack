import { AlertsNav } from "@/components/alerts/alerts-nav";
import { SubscriptionsManager } from "@/components/alerts/subscriptions-manager";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getLiveSubscriptions } from "@/service/actions/alerts";
import { getBrokerAccounts } from "@/service/actions/broker";

export default async function AlertSubscriptionsPage() {
  const [accounts, subscriptions] = await Promise.all([getBrokerAccounts(), getLiveSubscriptions()]);

  return (
    <Shell>
      <PageHeader
        eyebrow="Alerts workspace"
        title="Subscribed symbols"
        description="Manage reusable symbol subscriptions that feed workflows and live data consumers."
      />
      <AlertsNav />
      <SubscriptionsManager accounts={accounts} initialSubscriptions={subscriptions} />
    </Shell>
  );
}
