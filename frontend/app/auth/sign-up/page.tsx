import { AuthSignUpView } from "@/components/auth/auth-views";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { redirect } from "next/navigation";
import { redirectIfAuthenticated } from "@/lib/auth-guards";
import { getSignupStatus } from "@/service/actions/rbac";

export default async function SignUpPage() {
    await redirectIfAuthenticated();

    const signupStatus = await getSignupStatus().catch(() => ({ has_admin: false }));

    if (!signupStatus.has_admin) {
        redirect("/auth/onboarding");
    }

    return (
        <AuthSplitLayout panel="approval">
            <AuthSignUpView />
        </AuthSplitLayout>
    );
}
