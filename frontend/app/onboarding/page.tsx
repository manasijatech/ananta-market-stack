import { redirect } from "next/navigation";
import { onboardingStepPath } from "@/lib/setup-readiness";
import { loadOnboardingContext } from "@/lib/onboarding-server";

export default async function OnboardingIndexPage() {
    const { readiness } = await loadOnboardingContext();

    redirect(readiness.requiredReady ? "/dashboard" : onboardingStepPath("welcome"));
}
