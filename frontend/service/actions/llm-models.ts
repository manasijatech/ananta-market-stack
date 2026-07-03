import { unstable_cache } from "next/cache";

/** A normalized entry from OpenRouter's public model catalog. */
export interface OpenRouterModel {
    /** Full OpenRouter slug, e.g. "anthropic/claude-opus-4.8". */
    id: string;
    /** Human label, e.g. "Anthropic: Claude Opus 4.8". */
    name: string;
    /** Vendor prefix of the slug, e.g. "anthropic", "openai", "google". */
    vendor: string;
    /** Max context window in tokens (0 if unknown). */
    contextLength: number;
    /** USD price per input token (0 for free models). */
    promptPrice: number;
    /** USD price per output token. */
    completionPrice: number;
    /** Architecture modality string, e.g. "text->text" or "text+image->text". */
    modality: string;
}

type RawOpenRouterModel = {
    id?: string;
    name?: string;
    context_length?: number;
    pricing?: { prompt?: string; completion?: string };
    architecture?: { modality?: string };
};

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function normalize(raw: RawOpenRouterModel): OpenRouterModel | null {
    if (!raw.id) return null;
    const vendor = raw.id.includes("/") ? raw.id.split("/")[0] : "";
    return {
        id: raw.id,
        name: raw.name ?? raw.id,
        vendor,
        contextLength: typeof raw.context_length === "number" ? raw.context_length : 0,
        promptPrice: Number.parseFloat(raw.pricing?.prompt ?? "0") || 0,
        completionPrice: Number.parseFloat(raw.pricing?.completion ?? "0") || 0,
        modality: raw.architecture?.modality ?? "text->text"
    };
}

/**
 * OpenRouter's full model catalog (public endpoint, no auth required).
 *
 * Hard-cached for a week via `unstable_cache`: the catalog changes rarely, so we
 * memoize the normalized result in the Next Data Cache and only hit the network
 * on a cold/expired cache. Used to populate the model dropdowns in LLM provider
 * setup so users pick from a real list instead of pasting model IDs by hand.
 */
export const getOpenRouterModels = unstable_cache(
    async (): Promise<OpenRouterModel[]> => {
        try {
            const res = await fetch("https://openrouter.ai/api/v1/models", {
                headers: { Accept: "application/json" }
            });
            if (!res.ok) {
                return [];
            }
            const json = (await res.json()) as { data?: RawOpenRouterModel[] };
            const models = (json.data ?? [])
                .map(normalize)
                .filter((model): model is OpenRouterModel => model !== null)
                // Only pure text models (text input → text output); exclude any model
                // with image/audio/file modalities on either side.
                .filter((model) => {
                    const [input, output] = model.modality.split("->");
                    return input?.trim() === "text" && output?.trim() === "text";
                });
            models.sort((a, b) => a.name.localeCompare(b.name));
            return models;
        } catch {
            return [];
        }
    },
    ["openrouter-models-v2-text-only"],
    { revalidate: ONE_WEEK_SECONDS, tags: ["openrouter-models"] }
);
