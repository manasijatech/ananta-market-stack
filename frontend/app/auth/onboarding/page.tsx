import { AuthOnboardingView } from "@/components/auth/auth-views";
import { OnboardingShell } from "@/components/auth/onboarding-shell";
import { redirect } from "next/navigation";
import { redirectIfAuthenticated } from "@/lib/auth-guards";
import { getSignupStatus } from "@/service/actions/rbac";

export default async function OnboardingPage() {
    await redirectIfAuthenticated();

    const signupStatus = await getSignupStatus().catch(() => ({ has_admin: false }));

    if (signupStatus.has_admin) {
        redirect("/auth/sign-in");
    }

    return (
        <OnboardingShell>
            <AuthOnboardingView />
        </OnboardingShell>
    );
}
