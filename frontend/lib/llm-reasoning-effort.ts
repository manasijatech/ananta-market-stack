import type { LlmProvider } from "@/service/types/broker";

export const LLM_REASONING_EFFORT_VALUES = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type LlmReasoningEffort = (typeof LLM_REASONING_EFFORT_VALUES)[number];

export const LLM_REASONING_EFFORT_OPTIONS: { value: string; label: string }[] = [
    { value: "", label: "Default" },
    { value: "none", label: "None" },
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" }
];

export function providerSupportsReasoningEffort(provider: string | null | undefined): boolean {
    return provider === "openrouter";
}

export function reasoningEffortSelectOptions(modelDefault?: string | null): { value: string; label: string }[] {
    const cleaned = (modelDefault ?? "").trim();
    const defaultLabel = cleaned
        ? `Default (${LLM_REASONING_EFFORT_OPTIONS.find((option) => option.value === cleaned)?.label ?? cleaned})`
        : "Default";
    return LLM_REASONING_EFFORT_OPTIONS.map((option) =>
        option.value === "" ? { ...option, label: defaultLabel } : option
    );
}

export function normalizeReasoningEffort(value: string | null | undefined): LlmReasoningEffort | null {
    const cleaned = (value ?? "").trim().toLowerCase();
    if (!cleaned || cleaned === "default" || cleaned === "auto") {
        return null;
    }
    return LLM_REASONING_EFFORT_VALUES.includes(cleaned as LlmReasoningEffort)
        ? (cleaned as LlmReasoningEffort)
        : null;
}

export function effortForProvider(provider: LlmProvider | string, value: string | null | undefined): string | null {
    if (!providerSupportsReasoningEffort(provider)) {
        return null;
    }
    return normalizeReasoningEffort(value);
}
