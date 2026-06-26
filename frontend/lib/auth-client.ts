"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client.
 *
 * Must stay in sync with {@link ../auth.ts server plugins} when plugins are added.
 * Uses the default `/api/auth` base path from the current origin.
 */
export const authClient = createAuthClient();

export type AuthSession = typeof authClient.$Infer.Session;
export type AuthUser = AuthSession["user"];

/** Credentials for email/password sign-up via {@link SessionProvider}. */
export type SignUpInput = {
    email: string;
    password: string;
    displayName: string;
};

/** Credentials for email/password sign-in via {@link SessionProvider}. */
export type SignInInput = {
    email: string;
    password: string;
    rememberMe?: boolean;
};
