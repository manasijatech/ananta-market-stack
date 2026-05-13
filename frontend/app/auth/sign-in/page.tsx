import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export default function SignInPage() {
 return (
 <AuthShell
 eyebrow="Welcome back"
 title="Sign in"
 subtitle="Use your email and password to continue."
 footerText="New to Market Stack?"
 footerHref="/auth/sign-up"
 footerAction="Create an account"
 >
 <AuthForm mode="sign-in" />
 </AuthShell>
 );
}
