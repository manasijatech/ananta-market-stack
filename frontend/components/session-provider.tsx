"use client";

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
    const response = await fetch("/api/auth/get-session", {
        cache: "no-store",
        credentials: "include"
    });

    if (!response.ok) {
        throw new Error("Could not verify the current session.");
    }

    return (await response.json()) as AuthSession | null;
}

async function clearStaleSessionCookies() {
    await fetch("/api/auth/clear-stale-session", {
        method: "POST",
        cache: "no-store",
        credentials: "include"
    }).catch(() => undefined);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const session = authClient.useSession();
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

            await session.refetch();
            try {
                setFallbackSession(await fetchSessionSnapshot());
            } catch {}
        },
        [session]
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

            await session.refetch();
            try {
                setFallbackSession(await fetchSessionSnapshot());
            } catch {}
        },
        [session]
    );

    const signOut = useCallback(async () => {
        const { error } = await authClient.signOut();
        if (error) {
            throw new Error(error.message ?? "Could not sign out.");
        }
        await session.refetch();
        setFallbackSession(null);
    }, [session]);

    const value = useMemo(
        () => ({ user, isLoading, signIn, signUp, signOut }),
        [user, isLoading, signIn, signOut, signUp]
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used inside SessionProvider.");
    }
    return context;
}
