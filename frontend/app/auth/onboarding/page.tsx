import { AuthOnboardingView } from "@/components/auth/auth-views";
import { OnboardingShell } from "@/components/auth/onboarding-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSignupStatus } from "@/service/actions/rbac";

export default async function OnboardingPage() {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (session?.user) {
        redirect("/dashboard");
    }

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
