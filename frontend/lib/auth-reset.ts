/** Pull a Better Auth reset token out of a query string, hash, or path. */
export function extractResetPasswordToken(urlString: string): string | null {
    try {
        const url = new URL(urlString, "http://127.0.0.1");
        const fromQuery = url.searchParams.get("token")?.trim();
        if (fromQuery) {
            return fromQuery;
        }

        const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("token")?.trim();
        if (fromHash) {
            return fromHash;
        }

        const match = url.pathname.match(/\/reset-password\/([^/?#]+)/);
        return match?.[1] ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
}

/** Build the in-app reset URL for a raw Better Auth reset link. */
export function resetPasswordPagePath(resetUrl: string): string | null {
    const token = extractResetPasswordToken(resetUrl);
    return token ? `/auth/reset-password?token=${encodeURIComponent(token)}` : null;
}
