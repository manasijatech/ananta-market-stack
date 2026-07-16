"use server";

import { getRbacMe, getSignupStatus } from "@/service/actions/rbac";
import { getBrokerAccounts, getSystemConfig } from "@/service/actions/broker";
import { firstIncompleteRequiredStep, getWorkspaceSetupReadiness, onboardingStepPath, type OnboardingStepSlug } from "@/lib/setup-readiness";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Resolves the sign-in entry route before any admin exists.
 */
export async function getUnauthenticatedAuthRoute(): Promise<"/auth/onboarding" | "/auth/sign-in"> {
    const signupStatus = await getSignupStatus().catch(() => ({ has_admin: false }));
    return signupStatus.has_admin ? "/auth/sign-in" : "/auth/onboarding";
}

/**
 * Determines where an authenticated user should land after sign-in.
 *
 * Retries RBAC lookups with backoff so a freshly created account can propagate.
 *
 * @throws When RBAC cannot be verified after all retry attempts.
 */
export async function resolvePostAuthRoute(): Promise<"/broker-connections" | "/pending-approval" | `/onboarding/${OnboardingStepSlug}`> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
            const rbac = await getRbacMe();
            if (rbac.status !== "active") {
                return "/pending-approval";
            }
            if (!rbac.is_admin) {
                return "/broker-connections";
            }
            const [accounts, systemConfig] = await Promise.all([getBrokerAccounts(), getSystemConfig()]);
            const readiness = getWorkspaceSetupReadiness(accounts, systemConfig);
            return readiness.requiredReady ? "/broker-connections" : onboardingStepPath(firstIncompleteRequiredStep(readiness));
        } catch (error) {
            lastError = error instanceof Error ? error : new Error("Could not verify workspace access.");
            if (attempt < MAX_ATTEMPTS - 1) {
                await delay(BASE_DELAY_MS * (attempt + 1));
            }
        }
    }

    throw (
        lastError ??
        new Error(
            "Could not verify workspace access. Confirm the backend API is running and NEXT_PUBLIC_API_BASE_URL matches your backend port."
        )
    );
}
