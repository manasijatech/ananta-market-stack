import { McpStep } from "@/components/onboarding/onboarding-forms";
import { requireOnboardingStep } from "@/lib/onboarding-server";

export default async function OnboardingMcpPage() {
    await requireOnboardingStep("mcp");

    return <McpStep />;
}
