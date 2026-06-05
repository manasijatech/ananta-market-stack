import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function SignInPage() {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (session?.user) {
        redirect("/dashboard");
    }

    return (
        <AuthShell
            eyebrow="Welcome back"
            title="Sign in"
            subtitle="Use your email and password to continue."
            footerText="New to Ananta Market Stack?"
            footerHref="/auth/sign-up"
            footerAction="Create an account"
        >
            <AuthForm mode="sign-in" />
        </AuthShell>
    );
}
