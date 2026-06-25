import { AuthSignInView } from "@/components/auth/auth-views";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSignupStatus } from "@/service/actions/rbac";

export default async function SignInPage() {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (session?.user) {
        redirect("/dashboard");
    }

    const signupStatus = await getSignupStatus().catch(() => ({ has_admin: false }));

    if (!signupStatus.has_admin) {
        redirect("/auth/onboarding");
    }

    return (
        <AuthSplitLayout>
            <AuthSignInView />
        </AuthSplitLayout>
    );
}
