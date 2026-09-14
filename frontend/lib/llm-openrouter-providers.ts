export const MAX_OPENROUTER_PROVIDERS = 5;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._\-/]*$/;

export function providerSupportsOpenRouterRouting(provider: string | null | undefined): boolean {
    return provider === "openrouter";
}

/** Parse free-text provider input (commas, spaces, newlines) into an ordered slug list. */
export function parseOpenRouterProvidersInput(value: string | null | undefined): string[] {
    const text = (value ?? "").trim().toLowerCase();
    if (!text) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of text.split(/[\s,;]+/)) {
        const cleaned = part.trim().toLowerCase();
        if (!cleaned || seen.has(cleaned)) continue;
        seen.add(cleaned);
        out.push(cleaned);
    }
    return out;
}

/** Validate a provider list; returns an error message or null when valid. */
export function validateOpenRouterProviders(providers: string[]): string | null {
    if (providers.length > MAX_OPENROUTER_PROVIDERS) {
        return `Save at most ${MAX_OPENROUTER_PROVIDERS} providers per model, in fallback order.`;
    }
    for (const slug of providers) {
        if (slug.length > 64 || !SLUG_PATTERN.test(slug)) {
            return `“${slug}” is not a valid provider slug. Use the provider name from the OpenRouter model page, e.g. “together”.`;
        }
    }
    return null;
}

/** Format a saved provider list for the single-line input. */
export function formatOpenRouterProvidersForInput(providers: string[] | null | undefined): string {
    return (providers ?? []).join(", ");
}

/** Normalize saved row values (tolerates missing/legacy shapes). */
export function normalizeSavedOpenRouterProviders(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value) {
        const cleaned = String(item ?? "").trim().toLowerCase();
        if (!cleaned || seen.has(cleaned)) continue;
        seen.add(cleaned);
        out.push(cleaned);
    }
    return out;
}

export function normalizeSavedAllowFallbacks(value: unknown): boolean {
    return value !== false;
}

/** One-line summary for saved-model rows, e.g. “Providers: together → fireworks · fallbacks on”. */
export function summarizeOpenRouterRouting(
    providers: string[] | null | undefined,
    allowFallbacks: boolean | null | undefined
): string | null {
    const list = normalizeSavedOpenRouterProviders(providers);
    if (!list.length) return null;
    const fallbacks = allowFallbacks !== false ? "fallbacks on" : "fallbacks off";
    return `Providers: ${list.join(" → ")} · ${fallbacks}`;
}

/** OpenRouter model-page URL for looking up provider slugs. */
export function openRouterModelUrl(modelId: string): string {
    return `https://openrouter.ai/models/${encodeURIComponent(modelId)}`;
}
