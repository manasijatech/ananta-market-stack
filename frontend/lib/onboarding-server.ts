import "server-only";

import { redirect } from "next/navigation";
import { requireActiveWorkspace } from "@/lib/auth-guards";
import {
    firstIncompleteRequiredStep,
    getWorkspaceSetupReadiness,
    isOnboardingStepReachable,
    onboardingStepPath,
    type OnboardingSetupData,
    type OnboardingStepSlug
} from "@/lib/setup-readiness";
import { getBrokerAccounts, getSupportedBrokers, getSystemConfig } from "@/service/actions/broker";
import type { BrokerAccount, BrokerCode, SystemConfig } from "@/service/types/broker";

export async function loadOnboardingSetupData(): Promise<OnboardingSetupData> {
    const [accounts, systemConfig, supportedBrokers] = await Promise.allSettled([
        getBrokerAccounts(),
        getSystemConfig(),
        getSupportedBrokers()
    ]);

    return {
        accounts: accounts.status === "fulfilled" ? accounts.value : ([] as BrokerAccount[]),
        systemConfig: systemConfig.status === "fulfilled" ? systemConfig.value : (null as SystemConfig | null),
        supportedBrokers: supportedBrokers.status === "fulfilled" ? supportedBrokers.value : ([] as BrokerCode[])
    };
}

export async function loadOnboardingContext() {
    const [principal, data] = await Promise.all([requireActiveWorkspace(), loadOnboardingSetupData()]);
    if (!principal.is_admin) {
        redirect("/broker-connections");
    }
    const readiness = getWorkspaceSetupReadiness(data.accounts, data.systemConfig);

    return { principal, data, readiness };
}

export async function redirectIfWorkspaceSetupIncomplete(): Promise<void> {
    const { readiness } = await loadOnboardingContext();

    if (!readiness.requiredReady) {
        redirect(onboardingStepPath(firstIncompleteRequiredStep(readiness)));
    }
}

export async function requireOnboardingStep(step: OnboardingStepSlug) {
    const context = await loadOnboardingContext();
    const { readiness } = context;

    if (!isOnboardingStepReachable(step, readiness)) {
        const currentStep = readiness.requiredReady ? "mcp" : firstIncompleteRequiredStep(readiness);
        redirect(onboardingStepPath(currentStep));
    }

    return context;
}
