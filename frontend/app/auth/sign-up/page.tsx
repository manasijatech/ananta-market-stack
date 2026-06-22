import { AuthForm } from "@/components/auth-form";
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
    const signUpNotice = signupStatus.has_admin
        ? "An admin account already exists for this installation. New signups stay pending until an admin approves access."
        : "The first account created on this installation becomes the admin account. Later signups wait for admin approval before they can access broker data.";

    return (
        <AuthShell
            eyebrow="Start secure"
            title="Create account"
            subtitle="Set up your email login before connecting broker APIs."
            footerText="Already have an account?"
            footerHref="/auth/sign-in"
            footerAction="Sign in"
        >
            <AuthForm mode="sign-up" signUpNotice={signUpNotice} />
        </AuthShell>
    );
}
