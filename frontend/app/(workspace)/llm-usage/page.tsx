import { AccessDeniedState } from "@/components/access/access-denied-state";
import { parseActionError } from "@/components/brokers/action-error";
import { LlmUsageDashboard, buildLlmUsageFilterOptions } from "@/components/llm-usage/llm-usage-dashboard";
import { LLM_USAGE_ALL_FILTER_VALUE } from "@/lib/llm-usage-filters";
import {
    getLlmUsageEvents,
    getLlmUsageOverview,
    getLlmUsageTimeseries
} from "@/service/actions/llm-usage";
import type { LlmUsageFilters, LlmUsageGranularity } from "@/service/types/llm-usage";

type LlmUsagePageProps = {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

function cleanParam(value: string | string[] | undefined): string | undefined {
    const clean = firstParam(value)?.trim();
    if (clean === LLM_USAGE_ALL_FILTER_VALUE) return undefined;
    return clean || undefined;
}

function parseGranularity(value: string | string[] | undefined): LlmUsageGranularity {
    const clean = cleanParam(value);
    if (clean === "weekly" || clean === "monthly") return clean;
    return "daily";
}

export default async function LlmUsagePage({ searchParams }: LlmUsagePageProps) {
    const params = await searchParams;
    const filters: LlmUsageFilters = {
        date_from: cleanParam(params.date_from),
        date_to: cleanParam(params.date_to),
        provider: cleanParam(params.provider),
        model_id: cleanParam(params.model_id),
        workflow_id: cleanParam(params.workflow_id),
        request_kind: cleanParam(params.request_kind),
        api_surface: cleanParam(params.api_surface)
    };
    const granularity = parseGranularity(params.granularity);

    let overview;
    let timeseries;
    let events;
    let filterOptionsOverview;
    let filterOptionsEvents;

    try {
        [overview, timeseries, events, filterOptionsOverview, filterOptionsEvents] = await Promise.all([
            getLlmUsageOverview(filters),
            getLlmUsageTimeseries(filters, granularity),
            getLlmUsageEvents(filters, 100),
            getLlmUsageOverview({}),
            getLlmUsageEvents({}, 500)
        ]);
    } catch (caught) {
        const parsed = parseActionError(caught);
        if (parsed.status === 403) {
            return (
                <AccessDeniedState
                    title="LLM usage not available"
                    description="This workspace role cannot open the LLM usage dashboard."
                    reason="Ask a workspace admin to grant LLM usage visibility if you need to inspect provider and workflow consumption."
                    backHref="/broker-connections"
                    backLabel="Go to dashboard"
                />
            );
        }
        throw caught;
    }
    const filterOptions = buildLlmUsageFilterOptions(filterOptionsOverview, filterOptionsEvents);

    return (
        <LlmUsageDashboard
            events={events}
            filterOptions={filterOptions}
            filters={filters}
            granularity={granularity}
            overview={overview}
            timeseries={timeseries}
        />
    );
}
