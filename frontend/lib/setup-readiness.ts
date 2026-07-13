import type { BrokerAccount, SystemConfig } from "@/service/types/broker";

export type OnboardingStepSlug = "welcome" | "broker" | "drishti" | "llm-provider" | "mcp";

export type WorkspaceSetupReadiness = {
    hasBroker: boolean;
    alphaReady: boolean;
    llmReady: boolean;
    mcpReady: boolean;
    requiredReady: boolean;
    llmProviders: SystemConfig["llm_providers"];
    mcpServers: SystemConfig["mcp_servers"];
};

export type OnboardingSetupData = {
    accounts: BrokerAccount[];
    systemConfig: SystemConfig | null;
    supportedBrokers: Array<BrokerAccount["broker_code"]>;
};

export function getWorkspaceSetupReadiness(
    accounts: BrokerAccount[],
    config: SystemConfig | null
): WorkspaceSetupReadiness {
    const llmProviders = config?.llm_providers.filter((provider) => provider.is_enabled && provider.has_api_key) ?? [];
    const alphaReady = Boolean(config?.alpha_api.is_enabled && config.alpha_api.has_api_key);
    const mcpServers = config
        ? [config.mcp_server, ...config.mcp_servers].filter(
              (server) => server.is_enabled && (server.oauth_authenticated || server.has_api_key)
          )
        : [];
    const hasBroker = accounts.length > 0;
    const llmReady = llmProviders.length > 0;
    const mcpReady = mcpServers.length > 0;

    return {
        hasBroker,
        alphaReady,
        llmReady,
        mcpReady,
        requiredReady: hasBroker && alphaReady && llmReady,
        llmProviders,
        mcpServers
    };
}

export function firstIncompleteRequiredStep(readiness: WorkspaceSetupReadiness): Exclude<OnboardingStepSlug, "welcome" | "mcp"> {
    if (!readiness.hasBroker) {
        return "broker";
    }
    if (!readiness.alphaReady) {
        return "drishti";
    }
    return "llm-provider";
}

export function onboardingStepPath(step: OnboardingStepSlug): `/onboarding/${OnboardingStepSlug}` {
    return `/onboarding/${step}`;
}
