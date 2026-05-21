import type { LlmProvider } from "@/service/types/broker";

export type BrokerChatVisibility = "minimal" | "tool_calls" | "full";
export type BrokerChatStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | string;

export type BrokerChatPayload = Record<string, unknown>;

export interface BrokerChatPreference {
    default_provider?: LlmProvider | null;
    default_model?: string | null;
    event_visibility: BrokerChatVisibility;
    include_tool_outputs: boolean;
    include_reasoning: boolean;
    use_mcp: boolean;
}

export interface BrokerChatPreferenceUpdate {
    default_provider?: LlmProvider | null;
    default_model?: string | null;
    event_visibility: BrokerChatVisibility;
    include_tool_outputs: boolean;
    include_reasoning: boolean;
    use_mcp: boolean;
}

export interface BrokerChatSession {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export interface BrokerChatRun {
    id: string;
    session_id: string;
    user_id: string;
    status: BrokerChatStatus;
    job_id?: string | null;
    provider: string;
    model_id: string;
    message: string;
    response_text: string;
    error?: string | null;
    event_visibility: BrokerChatVisibility | string;
    include_tool_outputs: boolean;
    include_reasoning: boolean;
    metadata_json: string;
    queued_at: string;
    started_at?: string | null;
    completed_at?: string | null;
    created_at: string;
    updated_at: string;
}

export interface BrokerChatSubmitRequest {
    message: string;
    session_id?: string | null;
    session_title?: string | null;
    provider?: LlmProvider | null;
    model?: string | null;
    event_visibility?: BrokerChatVisibility | null;
    include_tool_outputs?: boolean | null;
    include_reasoning?: boolean | null;
    use_mcp?: boolean | null;
    default_account_id?: string | null;
    search_account_id?: string | null;
    metadata?: BrokerChatPayload;
}

export interface BrokerChatSubmitResponse {
    run: BrokerChatRun;
    stream_url: string;
    status_url: string;
    events_url: string;
}

export interface BrokerChatEvent {
    id: string;
    run_id: string;
    sequence: number;
    event_type: string;
    payload: BrokerChatPayload;
    created_at: string;
}

export interface BrokerChatEventsPage {
    run: BrokerChatRun;
    events: BrokerChatEvent[];
    next_after_sequence?: number | null;
}

export interface BrokerChatQueueHealth {
    queue_name: string;
    queued_count: number;
    active_worker_count: number;
    has_active_worker: boolean;
    in_process_worker_enabled: boolean;
    has_processing_path: boolean;
    workers: Array<{
        name?: string;
        state?: string;
        queues?: string[];
    }>;
}
