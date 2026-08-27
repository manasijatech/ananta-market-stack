"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { extractResetPasswordToken, resetPasswordPagePath } from "@/lib/auth-reset";
import { getDevPasswordResetLink } from "@/lib/dev-password-reset-links";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";

function formString(formData: FormData, key: string): string {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
}

function signInErrorRedirect(message: string): never {
    redirect(`/auth/sign-in?error=${encodeURIComponent(message)}`);
}

function forgotRedirect(query: string): never {
    redirect(`/auth/forgot-password?${query}`);
}

function resetRedirect(query: string): never {
    redirect(`/auth/reset-password?${query}`);
}

/**
 * Progressive-enhancement sign-in used when client JS does not hydrate.
 * Client forms still preventDefault and use the Better Auth mutation when JS works.
 */
export async function signInWithEmailAction(formData: FormData): Promise<void> {
    const email = formString(formData, "email");
    const password = formString(formData, "password");
    const rememberMe = formData.get("rememberMe") === "on";

    if (!email || !password) {
        signInErrorRedirect("Enter your email and password.");
    }

    try {
        await auth.api.signInEmail({
            body: { email, password, rememberMe },
            headers: await headers()
        });
    } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "Could not sign in.";
        signInErrorRedirect(message.includes("Invalid") ? "Invalid email or password." : "Could not sign in. Try again.");
    }

    const destination = await resolvePostAuthRoute().catch(() => "/broker-connections" as const);
    redirect(destination);
}

/** Request a reset link, then send local-dev users to the reset form with the token. */
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
    const email = formString(formData, "email");
    if (!email) {
        forgotRedirect("error=Enter+your+email.");
    }

    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "127.0.0.1:3004";
    const proto = headerList.get("x-forwarded-proto") ?? "http";
    const origin = `${proto}://${host}`;

    try {
        await auth.api.requestPasswordReset({
            body: {
                email,
                redirectTo: `${origin}/auth/reset-password`
            },
            headers: headerList
        });
    } catch {
        forgotRedirect(`email=${encodeURIComponent(email)}&sent=1`);
    }

    const storedUrl = getDevPasswordResetLink(email);
    const resetPath = storedUrl ? resetPasswordPagePath(storedUrl) : null;
    if (resetPath) {
        redirect(resetPath);
    }

    forgotRedirect(`email=${encodeURIComponent(email)}&sent=1`);
}

/** Apply a new password from the reset form, including no-JS POST submissions. */
export async function resetPasswordAction(formData: FormData): Promise<void> {
    const password = formString(formData, "password");
    const confirmPassword = formString(formData, "confirmPassword");
    const token =
        formString(formData, "token") ||
        extractResetPasswordToken(formString(formData, "resetUrl") || "");

    if (!token) {
        resetRedirect("error=This+reset+link+is+missing+or+expired.");
    }
    if (!password) {
        resetRedirect(`token=${encodeURIComponent(token)}&error=Enter+a+new+password.`);
    }
    if (confirmPassword && password !== confirmPassword) {
        resetRedirect(`token=${encodeURIComponent(token)}&error=Passwords+do+not+match.`);
    }

    try {
        await auth.api.resetPassword({
            body: { token, newPassword: password },
            headers: await headers()
        });
    } catch {
        resetRedirect(`token=${encodeURIComponent(token)}&error=This+reset+link+is+invalid+or+expired.`);
    }

    const destination = await resolvePostAuthRoute().catch(() => "/broker-connections" as const);
    redirect(destination);
}
