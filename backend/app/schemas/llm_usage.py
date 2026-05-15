from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


LlmUsageGranularity = Literal["daily", "weekly", "monthly"]


class LlmUsageFilterOut(BaseModel):
    date_from: date | None = Field(default=None, description="Inclusive lower bound for usage history.")
    date_to: date | None = Field(default=None, description="Inclusive upper bound for usage history.")
    provider: str | None = Field(default=None, description="Optional provider filter such as openai, openrouter, or gemini.")
    model_id: str | None = Field(default=None, description="Optional exact model id filter.")
    workflow_id: str | None = Field(default=None, description="Optional workflow id filter. Historical rows remain even after workflow deletion.")
    request_kind: str | None = Field(default=None, description="Optional request-kind filter such as workflow_llm_analysis or workflow_feed_trigger.")
    api_surface: str | None = Field(default=None, description="Optional API surface filter such as chat_completions or responses_api.")


class LlmUsageTotalsOut(BaseModel):
    request_count: int = Field(default=0, description="Total LLM requests recorded in the selected slice.")
    success_count: int = Field(default=0, description="Requests that completed successfully.")
    error_count: int = Field(default=0, description="Requests that failed after reaching a provider call path.")
    prompt_tokens: int = Field(default=0, description="Total input tokens recorded from provider usage metadata.")
    completion_tokens: int = Field(default=0, description="Total output tokens recorded from provider usage metadata.")
    total_tokens: int = Field(default=0, description="Total tokens across prompt and completion.")
    cached_tokens: int = Field(default=0, description="Prompt-cache hit tokens when reported by the provider.")
    cache_write_tokens: int = Field(default=0, description="Prompt-cache write tokens when reported by the provider.")
    reasoning_tokens: int = Field(default=0, description="Reasoning tokens when the provider exposes them.")
    input_audio_tokens: int = Field(default=0, description="Audio input tokens when reported.")
    output_audio_tokens: int = Field(default=0, description="Audio output tokens when reported.")
    image_tokens: int = Field(default=0, description="Image output tokens when reported.")
    video_tokens: int = Field(default=0, description="Video input tokens when reported.")
    provider_cost_total: float = Field(default=0.0, description="Sum of provider-reported cost only. No local estimation is added when a provider omits cost.")
    priced_request_count: int = Field(default=0, description="Number of requests with provider-reported cost.")


class LlmUsageGroupOut(LlmUsageTotalsOut):
    provider: str | None = Field(default=None, description="Provider bucket when grouping by provider.")
    model_id: str | None = Field(default=None, description="Model bucket when grouping by model.")
    workflow_id: str | None = Field(default=None, description="Workflow bucket. This may reference a deleted workflow.")
    workflow_name: str | None = Field(default=None, description="Workflow name captured at request time.")
    request_kind: str | None = Field(default=None, description="Request-kind bucket such as workflow_llm_analysis.")
    api_surface: str | None = Field(default=None, description="Underlying SDK API surface used for the request.")
    workflow_status: str | None = Field(default=None, description="Workflow status captured when the request was recorded.")
    workflow_type: str | None = Field(default=None, description="Workflow type captured when the request was recorded.")
    last_request_at: datetime | None = Field(default=None, description="Most recent request timestamp inside this grouped bucket.")


class LlmUsageTimeBucketOut(LlmUsageTotalsOut):
    bucket_key: str = Field(description="Stable bucket identifier. For daily this is YYYY-MM-DD, for weekly YYYY-Www, for monthly YYYY-MM.")
    bucket_label: str = Field(description="Human-readable bucket label for charts.")
    bucket_start: date = Field(description="Start date of the bucket in UTC calendar terms.")
    bucket_end: date = Field(description="End date of the bucket in UTC calendar terms.")


class LlmUsageEventOut(BaseModel):
    id: str = Field(description="Persistent usage-event id.")
    provider: str = Field(description="LLM provider used for the request.")
    model_id: str = Field(description="Model id requested from the provider.")
    api_surface: str = Field(description="SDK surface used, for example chat_completions or responses_api.")
    request_kind: str = Field(description="Backend request category, useful for dashboard segmentation.")
    status: str = Field(description="success or error.")
    provider_response_id: str | None = Field(default=None, description="Provider response/request id when returned by the SDK.")
    workflow_id: str | None = Field(default=None, description="Workflow id captured at request time.")
    workflow_name: str | None = Field(default=None, description="Workflow name captured at request time.")
    workflow_status: str | None = Field(default=None, description="Workflow status captured at request time.")
    workflow_type: str | None = Field(default=None, description="Workflow type captured at request time.")
    template_id: str | None = Field(default=None, description="Template id captured at request time when relevant.")
    account_id: str | None = Field(default=None, description="Broker account id captured at request time when relevant.")
    prompt_tokens: int = Field(default=0, description="Input tokens reported by the provider.")
    completion_tokens: int = Field(default=0, description="Output tokens reported by the provider.")
    total_tokens: int = Field(default=0, description="Total tokens reported by the provider.")
    cached_tokens: int = Field(default=0, description="Prompt-cache hit tokens when reported.")
    cache_write_tokens: int = Field(default=0, description="Prompt-cache write tokens when reported.")
    reasoning_tokens: int = Field(default=0, description="Reasoning tokens when reported.")
    input_audio_tokens: int = Field(default=0, description="Audio input tokens when reported.")
    output_audio_tokens: int = Field(default=0, description="Audio output tokens when reported.")
    image_tokens: int = Field(default=0, description="Image output tokens when reported.")
    video_tokens: int = Field(default=0, description="Video input tokens when reported.")
    provider_cost: float | None = Field(default=None, description="Provider-reported cost only. Null means the provider response did not include cost.")
    provider_cost_currency: str | None = Field(default=None, description="Units associated with provider_cost, such as credits for OpenRouter.")
    latency_ms: int | None = Field(default=None, description="Observed end-to-end SDK call latency in milliseconds.")
    is_byok: bool | None = Field(default=None, description="Bring-your-own-key indicator when a provider reports it.")
    usage: dict[str, Any] = Field(default_factory=dict, description="Normalized usage payload plus raw provider usage details.")
    cost_details: dict[str, Any] = Field(default_factory=dict, description="Provider cost breakdown when returned.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Backend-side request metadata captured for dashboard filtering.")
    error: str | None = Field(default=None, description="Error string for failed requests.")
    started_at: datetime = Field(description="When the backend started the provider request.")
    completed_at: datetime = Field(description="When the backend finished the provider request.")
    created_at: datetime = Field(description="When the event row was persisted.")


class LlmUsageOverviewOut(BaseModel):
    generated_at: datetime = Field(description="When the overview response was generated.")
    filters: LlmUsageFilterOut = Field(description="Effective filters applied to all aggregate sections.")
    totals: LlmUsageTotalsOut = Field(description="All-time totals inside the selected filters.")
    today: LlmUsageTotalsOut = Field(description="Totals for the current UTC day under the same filters.")
    current_week: LlmUsageTotalsOut = Field(description="Totals for the current UTC ISO week under the same filters.")
    current_month: LlmUsageTotalsOut = Field(description="Totals for the current UTC month under the same filters.")
    by_provider: list[LlmUsageGroupOut] = Field(default_factory=list, description="Grouped totals per provider.")
    by_model: list[LlmUsageGroupOut] = Field(default_factory=list, description="Grouped totals per provider+model.")
    top_workflows: list[LlmUsageGroupOut] = Field(default_factory=list, description="Highest-usage workflow groups, including deleted workflows because identity is denormalized.")
    request_kinds: list[LlmUsageGroupOut] = Field(default_factory=list, description="Grouped totals per backend request kind.")
    notes: list[str] = Field(default_factory=list, description="Important interpretation notes for frontend and AI agent consumers.")


class LlmUsageTimeseriesOut(BaseModel):
    generated_at: datetime = Field(description="When the timeseries response was generated.")
    granularity: LlmUsageGranularity = Field(description="Grouping granularity applied to the returned buckets.")
    filters: LlmUsageFilterOut = Field(description="Effective filters used to build the series.")
    buckets: list[LlmUsageTimeBucketOut] = Field(default_factory=list, description="Ordered usage buckets.")


class LlmUsageEventsPageOut(BaseModel):
    generated_at: datetime = Field(description="When the page response was generated.")
    filters: LlmUsageFilterOut = Field(description="Effective filters applied to the event list.")
    limit: int = Field(description="Requested page size.")
    items: list[LlmUsageEventOut] = Field(default_factory=list, description="Most recent matching usage events.")


class WorkflowLlmUsageSummaryOut(BaseModel):
    workflow_id: str = Field(description="Requested workflow id.")
    filters: LlmUsageFilterOut = Field(description="Effective filters used for this workflow summary.")
    totals: LlmUsageTotalsOut = Field(description="Aggregate usage totals for the workflow across its lifetime in the ledger.")
    daily: list[LlmUsageTimeBucketOut] = Field(default_factory=list, description="Daily buckets for the workflow.")
    request_kinds: list[LlmUsageGroupOut] = Field(default_factory=list, description="Workflow usage split by backend request kind.")
