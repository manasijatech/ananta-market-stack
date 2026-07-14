import { WelcomeStep } from "@/components/onboarding/onboarding-forms";
import { requireOnboardingStep } from "@/lib/onboarding-server";

export default async function OnboardingWelcomePage() {
    await requireOnboardingStep("welcome");

    return <WelcomeStep />;
}
