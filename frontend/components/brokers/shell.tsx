import "server-only";

import { redirect } from "next/navigation";
import { requireActiveWorkspace } from "@/lib/auth-guards";
import { WorkspaceShell } from "@/components/workspace-shell";
import { loadOnboardingSetupData } from "@/lib/onboarding-server";
import { firstIncompleteRequiredStep, getWorkspaceSetupReadiness, onboardingStepPath } from "@/lib/setup-readiness";

/** Authenticated app layout with server-side session and RBAC enforcement. */
export async function Shell({ children }: { children: React.ReactNode }) {
    const [principal, onboardingData] = await Promise.all([requireActiveWorkspace(), loadOnboardingSetupData()]);
    const readiness = getWorkspaceSetupReadiness(onboardingData.accounts, onboardingData.systemConfig);

    if (!readiness.requiredReady) {
        redirect(onboardingStepPath(firstIncompleteRequiredStep(readiness)));
    }

    return <WorkspaceShell principal={principal}>{children}</WorkspaceShell>;
}
