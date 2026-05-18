import { ChannelSettings } from "@/components/alerts/channel-settings";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getAlertChannels } from "@/service/actions/alerts";

export default async function AlertChannelsPage() {
  const channels = await getAlertChannels();

  return (
    <Shell>
      <div className="max-w-4xl">
        <PageHeader
          eyebrow="Alert delivery"
          title="Alert Channels"
          description="Manage optional Discord and Telegram delivery credentials, choose defaults, and test each channel independently."
        />
        <ChannelSettings initialChannels={channels} />
      </div>
    </Shell>
  );
}
