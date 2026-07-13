import { AlphaCreditWarningTrigger } from "@/components/alpha/alpha-credit-warning-modal";
import { PageHeader } from "@/components/brokers/ui";
import { hasRbacPermission } from "@/lib/rbac";
import { SettingsSections } from "@/components/settings/settings-sections";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getAlphaCreditWarningMessage } from "@/lib/alpha-credit-warning";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import { getAlertChannels, getLiveStreamsStatus, getLiveSubscriptions } from "@/service/actions/alerts";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getRbacMe } from "@/service/actions/rbac";
import { getWatchlists } from "@/service/actions/watchlist";

export default async function SettingsPage() {
    const principal = await getRbacMe().catch(() => null);

    if (!principal || principal.status !== "active") {
        return (
            <>
                <div className="grid w-full max-w-5xl min-w-0 gap-8">
                    <PageHeader
                        eyebrow="Workspace"
                        title="Settings"
                        description="Workspace settings become available after an admin approves this account."
                    />
                    <Alert variant="warning">
                        <AlertDescription>
                            Your account is pending admin approval. You can continue after an active admin approves your access.
                        </AlertDescription>
                    </Alert>
                </div>
            </>
        );
    }

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
        <>
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
                    permissions={{
                        canManageAlpha: hasRbacPermission(principal, "settings.manage_alpha"),
                        canManageLlm: hasRbacPermission(principal, "settings.manage_llm"),
                        canManageMcp: hasRbacPermission(principal, "settings.manage_mcp"),
                        canUseMcp: hasRbacPermission(principal, "settings.use_mcp")
                    }}
                    streamStatus={streamStatus}
                    subscriptions={subscriptions}
                    symbolMetadata={symbolMetadata}
                    watchlists={watchlists}
                />
            </div>
        </>
    );
}
