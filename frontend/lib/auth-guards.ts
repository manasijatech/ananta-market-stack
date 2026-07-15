import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";
import { getRbacMe } from "@/service/actions/rbac";
import type { RbacPrincipal } from "@/service/types/rbac";

/**
 * Returns the current Better Auth session or `null` when unauthenticated.
 */
export async function getServerSession() {
    return auth.api.getSession({
        headers: await headers()
    });
}

/**
 * Redirects unauthenticated visitors to the sign-in page.
 *
 * @returns The authenticated session (narrowed for TypeScript).
 */
export async function requireSession() {
    const session = await getServerSession();

    if (!session?.user) {
        redirect("/auth/sign-in");
    }

    return session;
}

/**
 * Redirects authenticated users to their RBAC-aware destination (`/broker-connections` or `/pending-approval`).
 * No-op when there is no session.
 */
export async function redirectIfAuthenticated(): Promise<void> {
    const session = await getServerSession();

    if (!session?.user) {
        return;
    }

    const route = await resolvePostAuthRoute().catch(() => "/pending-approval" as const);
    redirect(route);
}

/**
 * Ensures the caller has an active workspace principal.
 * Pending or disabled users are sent to `/pending-approval`.
 *
 * @returns RBAC principal when the workspace member is active.
 */
export async function requireActiveWorkspace(): Promise<RbacPrincipal> {
    await requireSession();

    try {
        const principal = await getRbacMe();

        if (principal.status !== "active") {
            redirect("/pending-approval");
        }

        return principal;
    } catch {
        redirect("/auth/sign-in");
    }
}
