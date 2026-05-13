import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export default function SignUpPage() {
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
