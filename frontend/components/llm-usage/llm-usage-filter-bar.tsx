"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
    IconApi,
    IconBrain,
    IconChartBar,
    IconFilter,
    IconRefresh,
    IconRoute,
    IconServer,
    IconSparkles,
    IconX
} from "@tabler/icons-react";
import { LlmUsageDateRangeFilter } from "@/components/llm-usage/llm-usage-date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
    buildLlmUsageFilterChips,
    buildLlmUsageHref,
    formatLlmUsageLastUpdated,
    hasActiveLlmUsageFilters,
    removeLlmUsageFilterChip,
    type LlmUsageActiveFilterChip,
    type LlmUsageFilterOption
} from "@/lib/llm-usage-filters";
import { apiSurfaceDisplay, requestKindDisplay } from "@/lib/llm-usage";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { LlmUsageFilters, LlmUsageGranularity } from "@/service/types/llm-usage";

export type LlmUsageFilterOptions = {
    providers: LlmUsageFilterOption[];
    models: LlmUsageFilterOption[];
    workflows: LlmUsageFilterOption[];
    requestKinds: LlmUsageFilterOption[];
    apiSurfaces: LlmUsageFilterOption[];
};

type LlmUsageFilterBarProps = {
    filters: LlmUsageFilters;
    filterOptions: LlmUsageFilterOptions;
    granularity: LlmUsageGranularity;
    generatedAt: string;
};

type DraftFilters = Pick<LlmUsageFilters, "provider" | "model_id" | "workflow_id" | "request_kind" | "api_surface">;

type FilterCategoryKey = keyof DraftFilters | "granularity";

const DEFAULT_GRANULARITY: LlmUsageGranularity = "daily";

const FILTER_CATEGORIES: {
    key: FilterCategoryKey;
    label: string;
    icon: typeof IconFilter;
}[] = [
    { key: "provider", label: "Providers", icon: IconServer },
    { key: "model_id", label: "Models", icon: IconBrain },
    { key: "workflow_id", label: "Workflows", icon: IconRoute },
    { key: "request_kind", label: "Request kind", icon: IconSparkles },
    { key: "api_surface", label: "API surface", icon: IconApi },
    { key: "granularity", label: "Bucket", icon: IconChartBar }
];

const GRANULARITY_OPTIONS: LlmUsageFilterOption[] = [
    { label: "Daily", value: "daily", detail: "One bucket per day" },
    { label: "Weekly", value: "weekly", detail: "One bucket per week" },
    { label: "Monthly", value: "monthly", detail: "One bucket per month" }
];

function optionLabel(options: LlmUsageFilterOption[], value?: string | null): string | undefined {
    const clean = value?.trim();
    if (!clean) return undefined;
    return options.find((option) => option.value === clean)?.label || clean;
}

function clean(value?: string | null): string {
    return value?.trim() || "";
}

function draftFromFilters(filters: LlmUsageFilters): DraftFilters {
    return {
        provider: clean(filters.provider),
        model_id: clean(filters.model_id),
        workflow_id: clean(filters.workflow_id),
        request_kind: clean(filters.request_kind),
        api_surface: clean(filters.api_surface)
    };
}

function optionsForCategory(
    category: FilterCategoryKey,
    filterOptions: LlmUsageFilterOptions
): LlmUsageFilterOption[] {
    if (category === "provider") return filterOptions.providers;
    if (category === "model_id") return filterOptions.models;
    if (category === "workflow_id") return filterOptions.workflows;
    if (category === "request_kind") return filterOptions.requestKinds;
    if (category === "api_surface") return filterOptions.apiSurfaces;
    return GRANULARITY_OPTIONS;
}

export function LlmUsageFilterBar({
    filters,
    filterOptions,
    granularity,
    generatedAt
}: LlmUsageFilterBarProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const refreshHref = searchParams.toString() ? `/llm-usage?${searchParams.toString()}` : "/llm-usage";
    const hasActiveFilters = hasActiveLlmUsageFilters(filters, granularity);
    const [open, setOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState<FilterCategoryKey>("provider");
    const [search, setSearch] = useState("");
    const [draftFilters, setDraftFilters] = useState<DraftFilters>(() => draftFromFilters(filters));
    const [draftGranularity, setDraftGranularity] = useState<LlmUsageGranularity>(granularity);

    useEffect(() => {
        setDraftFilters(draftFromFilters(filters));
        setDraftGranularity(granularity);
    }, [filters, granularity]);

    const draftChipLabels = {
        provider: optionLabel(filterOptions.providers, draftFilters.provider),
        model_id: optionLabel(filterOptions.models, draftFilters.model_id),
        workflow_id: optionLabel(filterOptions.workflows, draftFilters.workflow_id),
        request_kind: draftFilters.request_kind
            ? requestKindDisplay(
                  draftFilters.request_kind,
                  filterOptions.requestKinds.find((option) => option.value === draftFilters.request_kind)?.label
              )
            : undefined,
        api_surface: draftFilters.api_surface
            ? apiSurfaceDisplay(
                  draftFilters.api_surface,
                  filterOptions.apiSurfaces.find((option) => option.value === draftFilters.api_surface)?.label
              )
            : undefined
    };
    const appliedChipLabels = {
        provider: optionLabel(filterOptions.providers, filters.provider),
        model_id: optionLabel(filterOptions.models, filters.model_id),
        workflow_id: optionLabel(filterOptions.workflows, filters.workflow_id),
        request_kind: filters.request_kind
            ? requestKindDisplay(
                  filters.request_kind,
                  filterOptions.requestKinds.find((option) => option.value === filters.request_kind)?.label
              )
            : undefined,
        api_surface: filters.api_surface
            ? apiSurfaceDisplay(
                  filters.api_surface,
                  filterOptions.apiSurfaces.find((option) => option.value === filters.api_surface)?.label
              )
            : undefined
    };

    const draftChips = buildLlmUsageFilterChips(draftFilters, draftGranularity, draftChipLabels);
    const appliedChips = buildLlmUsageFilterChips(filters, granularity, appliedChipLabels);
    const selectedCount = draftChips.length;
    const categoryOptions = optionsForCategory(activeCategory, filterOptions);
    const filteredOptions = useMemo(() => {
        const cleanSearch = search.trim().toLowerCase();
        if (!cleanSearch) return categoryOptions;
        return categoryOptions.filter((option) =>
            [option.label, option.value, option.detail].filter(Boolean).some((part) =>
                String(part).toLowerCase().includes(cleanSearch)
            )
        );
    }, [categoryOptions, search]);

    const activeValue = activeCategory === "granularity" ? draftGranularity : clean(draftFilters[activeCategory]);

    function setCategoryValue(category: FilterCategoryKey, value: string) {
        if (category === "granularity") {
            setDraftGranularity(value === "weekly" || value === "monthly" ? value : "daily");
            return;
        }
        setDraftFilters((current) => ({
            ...current,
            [category]: clean(current[category]) === value ? "" : value
        }));
    }

    function clearDraft() {
        setDraftFilters({
            provider: "",
            model_id: "",
            workflow_id: "",
            request_kind: "",
            api_surface: ""
        });
        setDraftGranularity(DEFAULT_GRANULARITY);
        setSearch("");
    }

    function removeDraftChip(key: LlmUsageActiveFilterChip["key"]) {
        if (key === "granularity") {
            setDraftGranularity(DEFAULT_GRANULARITY);
            return;
        }
        if (!(key in draftFilters)) return;
        setDraftFilters((current) => ({ ...current, [key]: "" }));
    }

    return (
        <form action="/llm-usage" className="grid gap-3">
            {draftFilters.provider ? <input name="provider" type="hidden" value={draftFilters.provider} /> : null}
            {draftFilters.model_id ? <input name="model_id" type="hidden" value={draftFilters.model_id} /> : null}
            {draftFilters.workflow_id ? <input name="workflow_id" type="hidden" value={draftFilters.workflow_id} /> : null}
            {draftFilters.request_kind ? <input name="request_kind" type="hidden" value={draftFilters.request_kind} /> : null}
            {draftFilters.api_surface ? <input name="api_surface" type="hidden" value={draftFilters.api_surface} /> : null}
            {draftGranularity !== DEFAULT_GRANULARITY ? (
                <input name="granularity" type="hidden" value={draftGranularity} />
            ) : null}

            <div className="app-card-surface bg-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <LlmUsageDateRangeFilter dateFrom={filters.date_from} dateTo={filters.date_to} />
                        <Popover onOpenChange={setOpen} open={open}>
                            <PopoverTrigger
                                className={cn(
                                    buttonVariants({ variant: "outline" }),
                                    "h-9"
                                )}
                                type="button"
                            >
                                <IconFilter aria-hidden data-icon="inline-start" />
                                Filters
                                {selectedCount ? (
                                    <Badge className="ms-1 rounded-full" size="sm" variant="secondary">
                                        {selectedCount}
                                    </Badge>
                                ) : null}
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-[min(58rem,calc(100vw-2rem))] p-0">
                                <div className="grid min-h-[25rem] md:grid-cols-[14rem_minmax(18rem,1fr)_16rem]">
                                    <div className="border-b p-3 md:border-e md:border-b-0">
                                        <h2 className="px-2 text-lg font-semibold">Filters</h2>
                                        <Separator className="my-3" />
                                        <div className="flex flex-col gap-1">
                                            {FILTER_CATEGORIES.map((category) => {
                                                const Icon = category.icon;
                                                const isActive = category.key === activeCategory;
                                                const value =
                                                    category.key === "granularity"
                                                        ? draftGranularity !== DEFAULT_GRANULARITY
                                                        : Boolean(clean(draftFilters[category.key]));
                                                return (
                                                    <Button
                                                        className={cn("justify-start", isActive && "bg-accent")}
                                                        key={category.key}
                                                        onClick={() => {
                                                            setActiveCategory(category.key);
                                                            setSearch("");
                                                        }}
                                                        size="sm"
                                                        type="button"
                                                        variant="ghost"
                                                    >
                                                        <Icon aria-hidden data-icon="inline-start" />
                                                        <span className="min-w-0 flex-1 truncate text-left">{category.label}</span>
                                                        {value ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="border-b p-3 md:border-e md:border-b-0">
                                        <Input
                                            aria-label={`Search ${FILTER_CATEGORIES.find((item) => item.key === activeCategory)?.label}`}
                                            onChange={(event) => setSearch(event.target.value)}
                                            placeholder={`Search ${FILTER_CATEGORIES.find((item) => item.key === activeCategory)?.label.toLowerCase()}...`}
                                            value={search}
                                        />
                                        <div className="mt-3 flex max-h-[19rem] flex-col gap-1 overflow-y-auto pr-1">
                                            {filteredOptions.length ? (
                                                filteredOptions.map((option) => {
                                                    const selected = activeValue === option.value;
                                                    return (
                                                        <Button
                                                            className={cn(
                                                                "h-auto min-h-10 justify-start px-3 py-2 text-left",
                                                                selected && "bg-primary text-primary-foreground hover:bg-primary/90"
                                                            )}
                                                            key={`${activeCategory}-${option.value}`}
                                                            onClick={() => setCategoryValue(activeCategory, option.value)}
                                                            type="button"
                                                            variant={selected ? "default" : "ghost"}
                                                        >
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate">{option.label}</span>
                                                                {option.detail ? (
                                                                    <span
                                                                        className={cn(
                                                                            "block truncate text-xs text-muted-foreground",
                                                                            selected && "text-primary-foreground/80"
                                                                        )}
                                                                    >
                                                                        {option.detail}
                                                                    </span>
                                                                ) : null}
                                                            </span>
                                                        </Button>
                                                    );
                                                })
                                            ) : (
                                                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                                                    No options match this search.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="p-3">
                                        <p className="text-sm font-medium">{selectedCount} filters selected</p>
                                        <Separator className="my-3" />
                                        <div className="flex flex-col gap-2">
                                            {draftChips.length ? (
                                                draftChips.map((chip) => (
                                                    <div
                                                        className="flex items-start justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2"
                                                        key={`${chip.key}-${chip.value}`}
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="text-xs font-medium text-muted-foreground">{chip.label}</p>
                                                            <p className="truncate text-sm">{chip.value}</p>
                                                        </div>
                                                        <Button
                                                            aria-label={`Remove ${chip.label} filter`}
                                                            onClick={() => removeDraftChip(chip.key)}
                                                            size="icon-xs"
                                                            type="button"
                                                            variant="ghost"
                                                        >
                                                            <IconX aria-hidden />
                                                        </Button>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-sm text-muted-foreground">Choose a category, then select a value.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                                    <Button onClick={clearDraft} size="sm" type="button" variant="ghost">
                                        Clear filters
                                    </Button>
                                    <div className="flex items-center gap-2">
                                        <Button onClick={() => setOpen(false)} size="sm" type="button" variant="outline">
                                            Cancel
                                        </Button>
                                        <Button size="sm" type="submit">
                                            Apply
                                        </Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {hasActiveFilters ? (
                            <Link
                                className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                href="/llm-usage"
                            >
                                Clear
                            </Link>
                        ) : null}
                        <Separator className="hidden h-8 sm:block" orientation="vertical" />
                        <span className="text-xs text-muted-foreground">{formatLlmUsageLastUpdated(generatedAt)}</span>
                        <Button onClick={() => router.push(refreshHref)} size="sm" type="button" variant="ghost">
                            <IconRefresh aria-hidden data-icon="inline-start" />
                            Refresh
                        </Button>
                    </div>
                </div>
            </div>

            {appliedChips.length ? (
                <div className="flex flex-wrap items-center gap-2 px-1">
                    <span className={typography.statLabel}>Active filters</span>
                    {appliedChips.map((chip) => {
                        const next = removeLlmUsageFilterChip(filters, granularity, chip.key);
                        const href = buildLlmUsageHref(next.filters, next.granularity);
                        return (
                            <Badge
                                className="gap-1 rounded-full pe-1"
                                key={`${chip.key}-${chip.value}`}
                                size="sm"
                                variant="secondary"
                            >
                                <span>
                                    {chip.label}: {chip.value}
                                </span>
                                <Link
                                    aria-label={`Remove ${chip.label} filter`}
                                    className="inline-flex size-4 items-center justify-center rounded-full hover:bg-foreground/10"
                                    href={href}
                                >
                                    <IconX aria-hidden className="size-3" />
                                </Link>
                            </Badge>
                        );
                    })}
                </div>
            ) : null}
        </form>
    );
}
