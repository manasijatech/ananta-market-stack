import { hasRbacPermission } from "@/lib/rbac";
import { SettingsSections } from "@/components/settings/settings-sections";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getAlertChannels, getDesktopAudioDevices, getLiveStreamsStatus, getLiveSubscriptions } from "@/service/actions/alerts";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { getOpenRouterModels } from "@/service/actions/llm-models";
import { getRbacMe } from "@/service/actions/rbac";
import { getWatchlists } from "@/service/actions/watchlist";

export default async function SettingsPage() {
    const principal = await getRbacMe().catch(() => null);

    if (!principal || principal.status !== "active") {
        return (
            <>
                <div className="grid w-full min-w-0 gap-5">
                    <div className="border-b border-border bg-background px-5 py-5">
                        <p className="text-sm font-medium text-muted-foreground">Workspace</p>
                        <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight">Settings</h1>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Workspace settings become available after an admin approves this account.
                        </p>
                    </div>
                    <Alert variant="warning">
                        <AlertDescription>
                            Your account is pending admin approval. You can continue after an active admin approves your access.
                        </AlertDescription>
                    </Alert>
                </div>
            </>
        );
    }

    const [
        config,
        alertChannels,
        desktopAudioDevices,
        accounts,
        subscriptions,
        streamStatus,
        watchlists,
        openRouterModels
    ] = await Promise.all([
        getSystemConfig(),
        getAlertChannels(),
        getDesktopAudioDevices().catch(() => []),
        getBrokerAccounts(),
        getLiveSubscriptions(),
        getLiveStreamsStatus(),
        getWatchlists(),
        getOpenRouterModels()
    ]);
    return (
        <>
            <div className="h-full w-full min-w-0">
                <SettingsSections
                    accounts={accounts}
                    alertChannels={alertChannels}
                    desktopAudioDevices={desktopAudioDevices}
                    config={config}
                    openRouterModels={openRouterModels}
                    permissions={{
                        canManageAlpha: hasRbacPermission(principal, "settings.manage_alpha"),
                        canManageLlm: hasRbacPermission(principal, "settings.manage_llm"),
                        canManageMcp: hasRbacPermission(principal, "settings.manage_mcp"),
                        canUseMcp: hasRbacPermission(principal, "settings.use_mcp")
                    }}
                    streamStatus={streamStatus}
                    subscriptions={subscriptions}
                    symbolMetadata={{}}
                    watchlists={watchlists}
                />
            </div>
        </>
    );
}
