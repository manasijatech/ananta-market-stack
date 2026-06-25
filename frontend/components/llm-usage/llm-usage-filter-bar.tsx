"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { IconRefresh, IconX } from "@tabler/icons-react";
import { LlmUsageDateRangeFilter } from "@/components/llm-usage/llm-usage-date-range-filter";
import { LlmUsageFilterSelect } from "@/components/llm-usage/llm-usage-filter-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Separator } from "@/components/ui/separator";
import {
    buildLlmUsageFilterChips,
    buildLlmUsageHref,
    formatLlmUsageLastUpdated,
    hasActiveLlmUsageFilters,
    removeLlmUsageFilterChip,
    type LlmUsageFilterOption
} from "@/lib/llm-usage-filters";
import { apiSurfaceDisplay, requestKindDisplay } from "@/lib/llm-usage";
import { typography } from "@/lib/typography";
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

function optionLabel(options: LlmUsageFilterOption[], value?: string | null): string | undefined {
    const clean = value?.trim();
    if (!clean) return undefined;
    return options.find((option) => option.value === clean)?.label || clean;
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

    const chipLabels = {
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

    const activeChips = buildLlmUsageFilterChips(filters, granularity, chipLabels);

    return (
        <div className="grid gap-3">
            <Frame>
                <FramePanel className="p-4">
                    <form
                        action="/llm-usage"
                        className="flex flex-col gap-4 xl:flex-row xl:flex-wrap xl:items-end"
                    >
                        <LlmUsageDateRangeFilter dateFrom={filters.date_from} dateTo={filters.date_to} />

                        <Separator className="hidden h-8 xl:block" orientation="vertical" />

                        <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-end xl:gap-3">
                            <LlmUsageFilterSelect
                                allLabel="All providers"
                                label="Provider"
                                name="provider"
                                options={filterOptions.providers}
                                value={filters.provider}
                            />
                            <LlmUsageFilterSelect
                                allLabel="All models"
                                label="Model"
                                name="model_id"
                                options={filterOptions.models}
                                value={filters.model_id}
                            />
                            <LlmUsageFilterSelect
                                allLabel="All workflows"
                                label="Workflow"
                                name="workflow_id"
                                options={filterOptions.workflows}
                                value={filters.workflow_id}
                            />
                        </div>

                        <Separator className="hidden h-8 xl:block" orientation="vertical" />

                        <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-end xl:gap-3">
                            <LlmUsageFilterSelect
                                includeAll={false}
                                label="Bucket"
                                name="granularity"
                                options={[
                                    { label: "Daily", value: "daily" },
                                    { label: "Weekly", value: "weekly" },
                                    { label: "Monthly", value: "monthly" }
                                ]}
                                value={granularity}
                            />
                            <LlmUsageFilterSelect
                                allLabel="All request kinds"
                                label="Request kind"
                                name="request_kind"
                                options={filterOptions.requestKinds}
                                value={filters.request_kind}
                            />
                            <LlmUsageFilterSelect
                                allLabel="All API surfaces"
                                label="API surface"
                                name="api_surface"
                                options={filterOptions.apiSurfaces}
                                value={filters.api_surface}
                            />
                        </div>

                        <div className="flex flex-wrap items-center gap-3 xl:ms-auto">
                            <Button type="submit" variant="outline">
                                Apply
                            </Button>
                            {hasActiveFilters ? (
                                <Link
                                    className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                    href="/llm-usage"
                                >
                                    Clear
                                </Link>
                            ) : null}
                            <Separator className="hidden h-8 sm:block" orientation="vertical" />
                            <span className="text-xs text-muted-foreground">
                                {formatLlmUsageLastUpdated(generatedAt)}
                            </span>
                            <Button onClick={() => router.push(refreshHref)} size="sm" type="button" variant="ghost">
                                <IconRefresh aria-hidden className="size-4" />
                                Refresh
                            </Button>
                        </div>
                    </form>
                </FramePanel>
            </Frame>

            {activeChips.length ? (
                <div className="flex flex-wrap items-center gap-2 px-1">
                    <span className={typography.statLabel}>Active filters</span>
                    {activeChips.map((chip) => {
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
        </div>
    );
}
