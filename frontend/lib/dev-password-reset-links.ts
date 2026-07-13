type ResetLinkEntry = {
    createdAt: number;
    url: string;
};

const RESET_LINK_TTL_MS = 10 * 60 * 1000;

declare global {
    var __anantaDevPasswordResetLinks: Map<string, ResetLinkEntry> | undefined;
}

function resetLinkStore() {
    globalThis.__anantaDevPasswordResetLinks ??= new Map<string, ResetLinkEntry>();
    return globalThis.__anantaDevPasswordResetLinks;
}

function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

export function devResetLinksEnabled() {
    return process.env.NODE_ENV !== "production" && !process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL;
}

export function storeDevPasswordResetLink(email: string, url: string) {
    if (!devResetLinksEnabled()) {
        return;
    }

    resetLinkStore().set(normalizeEmail(email), {
        createdAt: Date.now(),
        url
    });
}

export function getDevPasswordResetLink(email: string) {
    if (!devResetLinksEnabled()) {
        return null;
    }

    const key = normalizeEmail(email);
    const entry = resetLinkStore().get(key);

    if (!entry) {
        return null;
    }

    if (Date.now() - entry.createdAt > RESET_LINK_TTL_MS) {
        resetLinkStore().delete(key);
        return null;
    }

    return entry.url;
}
