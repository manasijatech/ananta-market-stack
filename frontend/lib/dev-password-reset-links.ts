import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

type ResetLinkEntry = {
    createdAt: number;
    url: string;
};

const RESET_LINK_TTL_MS = 10 * 60 * 1000;

function resolveResetLinkStorePath(): string {
    const cwd = process.cwd();
    const isStandaloneRuntime = cwd.endsWith(`${sep}.next${sep}standalone`);
    const frontendRoot = isStandaloneRuntime ? resolve(cwd, "../..") : cwd;
    return resolve(frontendRoot, "../backend/data/dev-password-reset-links.json");
}

const storePath = resolveResetLinkStorePath();

function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

function readStore(): Record<string, ResetLinkEntry> {
    try {
        const parsed = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, ResetLinkEntry>;
        }
    } catch {
        // Missing or unreadable store is fine in local dev.
    }
    return {};
}

function writeStore(store: Record<string, ResetLinkEntry>) {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify(store), "utf8");
}

export function devResetLinksEnabled() {
    return process.env.NODE_ENV !== "production" && !process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL;
}

export function storeDevPasswordResetLink(email: string, url: string) {
    if (!devResetLinksEnabled()) {
        return;
    }

    const store = readStore();
    store[normalizeEmail(email)] = {
        createdAt: Date.now(),
        url
    };
    writeStore(store);
}

export function getDevPasswordResetLink(email: string) {
    if (!devResetLinksEnabled()) {
        return null;
    }

    const key = normalizeEmail(email);
    const store = readStore();
    const entry = store[key];

    if (!entry) {
        return null;
    }

    if (Date.now() - entry.createdAt > RESET_LINK_TTL_MS) {
        delete store[key];
        writeStore(store);
        return null;
    }

    return entry.url;
}
