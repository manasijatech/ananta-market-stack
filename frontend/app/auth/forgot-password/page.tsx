import { AuthForgotPasswordView } from "@/components/auth/auth-views";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { redirectIfAuthenticated } from "@/lib/auth-guards";

export default async function ForgotPasswordPage() {
    await redirectIfAuthenticated();

    return (
        <AuthSplitLayout>
            <AuthForgotPasswordView />
        </AuthSplitLayout>
    );
}
