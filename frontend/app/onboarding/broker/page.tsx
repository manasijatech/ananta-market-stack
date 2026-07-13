import { BrokerStep } from "@/components/onboarding/onboarding-forms";
import { requireOnboardingStep } from "@/lib/onboarding-server";

export default async function OnboardingBrokerPage() {
    const { data } = await requireOnboardingStep("broker");

    return <BrokerStep data={data} />;
}
