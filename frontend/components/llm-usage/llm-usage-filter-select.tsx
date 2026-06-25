"use client";

import { useEffect, useMemo, useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { LLM_USAGE_ALL_FILTER_VALUE, type LlmUsageFilterOption } from "@/lib/llm-usage-filters";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";

type LlmUsageFilterSelectProps = {
    label: string;
    name: string;
    value?: string | null;
    options: LlmUsageFilterOption[];
    allLabel?: string;
    includeAll?: boolean;
    triggerClassName?: string;
    hideLabel?: boolean;
};

function cleanValue(value?: string | null): string {
    return value?.trim() || "";
}

const filterLabelClassName = typography.statLabel;

export function LlmUsageFilterSelect({
    includeAll = true,
    label,
    name,
    value,
    options,
    allLabel = "All",
    triggerClassName,
    hideLabel = false
}: LlmUsageFilterSelectProps) {
    const initialValue = cleanValue(value) || (includeAll ? LLM_USAGE_ALL_FILTER_VALUE : options[0]?.value || "");
    const [selectedValue, setSelectedValue] = useState(initialValue);
    useEffect(() => {
        setSelectedValue(initialValue);
    }, [initialValue]);
    const hasSelectedValue =
        selectedValue !== LLM_USAGE_ALL_FILTER_VALUE && !options.some((option) => option.value === selectedValue);
    const selectedLabel = useMemo(() => {
        if (includeAll && selectedValue === LLM_USAGE_ALL_FILTER_VALUE) return allLabel;
        return options.find((option) => option.value === selectedValue)?.label || selectedValue;
    }, [allLabel, includeAll, options, selectedValue]);

    return (
        <Field className={cn("min-w-[140px]", triggerClassName)}>
            {hideLabel ? null : <FieldLabel className={filterLabelClassName}>{label}</FieldLabel>}
            <Select name={name} onValueChange={(next) => setSelectedValue(next ?? "")} value={selectedValue}>
                <SelectTrigger className="h-8 w-full min-w-[140px]">
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
            </Select>
        </Field>
    );
}
