"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OpenRouterModel } from "@/service/actions/llm-models";
import type { LlmModelConfig, LlmProvider } from "@/service/types/broker";

/**
 * Which OpenRouter vendor prefix each provider draws from. `openrouter` itself
 * uses the full catalog and keeps the full `vendor/model` slug as the model id;
 * the direct providers filter to their vendor and save the bare model id (the
 * form their own API expects) — matching the existing modelExamples.
 */
const PROVIDER_VENDOR: Record<LlmProvider, string | null> = {
    openrouter: null,
    openai: "openai",
    gemini: "google",
    anthropic: "anthropic"
};

/**
 * OpenRouter model-slug variant suffixes — appended as `model:variant` to route
 * to specific providers/pricing. Only meaningful for the `openrouter` provider.
 */
const OPENROUTER_VARIANTS: { id: string; hint: string }[] = [
    { id: "free", hint: "Free tier (rate-limited)" },
    { id: "nitro", hint: "Fastest providers (throughput-optimized)" },
    { id: "floor", hint: "Lowest-price providers" },
    { id: "online", hint: "Web search enabled" }
];

type ModelOption = {
    /** The model id to save (full slug for openrouter, bare id otherwise). */
    value: string;
    /** Display label (model name). */
    label: string;
    /** Secondary line: id · context · pricing. */
    meta: string;
};

function formatMeta(model: OpenRouterModel): string {
    const ctx = model.contextLength ? `${Math.round(model.contextLength / 1000)}K ctx` : "";
    const inPerM = model.promptPrice * 1_000_000;
    const outPerM = model.completionPrice * 1_000_000;
    const price = inPerM === 0 && outPerM === 0 ? "Free" : `$${inPerM.toFixed(2)}/$${outPerM.toFixed(2)} per 1M`;
    return [ctx, price].filter(Boolean).join(" · ");
}

/** True when the typed string is plausibly a custom model id for this provider. */
function looksLikeCustomModelId(provider: LlmProvider, raw: string): boolean {
    const query = raw.trim();
    if (!query) {
        return false;
    }
    if (provider === "openrouter") {
        // OpenRouter slugs are vendor/model or vendor/model:variant.
        return query.includes("/");
    }
    // Direct providers: bare ids like gpt-4o or claude-3-5-sonnet-20241022.
    return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,}$/.test(query);
}

export function LlmModelPicker({
    provider,
    models,
    allowedModels,
    value,
    disabled,
    onSelect
}: {
    provider: LlmProvider;
    models: OpenRouterModel[];
    allowedModels?: LlmModelConfig[];
    value: string;
    disabled?: boolean;
    onSelect: (modelId: string, modelName: string) => void;
}) {
    const [customMode, setCustomMode] = useState(false);
    const [query, setQuery] = useState("");
    const restricted = allowedModels !== undefined;
    const allowCustom = !restricted;

    const allowedOptions = useMemo(() => {
        const values = new Set<string>();
        const labels = new Map<string, string>();
        for (const model of allowedModels ?? []) {
            values.add(model.model_id);
            labels.set(model.model_id, model.label || model.model_id);
        }
        return { labels, values };
    }, [allowedModels]);

    const catalogOptions = useMemo<ModelOption[]>(() => {
        const vendor = PROVIDER_VENDOR[provider];
        const filtered = vendor ? models.filter((model) => model.vendor === vendor) : models;
        const seen = new Set<string>();
        const result: ModelOption[] = [];
        for (const model of filtered) {
            // Bare id for direct providers (drop the "vendor/" prefix), full slug for openrouter.
            const modelValue =
                provider === "openrouter" ? model.id : model.id.split("/").slice(1).join("/") || model.id;
            if (restricted && !allowedOptions.values.has(modelValue)) {
                continue;
            }
            if (seen.has(modelValue)) {
                continue;
            }
            seen.add(modelValue);
            result.push({
                value: modelValue,
                label: allowedOptions.labels.get(modelValue) ?? model.name,
                meta: `${modelValue} · ${formatMeta(model)}`
            });
        }
        return result;
    }, [allowedOptions, provider, models, restricted]);

    const pendingCustomId = useMemo(() => {
        if (!allowCustom || customMode) {
            return "";
        }
        const candidate = query.trim();
        if (!looksLikeCustomModelId(provider, candidate)) {
            return "";
        }
        if (catalogOptions.some((option) => option.value === candidate)) {
            return "";
        }
        return candidate;
    }, [allowCustom, catalogOptions, customMode, provider, query]);

    // Keep a previously-saved/custom/variant'd model selectable & visible even if
    // it isn't in the live catalog (renamed, legacy, or a `model:variant` slug).
    const options = useMemo<ModelOption[]>(() => {
        const extras: ModelOption[] = [];
        if (restricted) {
            const catalogValues = new Set(catalogOptions.map((option) => option.value));
            for (const modelId of allowedOptions.values) {
                if (!catalogValues.has(modelId)) {
                    extras.push({
                        value: modelId,
                        label: allowedOptions.labels.get(modelId) ?? modelId,
                        meta: "Enabled model · not in catalog"
                    });
                }
            }
        } else {
            const known = new Set(catalogOptions.map((option) => option.value));
            if (value && !known.has(value)) {
                extras.push({ value, label: value, meta: "Custom model · not in catalog" });
            }
            if (pendingCustomId && pendingCustomId !== value) {
                extras.push({
                    value: pendingCustomId,
                    label: pendingCustomId,
                    meta: "Custom model · not in catalog"
                });
            }
        }
        return extras.length ? [...extras, ...catalogOptions] : catalogOptions;
    }, [allowedOptions, catalogOptions, pendingCustomId, restricted, value]);

    const selected =
        options.find((option) => option.value === value) ??
        (pendingCustomId
            ? { value: pendingCustomId, label: pendingCustomId, meta: "Custom model · not in catalog" }
            : null);

    // OpenRouter variant suffix handling (e.g. "vendor/model:nitro").
    const supportsVariants = provider === "openrouter" && !restricted;
    const colonIndex = value.indexOf(":");
    const baseModel = colonIndex >= 0 ? value.slice(0, colonIndex) : value;
    const activeVariant = colonIndex >= 0 ? value.slice(colonIndex + 1) : "";

    function applyVariant(variantId: string) {
        if (!baseModel) {
            return;
        }
        // Toggle: clicking the active variant removes it, back to the base model.
        onSelect(activeVariant === variantId ? baseModel : `${baseModel}:${variantId}`, baseModel);
    }

    function setCustomModeEnabled(next: boolean) {
        setCustomMode(next);
        if (!next) {
            setQuery("");
        }
    }

    function handleQueryChange(inputValue: string) {
        setQuery(inputValue);
        if (!allowCustom || customMode) {
            return;
        }
        const candidate = inputValue.trim();
        if (looksLikeCustomModelId(provider, candidate)) {
            onSelect(candidate, candidate);
        }
    }

    // When switching providers, reset search state so stale slugs don't linger.
    useEffect(() => {
        setQuery("");
        setCustomMode(false);
    }, [provider]);

    return (
        <div className="grid min-w-0 gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
                {allowCustom ? (
                    <label
                        className={cn(
                            "flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground",
                            disabled && "cursor-not-allowed opacity-64"
                        )}
                        title="Enter any model id, even if it is not in the catalog"
                    >
                        <Checkbox
                            checked={customMode}
                            disabled={disabled}
                            onCheckedChange={(checked) => setCustomModeEnabled(checked === true)}
                        />
                        Custom
                    </label>
                ) : null}
                {customMode ? (
                    <Input
                        className="h-9 min-w-0 flex-1 text-sm"
                        disabled={disabled}
                        onChange={(event) => onSelect(event.target.value, event.target.value)}
                        placeholder={provider === "openrouter" ? "vendor/model[:variant]" : "Custom model id"}
                        value={value}
                    />
                ) : (
                    <div className="min-w-0 flex-1">
                        <Combobox<ModelOption>
                            disabled={disabled || (restricted && options.length === 0)}
                            isItemEqualToValue={(item, candidate) => item.value === candidate.value}
                            items={options}
                            itemToStringLabel={(option) => option.label}
                            onInputValueChange={handleQueryChange}
                            onValueChange={(option) => {
                                if (option) {
                                    setQuery("");
                                    onSelect(option.value, option.label);
                                }
                            }}
                            value={selected}
                        >
                            <ComboboxInput
                                className="h-9 text-sm"
                                placeholder={
                                    options.length
                                        ? "Search models…"
                                        : restricted
                                          ? "No enabled models"
                                          : "Search or type vendor/model"
                                }
                            />
                            <ComboboxContent>
                                <ComboboxEmpty>
                                    {pendingCustomId
                                        ? `Use "${pendingCustomId}" as a custom model`
                                        : allowCustom
                                          ? "No matches — type vendor/model for a custom id"
                                          : "No models found."}
                                </ComboboxEmpty>
                                <ComboboxList>
                                    {(option: ModelOption) => (
                                        <ComboboxItem key={option.value} value={option}>
                                            <div className="flex min-w-0 flex-col">
                                                <span className="truncate font-medium">{option.label}</span>
                                                <span className="truncate text-muted-foreground text-xs">
                                                    {option.meta}
                                                </span>
                                            </div>
                                        </ComboboxItem>
                                    )}
                                </ComboboxList>
                            </ComboboxContent>
                        </Combobox>
                    </div>
                )}
                {allowCustom ? (
                    <Button
                        className="h-9 shrink-0 px-2 text-xs"
                        disabled={disabled}
                        onClick={() => setCustomModeEnabled(!customMode)}
                        title={customMode ? "Browse the model catalog" : "Enter a custom model id"}
                        type="button"
                        variant="ghost"
                    >
                        {customMode ? "Catalog" : "Custom"}
                    </Button>
                ) : null}
            </div>

            {supportsVariants && baseModel ? (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Variant</span>
                    {OPENROUTER_VARIANTS.map((variant) => (
                        <button
                            className={cn(
                                "rounded-md border px-2 py-0.5 text-xs transition-colors",
                                activeVariant === variant.id
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            )}
                            disabled={disabled}
                            key={variant.id}
                            onClick={() => applyVariant(variant.id)}
                            title={variant.hint}
                            type="button"
                        >
                            :{variant.id}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
