import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingContext } from "@/lib/onboarding-server";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
    const { readiness } = await loadOnboardingContext();

    return <OnboardingShell readiness={readiness}>{children}</OnboardingShell>;
}
