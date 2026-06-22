"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { ChannelSettings } from "@/components/alerts/channel-settings";
import { StreamManager } from "@/components/alerts/stream-manager";
import { SubscriptionsManager } from "@/components/alerts/subscriptions-manager";
import { SystemConfigPanel } from "@/components/system/system-config-panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AlertChannel, LiveStreamsStatus, LiveSubscription } from "@/service/types/alerts";
import type { BrokerAccount, SystemConfig } from "@/service/types/broker";
import type { Watchlist } from "@/service/types/watchlist";

type SettingsSection =
    | "broker-data"
    | "alpha"
    | "mcp"
    | "llm"
    | "live-subscriptions"
    | "stream-manager"
    | "alert-channels"
    | "preferences";

type SettingsSectionsProps = {
    config: SystemConfig;
    permissions: {
        canManageAlpha: boolean;
        canManageLlm: boolean;
        canManageMcp: boolean;
        canUseMcp: boolean;
    };
    alertChannels: AlertChannel[];
    accounts: BrokerAccount[];
    subscriptions: LiveSubscription[];
    streamStatus: LiveStreamsStatus;
    symbolMetadata: ComponentProps<typeof SubscriptionsManager>["symbolMetadata"];
    watchlists: Watchlist[];
};

const sections: Array<{ value: SettingsSection; label: string; title: string; description: string }> = [
    {
        value: "broker-data",
        label: "Broker Data",
        title: "Broker data",
        description: "Choose the default broker account used for broker-backed data and symbol search."
    },
    {
        value: "alpha",
        label: "Alpha",
        title: "Manasija Alpha",
        description: "Manage the Alpha API key used for market intelligence and company data."
    },
    {
        value: "mcp",
        label: "MCP",
        title: "Hosted MCP servers",
        description: "Configure hosted MCP endpoints used by broker chat."
    },
    {
        value: "llm",
        label: "LLM",
        title: "LLM providers",
        description: "Store provider keys and saved model IDs for chat and alert analysis."
    },
    {
        value: "live-subscriptions",
        label: "Subscriptions",
        title: "Live data subscriptions",
        description: "Manage Alpha websocket products, symbol scope, watchlists, and reusable live subscriptions."
    },
    {
        value: "stream-manager",
        label: "Streams",
        title: "Stream manager",
        description: "Inspect live worker health, desired symbol subscriptions, and broker stream session state."
    },
    {
        value: "alert-channels",
        label: "Delivery",
        title: "Alert delivery channels",
        description: "Manage Discord and Telegram delivery credentials, defaults, and test sends."
    },
    {
        value: "preferences",
        label: "Preferences",
        title: "Preferences",
        description: "Reset lightweight workspace preferences stored in this browser."
    }
];

const ONBOARDING_STORAGE_KEY = "ananta-market-stack-joyride-broker-system-config-alpha-guide-v2-complete";
const ONBOARDING_PHASE_STORAGE_KEY = "ananta-market-stack-joyride-broker-system-config-alpha-guide-v2-phase";
const ONBOARDING_STEP_STORAGE_KEY = "ananta-market-stack-joyride-broker-system-config-alpha-guide-v2-step";
const ONBOARDING_RESET_EVENT = "ananta-market-stack-reset-onboarding";

function sectionFromHash(): SettingsSection {
    if (typeof window === "undefined") {
        return "broker-data";
    }
    const hash = window.location.hash.replace("#", "");
    return sections.some((section) => section.value === hash) ? (hash as SettingsSection) : "broker-data";
}

export function SettingsSections({
    config,
    permissions,
    alertChannels,
    accounts,
    subscriptions,
    streamStatus,
    symbolMetadata,
    watchlists
}: SettingsSectionsProps) {
    const visibleSections = useMemo(
        () => sections.filter((section) => section.value !== "mcp" || permissions.canUseMcp || permissions.canManageMcp),
        [permissions.canManageMcp, permissions.canUseMcp]
    );
    const [activeSection, setActiveSection] = useState<SettingsSection>("broker-data");

    useEffect(() => {
        const next = sectionFromHash();
        setActiveSection(visibleSections.some((section) => section.value === next) ? next : visibleSections[0]?.value ?? "broker-data");
        function handleHashChange() {
            const changed = sectionFromHash();
            setActiveSection(
                visibleSections.some((section) => section.value === changed) ? changed : visibleSections[0]?.value ?? "broker-data"
            );
        }
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, [visibleSections]);

    function changeSection(value: string) {
        const next = value as SettingsSection;
        setActiveSection(next);
        window.history.replaceState(null, "", `#${next}`);
    }

    function resetOnboardingTour() {
        localStorage.removeItem(ONBOARDING_STORAGE_KEY);
        localStorage.removeItem(ONBOARDING_PHASE_STORAGE_KEY);
        localStorage.removeItem(ONBOARDING_STEP_STORAGE_KEY);
        window.dispatchEvent(new Event(ONBOARDING_RESET_EVENT));
    }

    const activeMeta = visibleSections.find((section) => section.value === activeSection) ?? visibleSections[0] ?? sections[0];

    return (
        <Tabs className="min-w-0 max-w-full gap-5" onValueChange={changeSection} value={activeSection}>
            <div className="sticky top-0 z-10 min-w-0 max-w-full border-b border-border bg-background/95 pb-3 pt-1 backdrop-blur">
                <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
                    {visibleSections.map((section) => (
                        <TabsTrigger className="shrink-0" key={section.value} value={section.value}>
                            {section.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </div>

            <div className="grid min-w-0 max-w-full gap-1">
                <h2 className="text-xl font-semibold tracking-normal">{activeMeta.title}</h2>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{activeMeta.description}</p>
            </div>

            <TabsContent className="mt-0 min-w-0 max-w-full" value="broker-data">
                <SystemConfigPanel initialConfig={config} permissions={permissions} section="broker-data" />
            </TabsContent>
            <TabsContent className="mt-0 min-w-0 max-w-full" value="alpha">
                <SystemConfigPanel initialConfig={config} permissions={permissions} section="alpha" />
            </TabsContent>
            <TabsContent className="mt-0 min-w-0 max-w-full" value="mcp">
                <SystemConfigPanel initialConfig={config} permissions={permissions} section="mcp" />
            </TabsContent>
            <TabsContent className="mt-0 min-w-0 max-w-full" value="llm">
                <SystemConfigPanel initialConfig={config} permissions={permissions} section="llm" />
            </TabsContent>
            <TabsContent className="mt-0 min-w-0 max-w-full" value="live-subscriptions">
                <SubscriptionsManager
                    accounts={accounts}
                    alphaWebSocketConfig={config.alpha_websocket}
                    initialSubscriptions={subscriptions}
                    symbolMetadata={symbolMetadata}
                    watchlists={watchlists}
                />
            </TabsContent>
            <TabsContent className="mt-0 min-w-0 max-w-full" value="stream-manager">
                <StreamManager initialStatus={streamStatus} />
            </TabsContent>
            <TabsContent className="mt-0 min-w-0 max-w-full" value="alert-channels">
                <ChannelSettings initialChannels={alertChannels} />
            </TabsContent>
            <TabsContent className="mt-0 min-w-0 max-w-full" value="preferences">
                <section className="border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-bold">Onboarding tour</div>
                            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-muted-foreground">
                                Clear the saved tour completion flag in this browser and start the onboarding guide
                                again.
                            </p>
                        </div>
                        <Button onClick={resetOnboardingTour} type="button" variant="outline">
                            Restart tour
                        </Button>
                    </div>
                </section>
            </TabsContent>
        </Tabs>
    );
}
