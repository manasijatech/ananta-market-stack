"use client";

import { authQueryKeys } from "@better-auth-ui/core";
import { useSession as useAuthSession } from "@better-auth-ui/react";
import { useQueryClient } from "@tanstack/react-query";
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

/**
 * Bridges Better Auth UI session state with app-level sign-in helpers.
 *
 * Prefer Better Auth UI hooks (`useSignInEmail`, etc.) in auth forms.
 * Use {@link useSession} elsewhere for the current user and sign-out.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
    const queryClient = useQueryClient();
    const session = useAuthSession(authClient);
    const user = session.data?.user ?? null;

    const refreshSession = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: authQueryKeys.session });
    }, [queryClient]);

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
        },
        [refreshSession]
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
        },
        [refreshSession]
    );

    const signOut = useCallback(async () => {
        const { error } = await authClient.signOut();
        if (error) {
            throw new Error(error.message ?? "Could not sign out.");
        }
        await refreshSession();
    }, [refreshSession]);

    const value = useMemo(
        () => ({ user, isLoading: session.isPending, signIn, signUp, signOut }),
        [user, session.isPending, signIn, signOut, signUp]
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
