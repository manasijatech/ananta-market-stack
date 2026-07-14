"use client";

import { SignInForm } from "@/components/auth/sign-in-form";
import { AccessRequestForm } from "@/components/auth/access-request-form";
import { ForgotPassword } from "@/components/auth/forgot-password";
import { OnboardingSetupForm } from "@/components/auth/onboarding-setup-form";
import { ResetPassword } from "@/components/auth/reset-password";

export function AuthSignInView() {
    return <SignInForm />;
}

export function AuthSignUpView() {
    return <AccessRequestForm />;
}

export function AuthForgotPasswordView() {
    return <ForgotPassword />;
}

export function AuthResetPasswordView() {
    return <ResetPassword />;
}

export function AuthOnboardingView() {
    return <OnboardingSetupForm />;
}
