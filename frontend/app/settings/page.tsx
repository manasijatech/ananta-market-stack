import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { SettingsSections } from "@/components/settings/settings-sections";
import { getAlphaCreditWarningMessage } from "@/lib/alpha-credit-warning";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getAlertChannels, getLiveStreamsStatus, getLiveSubscriptions } from "@/service/actions/alerts";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";

export default async function SettingsPage() {
    const [config, alertChannels, accounts, subscriptions, streamStatus, watchlists] = await Promise.all([
        getSystemConfig(),
        getAlertChannels(),
        getBrokerAccounts(),
        getLiveSubscriptions(),
        getLiveStreamsStatus(),
        getWatchlists()
    ]);
    let creditWarningMessage: string | null = null;
    const metadataRows = await getAlphaSymbolMetadata(subscriptions.map((item) => item.symbol)).catch((caught) => {
        creditWarningMessage = getAlphaCreditWarningMessage(caught);
        return [];
    });
    const symbolMetadata = Object.fromEntries(metadataRows.map((item) => [item.symbol.toUpperCase(), item]));

    return (
        <Shell>
            <AlphaCreditWarningTrigger message={creditWarningMessage} />
            <div className="grid w-full max-w-5xl min-w-0 gap-8">
                <PageHeader
                    eyebrow="Workspace"
                    title="Settings"
                    description="Manage broker data, live subscriptions, stream operations, alert delivery, encrypted provider credentials, and saved provider models."
                />
                <SettingsSections
                    accounts={accounts}
                    alertChannels={alertChannels}
                    config={config}
                    streamStatus={streamStatus}
                    subscriptions={subscriptions}
                    symbolMetadata={symbolMetadata}
                    watchlists={watchlists}
                />
            </div>
        </Shell>
    );
}
