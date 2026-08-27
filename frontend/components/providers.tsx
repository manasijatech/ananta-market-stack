"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEventHandler, ReactNode } from "react";
import { useCallback } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth-client";
import { getQueryClient } from "@/lib/query-client";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";

const postAuthTargets = new Set(["/", "/broker-connections"]);

function AuthLink({
    href,
    to,
    children,
    ...props
}: {
    href?: string;
    to?: string;
    children?: ReactNode;
    className?: string;
    "aria-disabled"?: boolean | "true" | "false";
    tabIndex?: number;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
    return (
        <Link href={href || to || "/"} {...props}>
            {children}
        </Link>
    );
}

async function destinationAfterAuth(fallback: string): Promise<string> {
    try {
        return await resolvePostAuthRoute();
    } catch {
        return fallback;
    }
}

export function Providers({ children }: { children: ReactNode }) {
    const router = useRouter();
    const queryClient = getQueryClient();

    const navigate = useCallback(
        ({ to, replace }: { to: string; replace?: boolean }) => {
            void (async () => {
                const destination = postAuthTargets.has(to)
                    ? await destinationAfterAuth("/broker-connections")
                    : to;

                if (
                    postAuthTargets.has(to) ||
                    destination.startsWith("/onboarding") ||
                    destination === "/pending-approval"
                ) {
                    window.location.assign(destination);
                    return;
                }

                if (replace) {
                    router.replace(destination);
                    return;
                }

                router.push(destination);
            })();
        },
        [router]
    );

    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={authClient}
                redirectTo="/broker-connections"
                emailAndPassword={{
                    enabled: true,
                    forgotPassword: true,
                    rememberMe: true,
                    confirmPassword: true
                }}
                navigate={navigate}
                Link={AuthLink}
            >
                {children}
                <Toaster />
                <Toaster
                    id="concall-audio"
                    mobileOffset={{ top: 76, right: 12, left: 12 }}
                    offset={{ top: 76, right: 16 }}
                    position="top-right"
                    visibleToasts={1}
                />
            </AuthProvider>
        </QueryClientProvider>
    );
}
