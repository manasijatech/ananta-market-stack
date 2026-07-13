import { AuthResetPasswordView } from "@/components/auth/auth-views";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";

export default function ResetPasswordPage() {
    return (
        <AuthSplitLayout>
            <AuthResetPasswordView />
        </AuthSplitLayout>
    );
}
