"use server";

import { getRbacMe, getSignupStatus } from "@/service/actions/rbac";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function getUnauthenticatedAuthRoute(): Promise<"/auth/onboarding" | "/auth/sign-in"> {
    const signupStatus = await getSignupStatus().catch(() => ({ has_admin: false }));
    return signupStatus.has_admin ? "/auth/sign-in" : "/auth/onboarding";
}

export async function resolvePostAuthRoute(): Promise<"/dashboard" | "/pending-approval"> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
            const rbac = await getRbacMe();
            return rbac.status === "active" ? "/dashboard" : "/pending-approval";
        } catch (error) {
            lastError = error instanceof Error ? error : new Error("Could not verify workspace access.");
            if (attempt < MAX_ATTEMPTS - 1) {
                await delay(BASE_DELAY_MS * (attempt + 1));
            }
        }
    }

    throw (
        lastError ??
        new Error(
            "Could not verify workspace access. Confirm the backend API is running and NEXT_PUBLIC_API_BASE_URL matches your backend port."
        )
    );
}
