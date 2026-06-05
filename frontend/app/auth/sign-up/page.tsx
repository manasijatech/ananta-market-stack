import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function SignUpPage() {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (session?.user) {
        redirect("/dashboard");
    }

    return (
        <AuthShell
            eyebrow="Start secure"
            title="Create account"
            subtitle="Set up your email login before connecting broker APIs."
            footerText="Already have an account?"
            footerHref="/auth/sign-in"
            footerAction="Sign in"
        >
            <AuthForm mode="sign-up" />
        </AuthShell>
    );
}
