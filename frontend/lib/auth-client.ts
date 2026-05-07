"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export type AuthSession = typeof authClient.$Infer.Session;
export type AuthUser = AuthSession["user"];

export type SignUpInput = {
  email: string;
  password: string;
  displayName: string;
};

export type SignInInput = {
  email: string;
  password: string;
  rememberMe?: boolean;
};
