"use client";

import { SignInForm } from "@/components/auth/sign-in-form";
import { AccessRequestForm } from "@/components/auth/access-request-form";
import { OnboardingSetupForm } from "@/components/auth/onboarding-setup-form";

export function AuthSignInView() {
    return <SignInForm />;
}

export function AuthSignUpView() {
    return <AccessRequestForm />;
}

export function AuthOnboardingView() {
    return <OnboardingSetupForm />;
}
