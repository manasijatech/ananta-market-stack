import "server-only";

import { redirect } from "next/navigation";
import { requireActiveWorkspace } from "@/lib/auth-guards";
import {
    firstIncompleteRequiredStep,
    getWorkspaceSetupReadiness,
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

    if (step === "welcome") {
        if (readiness.requiredReady) {
            redirect(onboardingStepPath("mcp"));
        }
        return context;
    }

    if (step === "mcp") {
        if (!readiness.requiredReady) {
            redirect(onboardingStepPath(firstIncompleteRequiredStep(readiness)));
        }
        return context;
    }

    if (!readiness.hasBroker && step !== "broker") {
        redirect(onboardingStepPath("broker"));
    }
    if (readiness.hasBroker && !readiness.alphaReady && step !== "drishti") {
        redirect(onboardingStepPath("drishti"));
    }
    if (readiness.hasBroker && readiness.alphaReady && !readiness.llmReady && step !== "llm-provider") {
        redirect(onboardingStepPath("llm-provider"));
    }
    if (readiness.requiredReady) {
        redirect(onboardingStepPath("mcp"));
    }

    return context;
}
