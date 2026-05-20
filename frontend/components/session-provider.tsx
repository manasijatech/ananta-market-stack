"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { authClient, type AuthUser, type SignInInput, type SignUpInput } from "@/lib/auth-client";

type SessionContextValue = {
    user: AuthUser | null;
    isLoading: boolean;
    signIn: (input: SignInInput) => Promise<void>;
    signUp: (input: SignUpInput) => Promise<void>;
    signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const session = authClient.useSession();
    const user = session.data?.user ?? null;

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
        },
        [session]
    );

    const signOut = useCallback(async () => {
        const { error } = await authClient.signOut();
        if (error) {
            throw new Error(error.message ?? "Could not sign out.");
        }
        await session.refetch();
    }, []);

    const value = useMemo(
        () => ({ user, isLoading: session.isPending, signIn, signUp, signOut }),
        [user, session.isPending, signIn, signOut, signUp]
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
