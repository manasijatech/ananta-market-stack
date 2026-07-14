/**
 * Better Auth server configuration.
 *
 * Uses a local SQLite database for users, sessions, and credentials.
 * Session cookies are prefixed with `ananta-market-stack`.
 *
 * @see https://www.better-auth.com/docs/installation
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { storeDevPasswordResetLink } from "@/lib/dev-password-reset-links";
import { getPublicAppUrl } from "@/lib/runtime-config";

type SqliteDatabase = {
    exec(sql: string): unknown;
};

/** Resolves the SQLite path for standalone and dev runtimes. */
function resolveDefaultAuthDatabasePath(): string {
    const cwd = process.cwd();
    const isStandaloneRuntime = cwd.endsWith(`${sep}.next${sep}standalone`);
    const frontendRoot = isStandaloneRuntime ? resolve(cwd, "../..") : cwd;
    return resolve(frontendRoot, "../backend/data/app.db");
}

const databasePath = process.env.AUTH_DATABASE_PATH ?? resolveDefaultAuthDatabasePath();
mkdirSync(dirname(databasePath), { recursive: true });

const database: SqliteDatabase = new DatabaseSync(databasePath);

database.exec("PRAGMA busy_timeout = 5000;");

database.exec(`
  CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "emailVerified" integer NOT NULL,
    "image" text,
    "createdAt" date NOT NULL,
    "updatedAt" date NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "session" (
    "id" text PRIMARY KEY NOT NULL,
    "expiresAt" date NOT NULL,
    "token" text NOT NULL UNIQUE,
    "createdAt" date NOT NULL,
    "updatedAt" date NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");

  CREATE TABLE IF NOT EXISTS "account" (
    "id" text PRIMARY KEY NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" date,
    "refreshTokenExpiresAt" date,
    "scope" text,
    "password" text,
    "createdAt" date NOT NULL,
    "updatedAt" date NOT NULL
  );

  CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");

  CREATE TABLE IF NOT EXISTS "verification" (
    "id" text PRIMARY KEY NOT NULL,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expiresAt" date NOT NULL,
    "createdAt" date NOT NULL,
    "updatedAt" date NOT NULL
  );

  CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
`);

const authBaseURL = process.env.BETTER_AUTH_URL ?? getPublicAppUrl();

if (!process.env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production.");
}

async function sendResetPasswordLink(data: {
    user: { email: string; name?: string | null };
    url: string;
    token: string;
}) {
    const webhookUrl = process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL;

    if (webhookUrl) {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "password_reset",
                to: data.user.email,
                name: data.user.name,
                url: data.url,
                token: data.token
            })
        });

        if (!response.ok) {
            throw new Error(`Password reset webhook failed with status ${response.status}`);
        }

        return;
    }

    console.info(
        [
            "Password reset requested.",
            `Recipient: ${data.user.email}`,
            `Reset link: ${data.url}`,
            "Set AUTH_PASSWORD_RESET_WEBHOOK_URL to deliver this link through an email service."
        ].join("\n")
    );
    storeDevPasswordResetLink(data.user.email, data.url);
}

const localDevOrigins =
    process.env.NODE_ENV === "production"
        ? []
        : Array.from({ length: 11 }, (_, index) => 3000 + index).flatMap((port) => [
              `http://127.0.0.1:${port}`,
              `http://localhost:${port}`
          ]);
const trustedOrigins = Array.from(
    new Set([
        authBaseURL,
        ...localDevOrigins,
        ...String(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean)
    ])
);

/** Shared Better Auth instance for API routes and server session lookups. */
export const auth = betterAuth({
    appName: "Ananta",
    baseURL: authBaseURL,
    trustedOrigins,
    secret: process.env.BETTER_AUTH_SECRET,
    database,
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
        sendResetPassword: sendResetPasswordLink,
        resetPasswordTokenExpiresIn: 60 * 60,
        autoSignIn: true
    },
    session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24
    },
    advanced: {
        cookiePrefix: "ananta-market-stack",
        database: {
            generateId: "uuid"
        }
    }
});
