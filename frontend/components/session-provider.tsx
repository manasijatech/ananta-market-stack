"use client";

import { authQueryKeys } from "@better-auth-ui/core";
import { useSession as useAuthSession } from "@better-auth-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authClient, type AuthSession, type AuthUser, type SignInInput, type SignUpInput } from "@/lib/auth-client";

type SessionContextValue = {
    user: AuthUser | null;
    isLoading: boolean;
    signIn: (input: SignInInput) => Promise<void>;
    signUp: (input: SignUpInput) => Promise<void>;
    signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function fetchSessionSnapshot(): Promise<AuthSession | null> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);
    try {
        const response = await fetch("/api/auth/get-session", {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error("Could not verify the current session.");
        }

        return (await response.json()) as AuthSession | null;
    } finally {
        window.clearTimeout(timeout);
    }
}

async function clearStaleSessionCookies() {
    await fetch("/api/auth/clear-stale-session", {
        method: "POST",
        cache: "no-store",
        credentials: "include"
    }).catch(() => undefined);
}

/**
 * Bridges Better Auth UI session state with app-level sign-in helpers.
 *
 * Prefer Better Auth UI hooks (`useSignInEmail`, etc.) in auth forms.
 * Use {@link useSession} elsewhere for the current user and sign-out.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
    const queryClient = useQueryClient();
    const session = useAuthSession(authClient);
    const [fallbackSession, setFallbackSession] = useState<AuthSession | null | undefined>(undefined);

    useEffect(() => {
        if (!session.isPending) {
            setFallbackSession(session.data ?? null);
            return;
        }

        let active = true;
        const timeout = window.setTimeout(async () => {
            try {
                const nextSession = await fetchSessionSnapshot();
                if (active) {
                    setFallbackSession(nextSession);
                    if (!nextSession) {
                        await clearStaleSessionCookies();
                    }
                }
            } catch {
                if (active) {
                    setFallbackSession(null);
                    await clearStaleSessionCookies();
                }
            }
        }, 500);

        return () => {
            active = false;
            window.clearTimeout(timeout);
        };
    }, [session.data, session.isPending]);

    const effectiveSession = session.data ?? fallbackSession ?? null;
    const user = effectiveSession?.user ?? null;
    const isLoading = session.isPending && fallbackSession === undefined;

    const refreshSession = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: authQueryKeys.session });
    }, [queryClient]);

    const syncFallbackSession = useCallback(async () => {
        try {
            setFallbackSession(await fetchSessionSnapshot());
        } catch {
            // Query invalidation already updated auth state; snapshot sync is best-effort.
        }
    }, []);

    const signIn = useCallback(
        async (input: SignInInput) => {
            const { error } = await authClient.signIn.email({
                email: input.email,
                password: input.password,
                rememberMe: input.rememberMe ?? true
            });

            if (error) {
                throw new Error(error.message ?? "Could not sign in.");
            }

            await refreshSession();
            await syncFallbackSession();
        },
        [refreshSession, syncFallbackSession]
    );

    const signUp = useCallback(
        async (input: SignUpInput) => {
            const { error } = await authClient.signUp.email({
                name: input.displayName,
                email: input.email,
                password: input.password
            });

            if (error) {
                throw new Error(error.message ?? "Could not create account.");
            }

            await refreshSession();
            await syncFallbackSession();
        },
        [refreshSession, syncFallbackSession]
    );

    const signOut = useCallback(async () => {
        const { error } = await authClient.signOut();
        if (error) {
            throw new Error(error.message ?? "Could not sign out.");
        }
        await refreshSession();
        setFallbackSession(null);
    }, [refreshSession]);

    const value = useMemo(
        () => ({ user, isLoading, signIn, signUp, signOut }),
        [user, isLoading, signIn, signOut, signUp]
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Returns the current user and auth actions from {@link SessionProvider}. */
export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used inside SessionProvider.");
    }
    return context;
}
