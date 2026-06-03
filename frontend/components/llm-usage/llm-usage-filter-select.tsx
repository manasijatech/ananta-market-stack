"use client";

import { useEffect, useMemo, useState } from "react";
import { SelectContent, SelectItem, SelectRoot, SelectTrigger } from "@/components/ui/select";
import { LLM_USAGE_ALL_FILTER_VALUE, type LlmUsageFilterOption } from "@/lib/llm-usage-filters";

type LlmUsageFilterSelectProps = {
    label: string;
    name: string;
    value?: string | null;
    options: LlmUsageFilterOption[];
    allLabel?: string;
    includeAll?: boolean;
};

function cleanValue(value?: string | null): string {
    return value?.trim() || "";
}

export function LlmUsageFilterSelect({
    includeAll = true,
    label,
    name,
    value,
    options,
    allLabel = "All"
}: LlmUsageFilterSelectProps) {
    const initialValue = cleanValue(value) || (includeAll ? LLM_USAGE_ALL_FILTER_VALUE : options[0]?.value || "");
    const [selectedValue, setSelectedValue] = useState(initialValue);
    useEffect(() => {
        setSelectedValue(initialValue);
    }, [initialValue]);
    const hasSelectedValue = selectedValue !== LLM_USAGE_ALL_FILTER_VALUE && !options.some((option) => option.value === selectedValue);
    const selectedLabel = useMemo(() => {
        if (includeAll && selectedValue === LLM_USAGE_ALL_FILTER_VALUE) return allLabel;
        return options.find((option) => option.value === selectedValue)?.label || selectedValue;
    }, [allLabel, includeAll, options, selectedValue]);

    return (
        <label className="grid gap-1">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {label}
            </span>
            <SelectRoot name={name} onValueChange={setSelectedValue} value={selectedValue}>
                <SelectTrigger>
                    <span className="min-w-0 truncate">{selectedLabel}</span>
                </SelectTrigger>
                <SelectContent>
                    {includeAll ? <SelectItem value={LLM_USAGE_ALL_FILTER_VALUE}>{allLabel}</SelectItem> : null}
                    {hasSelectedValue ? <SelectItem value={selectedValue}>{selectedValue}</SelectItem> : null}
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate">{option.label}</span>
                                {option.detail ? (
                                    <span className="truncate text-xs text-muted-foreground group-data-[highlighted]:text-primary-foreground/80">
                                        {option.detail}
                                    </span>
                                ) : null}
                            </span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </SelectRoot>
        </label>
    );
}
