import { LlmUsageDashboard } from "@/components/llm-usage/llm-usage-dashboard";
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

    const [overview, timeseries, events] = await Promise.all([
        getLlmUsageOverview(filters),
        getLlmUsageTimeseries(filters, granularity),
        getLlmUsageEvents(filters, 100)
    ]);

    return (
        <LlmUsageDashboard
            events={events}
            filters={filters}
            granularity={granularity}
            overview={overview}
            timeseries={timeseries}
        />
    );
}
