"use client";

import { SignIn } from "@/components/auth/sign-in";
import { SignUp } from "@/components/auth/sign-up";
import { OnboardingSetupForm } from "@/components/auth/onboarding-setup-form";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function AuthSignInView() {
    return <SignIn />;
}

export function AuthSignUpView({ signUpNotice }: { signUpNotice?: string | null }) {
    return (
        <div className="flex flex-col gap-6">
            {signUpNotice ? (
                <Alert>
                    <AlertDescription>{signUpNotice}</AlertDescription>
                </Alert>
            ) : null}
            <SignUp />
        </div>
    );
}

export function AuthOnboardingView() {
    return <OnboardingSetupForm />;
}
