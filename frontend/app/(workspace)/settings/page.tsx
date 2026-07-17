import { hasRbacPermission } from "@/lib/rbac";
import { parseActionError } from "@/components/brokers/action-error";
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
        configResult,
        alertChannelsResult,
        desktopAudioDevicesResult,
        accountsResult,
        subscriptionsResult,
        streamStatusResult,
        watchlistsResult,
        openRouterModelsResult
    ] = await Promise.allSettled([
        getSystemConfig(),
        getAlertChannels(),
        getDesktopAudioDevices(),
        getBrokerAccounts(),
        getLiveSubscriptions(),
        getLiveStreamsStatus(),
        getWatchlists(),
        getOpenRouterModels()
    ]);

    if (configResult.status === "rejected") {
        return (
            <div className="grid w-full min-w-0 gap-5 px-5 py-5">
                <h1 className="font-heading text-3xl font-semibold tracking-tight">Settings</h1>
                <Alert variant="warning">
                    <AlertDescription>
                        Settings configuration is temporarily unavailable. Other workspace pages remain available.{" "}
                        {parseActionError(configResult.reason).message}
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const unavailableSections = [
        alertChannelsResult.status === "rejected" ? "alert channels" : "",
        desktopAudioDevicesResult.status === "rejected" ? "desktop audio devices" : "",
        accountsResult.status === "rejected" ? "broker accounts" : "",
        subscriptionsResult.status === "rejected" ? "live subscriptions" : "",
        streamStatusResult.status === "rejected" ? "stream status" : "",
        watchlistsResult.status === "rejected" ? "watchlists" : "",
        openRouterModelsResult.status === "rejected" ? "OpenRouter models" : ""
    ].filter(Boolean);

    const config = configResult.value;
    const alertChannels = alertChannelsResult.status === "fulfilled" ? alertChannelsResult.value : [];
    const desktopAudioDevices =
        desktopAudioDevicesResult.status === "fulfilled" ? desktopAudioDevicesResult.value : [];
    const accounts = accountsResult.status === "fulfilled" ? accountsResult.value : [];
    const subscriptions = subscriptionsResult.status === "fulfilled" ? subscriptionsResult.value : [];
    const streamStatus =
        streamStatusResult.status === "fulfilled"
            ? streamStatusResult.value
            : {
                  redis_ok: false,
                  redis_error: "Stream status is temporarily unavailable.",
                  worker_mode: "unavailable",
                  active_sessions: [],
                  desired_subscriptions: [],
                  inactive_subscriptions: [],
                  broker_statuses: []
              };
    const watchlists = watchlistsResult.status === "fulfilled" ? watchlistsResult.value : [];
    const openRouterModels = openRouterModelsResult.status === "fulfilled" ? openRouterModelsResult.value : [];

    return (
        <>
            <div className="h-full w-full min-w-0">
                {unavailableSections.length ? (
                    <div className="px-5 pt-5">
                        <Alert variant="warning">
                            <AlertDescription>
                                Some optional settings data is temporarily unavailable ({unavailableSections.join(", ")}).
                                Available sections can still be used.
                            </AlertDescription>
                        </Alert>
                    </div>
                ) : null}
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
