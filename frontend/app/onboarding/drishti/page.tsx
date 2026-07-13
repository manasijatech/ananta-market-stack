import { DrishtiStep } from "@/components/onboarding/onboarding-forms";
import { requireOnboardingStep } from "@/lib/onboarding-server";

export default async function OnboardingDrishtiPage() {
    const { data } = await requireOnboardingStep("drishti");

    if (!data.systemConfig) {
        return null;
    }

    return <DrishtiStep config={data.systemConfig} />;
}
