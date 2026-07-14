import { LlmProviderStep } from "@/components/onboarding/onboarding-forms";
import { requireOnboardingStep } from "@/lib/onboarding-server";

export default async function OnboardingLlmProviderPage() {
    const { data } = await requireOnboardingStep("llm-provider");

    if (!data.systemConfig) {
        return null;
    }

    return <LlmProviderStep config={data.systemConfig} />;
}
