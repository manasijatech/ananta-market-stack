"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import {
    IconBellRinging,
    IconDatabase,
    IconKey,
    IconPlugConnected,
    IconRadio,
    IconRobot,
    IconSettings2
} from "@tabler/icons-react";
import type { TablerIcon } from "@tabler/icons-react";
import { ChannelSettings } from "@/components/alerts/channel-settings";
import { StreamManager } from "@/components/alerts/stream-manager";
import { SubscriptionsManager } from "@/components/alerts/subscriptions-manager";
import { SystemConfigPanel } from "@/components/system/system-config-panel";
import { PageContainer } from "@/components/ui/page-container";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { OpenRouterModel } from "@/service/actions/llm-models";
import type { AlertChannel, DesktopAudioDevice, LiveStreamsStatus, LiveSubscription } from "@/service/types/alerts";
import type { BrokerAccount, SystemConfig } from "@/service/types/broker";
import type { Watchlist } from "@/service/types/watchlist";

type SettingsSection =
    | "broker-data"
    | "alpha"
    | "mcp"
    | "llm"
    | "live-subscriptions"
    | "stream-manager"
    | "alert-channels";

type SettingsSectionsProps = {
    config: SystemConfig;
    permissions: {
        canManageAlpha: boolean;
        canManageLlm: boolean;
        canManageMcp: boolean;
        canUseMcp: boolean;
    };
    alertChannels: AlertChannel[];
    desktopAudioDevices: DesktopAudioDevice[];
    accounts: BrokerAccount[];
    subscriptions: LiveSubscription[];
    streamStatus: LiveStreamsStatus;
    symbolMetadata: ComponentProps<typeof SubscriptionsManager>["symbolMetadata"];
    watchlists: Watchlist[];
    openRouterModels: OpenRouterModel[];
};

const sections: Array<{
    value: SettingsSection;
    label: string;
    title: string;
    description: string;
    group: "Workspace" | "Live Data" | "Developer";
    icon: TablerIcon;
}> = [
    {
        value: "broker-data",
        label: "Broker Data",
        title: "Broker data",
        description: "Choose the default broker account used for broker-backed data and symbol search.",
        group: "Workspace",
        icon: IconDatabase
    },
    {
        value: "alpha",
        label: "Drishti",
        title: "Drishti",
        description: "Manage the Drishti API key used for market intelligence and company data.",
        group: "Workspace",
        icon: IconKey
    },
    {
        value: "mcp",
        label: "MCP",
        title: "Hosted MCP servers",
        description: "Configure hosted MCP endpoints used by broker chat.",
        group: "Developer",
        icon: IconPlugConnected
    },
    {
        value: "llm",
        label: "LLM",
        title: "LLM providers",
        description: "Store provider keys and saved model IDs for chat and alert analysis.",
        group: "Developer",
        icon: IconRobot
    },
    {
        value: "live-subscriptions",
        label: "Subscriptions",
        title: "Live data subscriptions",
        description: "Manage Drishti websocket products, symbol scope, watchlists, and reusable live subscriptions.",
        group: "Live Data",
        icon: IconRadio
    },
    {
        value: "stream-manager",
        label: "Streams",
        title: "Stream manager",
        description: "Inspect live worker health, desired symbol subscriptions, and broker stream session state.",
        group: "Live Data",
        icon: IconSettings2
    },
    {
        value: "alert-channels",
        label: "Delivery",
        title: "Alert delivery channels",
        description: "Manage desktop audio, Discord, and Telegram delivery credentials, defaults, and test sends.",
        group: "Live Data",
        icon: IconBellRinging
    }
];

const sectionGroups: Array<(typeof sections)[number]["group"]> = ["Workspace", "Live Data", "Developer"];

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
    desktopAudioDevices,
    accounts,
    subscriptions,
    streamStatus,
    symbolMetadata,
    watchlists,
    openRouterModels
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

    const activeMeta = visibleSections.find((section) => section.value === activeSection) ?? visibleSections[0] ?? sections[0];

    return (
        <Tabs
            className="settings-neutral-surface -mx-3 -mb-6 -mt-[calc(3.75rem+env(safe-area-inset-top))] min-h-[calc(100vh-3.75rem)] min-w-0 gap-0 overflow-hidden bg-muted/30 sm:-mx-4 sm:-mt-[calc(4.5rem+env(safe-area-inset-top))] sm:min-h-[calc(100vh-4.5rem)] min-[760px]:-mx-8 min-[980px]:my-0 min-[980px]:h-full min-[980px]:min-h-0"
            onValueChange={changeSection}
            value={activeSection}
        >
            <div className="flex h-16 shrink-0 items-center border-b border-border bg-muted px-5 min-[760px]:px-10">
                <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
            </div>

            <div className="grid min-h-0 min-w-0 flex-1 min-[1040px]:grid-cols-[20rem_minmax(0,1fr)]">
                <aside className="min-h-full self-stretch border-b border-border bg-muted/60 min-[1040px]:border-b-0 min-[1040px]:border-r">
                    <div className="flex min-h-full flex-col px-5 py-8 min-[760px]:px-10 min-[1040px]:h-full min-[1040px]:overflow-y-auto">
                        <TabsList className="hidden w-full flex-col items-stretch justify-start gap-5 bg-transparent p-0 text-left min-[1040px]:flex">
                            {sectionGroups.map((group) => {
                                const groupSections = visibleSections.filter((section) => section.group === group);
                                if (!groupSections.length) return null;
                                return (
                                    <div className="flex w-full flex-col gap-1" key={group}>
                                        <div className="px-2 pb-1 text-sm font-semibold text-muted-foreground">
                                            {group}
                                        </div>
                                        {groupSections.map((section) => {
                                            const Icon = section.icon;
                                            return (
                                                <TabsTrigger
                                                    className={cn(
                                                        "h-9 w-full justify-start rounded-md px-2 text-sm font-normal text-muted-foreground",
                                                        "data-active:bg-accent data-active:font-semibold data-active:text-foreground"
                                                    )}
                                                    key={section.value}
                                                    value={section.value}
                                                >
                                                    <Icon stroke={1.8} />
                                                    {section.label}
                                                </TabsTrigger>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </TabsList>

                        <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden min-[1040px]:hidden">
                            {visibleSections.map((section) => (
                                <TabsTrigger className="shrink-0" key={section.value} value={section.value}>
                                    {section.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>
                </aside>

                <section className="min-h-0 min-w-0 overflow-y-auto bg-accent/20">
                    <div className="min-w-0 px-5 py-8 min-[760px]:px-10">
                        <PageContainer className="mx-0 grid gap-7">
                            <div>
                                <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
                                    {activeMeta.title}
                                </h2>
                                <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
                                    {activeMeta.description}
                                </p>
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
                                <SystemConfigPanel
                                    initialConfig={config}
                                    openRouterModels={openRouterModels}
                                    permissions={permissions}
                                    section="llm"
                                />
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
                                <ChannelSettings initialChannels={alertChannels} initialDesktopAudioDevices={desktopAudioDevices} />
                            </TabsContent>
                        </PageContainer>
                    </div>
                </section>
            </div>
        </Tabs>
    );
}
