import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getPublicAppUrl } from "@/lib/runtime-config";

const databasePath = process.env.AUTH_DATABASE_PATH ?? resolve(process.cwd(), "../backend/data/app.db");
mkdirSync(dirname(databasePath), { recursive: true });

const database = new Database(databasePath);

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
const trustedOrigins = Array.from(
    new Set([
        authBaseURL,
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        ...String(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean)
    ])
);

export const auth = betterAuth({
    appName: "Market Stack",
    baseURL: authBaseURL,
    trustedOrigins,
    secret: process.env.BETTER_AUTH_SECRET,
    database,
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
        autoSignIn: true
    },
    session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24
    },
    advanced: {
        cookiePrefix: "market-stack",
        database: {
            generateId: "uuid"
        }
    }
});
