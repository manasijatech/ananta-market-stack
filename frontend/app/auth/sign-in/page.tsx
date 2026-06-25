import { AuthSignInView } from "@/components/auth/auth-views";
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
        <AuthShell>
            <AuthSignInView />
        </AuthShell>
    );
}
