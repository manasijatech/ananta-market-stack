export type LlmUsageGranularity = "daily" | "weekly" | "monthly";

export interface LlmUsageFilters {
    date_from?: string | null;
    date_to?: string | null;
    provider?: string | null;
    model_id?: string | null;
    workflow_id?: string | null;
    request_kind?: string | null;
    api_surface?: string | null;
}

export interface LlmUsageTotals {
    request_count: number;
    success_count: number;
    error_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens: number;
    cache_write_tokens: number;
    reasoning_tokens: number;
    cached_tokens_reported_count: number;
    reasoning_tokens_reported_count: number;
    input_audio_tokens: number;
    output_audio_tokens: number;
    image_tokens: number;
    video_tokens: number;
    provider_cost_total: number;
    priced_request_count: number;
}

export interface LlmUsageGroup extends LlmUsageTotals {
    provider?: string | null;
    model_id?: string | null;
    workflow_id?: string | null;
    workflow_name?: string | null;
    request_kind?: string | null;
    request_kind_label?: string | null;
    api_surface?: string | null;
    api_surface_label?: string | null;
    workflow_status?: string | null;
    workflow_type?: string | null;
    last_request_at?: string | null;
}

export interface LlmUsageTimeBucket extends LlmUsageTotals {
    bucket_key: string;
    bucket_label: string;
    bucket_start: string;
    bucket_end: string;
}

export interface LlmUsageEvent {
    id: string;
    provider: string;
    model_id: string;
    api_surface: string;
    api_surface_label: string;
    request_kind: string;
    request_kind_label: string;
    status: string;
    provider_response_id?: string | null;
    workflow_id?: string | null;
    workflow_name?: string | null;
    workflow_status?: string | null;
    workflow_type?: string | null;
    template_id?: string | null;
    account_id?: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens: number;
    cache_write_tokens: number;
    reasoning_tokens: number;
    cached_tokens_reported: boolean;
    reasoning_tokens_reported: boolean;
    input_audio_tokens: number;
    output_audio_tokens: number;
    image_tokens: number;
    video_tokens: number;
    provider_cost?: number | null;
    provider_cost_currency?: string | null;
    latency_ms?: number | null;
    is_byok?: boolean | null;
    usage: Record<string, unknown>;
    cost_details: Record<string, unknown>;
    metadata: Record<string, unknown>;
    error?: string | null;
    started_at: string;
    completed_at: string;
    created_at: string;
}

export interface LlmUsageOverview {
    generated_at: string;
    filters: LlmUsageFilters;
    totals: LlmUsageTotals;
    today: LlmUsageTotals;
    current_week: LlmUsageTotals;
    current_month: LlmUsageTotals;
    by_provider: LlmUsageGroup[];
    by_model: LlmUsageGroup[];
    top_workflows: LlmUsageGroup[];
    request_kinds: LlmUsageGroup[];
    notes: string[];
}

export interface LlmUsageTimeseries {
    generated_at: string;
    granularity: LlmUsageGranularity;
    filters: LlmUsageFilters;
    buckets: LlmUsageTimeBucket[];
}

export interface LlmUsageEventsPage {
    generated_at: string;
    filters: LlmUsageFilters;
    limit: number;
    items: LlmUsageEvent[];
}

export interface WorkflowLlmUsageSummary {
    workflow_id: string;
    filters: LlmUsageFilters;
    totals: LlmUsageTotals;
    daily: LlmUsageTimeBucket[];
    request_kinds: LlmUsageGroup[];
}
