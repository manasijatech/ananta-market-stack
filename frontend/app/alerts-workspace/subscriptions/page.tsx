import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { SubscriptionsManager } from "@/components/alerts/subscriptions-manager";
import { getLiveSubscriptions } from "@/service/actions/alerts";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";
import { getAlphaCreditWarningMessage } from "@/lib/alpha-credit-warning";

export default async function AlertSubscriptionsPage() {
    const [accounts, subscriptions, watchlists, systemConfig] = await Promise.all([
        getBrokerAccounts(),
        getLiveSubscriptions(),
        getWatchlists(),
        getSystemConfig()
    ]);
    let creditWarningMessage: string | null = null;
    const metadataRows = await getAlphaSymbolMetadata(subscriptions.map((item) => item.symbol)).catch((caught) => {
        creditWarningMessage = getAlphaCreditWarningMessage(caught);
        return [];
    });
    const symbolMetadata = Object.fromEntries(metadataRows.map((item) => [item.symbol.toUpperCase(), item]));

    return (
        <>
            <AlphaCreditWarningTrigger message={creditWarningMessage} />
            <SubscriptionsManager
                accounts={accounts}
                alphaWebSocketConfig={systemConfig.alpha_websocket}
                initialSubscriptions={subscriptions}
                symbolMetadata={symbolMetadata}
                watchlists={watchlists}
            />
        </>
    );
}
