import { AuthSignUpView } from "@/components/auth/auth-views";
import { AuthShell } from "@/components/auth-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSignupStatus } from "@/service/actions/rbac";

export default async function SignUpPage() {
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

    const signUpNotice =
        "An admin account already exists for this installation. New signups stay pending until an admin approves access.";

    return (
        <AuthShell>
            <AuthSignUpView signUpNotice={signUpNotice} />
        </AuthShell>
    );
}
