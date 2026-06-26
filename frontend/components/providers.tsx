"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth-client";
import { getQueryClient } from "@/lib/query-client";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";

const postAuthTargets = new Set(["/", "/dashboard"]);

export function Providers({ children }: { children: ReactNode }) {
    const router = useRouter();
    const queryClient = getQueryClient();

    const navigate = useCallback(
        ({ to, replace }: { to: string; replace?: boolean }) => {
            void (async () => {
                const destination = postAuthTargets.has(to) ? await resolvePostAuthRoute() : to;

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
                redirectTo="/dashboard"
                emailAndPassword={{
                    enabled: true,
                    forgotPassword: true,
                    rememberMe: true
                }}
                navigate={navigate}
                Link={Link}
            >
                {children}
                <Toaster />
            </AuthProvider>
        </QueryClientProvider>
    );
}
