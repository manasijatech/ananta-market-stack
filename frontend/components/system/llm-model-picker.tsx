"use client";

import { useMemo, useState } from "react";
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OpenRouterModel } from "@/service/actions/llm-models";
import type { LlmProvider } from "@/service/types/broker";

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

export function LlmModelPicker({
    provider,
    models,
    value,
    disabled,
    onSelect
}: {
    provider: LlmProvider;
    models: OpenRouterModel[];
    value: string;
    disabled?: boolean;
    onSelect: (modelId: string, modelName: string) => void;
}) {
    const [customMode, setCustomMode] = useState(false);

    const catalogOptions = useMemo<ModelOption[]>(() => {
        const vendor = PROVIDER_VENDOR[provider];
        const filtered = vendor ? models.filter((model) => model.vendor === vendor) : models;
        const seen = new Set<string>();
        const result: ModelOption[] = [];
        for (const model of filtered) {
            // Bare id for direct providers (drop the "vendor/" prefix), full slug for openrouter.
            const modelValue =
                provider === "openrouter" ? model.id : model.id.split("/").slice(1).join("/") || model.id;
            if (seen.has(modelValue)) {
                continue;
            }
            seen.add(modelValue);
            result.push({ value: modelValue, label: model.name, meta: `${modelValue} · ${formatMeta(model)}` });
        }
        return result;
    }, [provider, models]);

    // Keep a previously-saved/custom/variant'd model selectable & visible even if
    // it isn't in the live catalog (renamed, legacy, or a `model:variant` slug).
    const options = useMemo<ModelOption[]>(() => {
        if (value && !catalogOptions.some((option) => option.value === value)) {
            return [{ value, label: value, meta: "Custom model · not in catalog" }, ...catalogOptions];
        }
        return catalogOptions;
    }, [catalogOptions, value]);

    const selected = options.find((option) => option.value === value) ?? null;

    // OpenRouter variant suffix handling (e.g. "vendor/model:nitro").
    const supportsVariants = provider === "openrouter";
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

    return (
        <div className="grid min-w-0 gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
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
                            disabled={disabled || options.length === 0}
                            isItemEqualToValue={(item, candidate) => item.value === candidate.value}
                            items={options}
                            itemToStringLabel={(option) => option.label}
                            onValueChange={(option) => {
                                if (option) {
                                    onSelect(option.value, option.label);
                                }
                            }}
                            value={selected}
                        >
                            <ComboboxInput
                                className="h-9 text-sm"
                                placeholder={options.length ? "Search models…" : "No catalog — use Custom"}
                            />
                            <ComboboxContent>
                                <ComboboxEmpty>No models found.</ComboboxEmpty>
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
                <Button
                    className="h-9 shrink-0 px-2 text-xs"
                    disabled={disabled}
                    onClick={() => setCustomMode((mode) => !mode)}
                    title={customMode ? "Browse the model catalog" : "Enter a custom model id"}
                    type="button"
                    variant="ghost"
                >
                    {customMode ? "Catalog" : "Custom"}
                </Button>
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
