import type { AlertWorkflow, LlmProvider } from "@/service/types/alerts";

export type WorkflowChatStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | string;
export type WorkflowChatPayload = Record<string, unknown>;

export interface AlertWorkflowChatPreference {
    default_provider?: LlmProvider | null;
    default_model?: string | null;
}

export interface AlertWorkflowChatPreferenceUpdate {
    default_provider?: LlmProvider | null;
    default_model?: string | null;
}

export interface AlertWorkflowChatSession {
    id: string;
    user_id: string;
    workflow_id?: string | null;
    title: string;
    status: string;
    active_snapshot_id?: string | null;
    created_at: string;
    updated_at: string;
    workflow?: AlertWorkflow | null;
}

export interface AlertWorkflowChatRun {
    id: string;
    session_id: string;
    user_id: string;
    workflow_id?: string | null;
    status: WorkflowChatStatus;
    job_id?: string | null;
    provider: string;
    model_id: string;
    message: string;
    response_text: string;
    error?: string | null;
    metadata_json: string;
    queued_at: string;
    started_at?: string | null;
    completed_at?: string | null;
    created_at: string;
    updated_at: string;
}

export interface AlertWorkflowChatEvent {
    id: string;
    run_id: string;
    sequence: number;
    event_type: string;
    payload: WorkflowChatPayload;
    created_at: string;
}

export interface AlertWorkflowChatEventsPage {
    run: AlertWorkflowChatRun;
    events: AlertWorkflowChatEvent[];
    next_after_sequence?: number | null;
}

export interface AlertWorkflowChatSnapshot {
    id: string;
    session_id: string;
    run_id?: string | null;
    workflow_id: string;
    user_id: string;
    version: number;
    label: string;
    workflow_payload: WorkflowChatPayload;
    validation: WorkflowChatPayload;
    compile: WorkflowChatPayload;
    explanation: WorkflowChatPayload;
    samples: WorkflowChatPayload;
    diff: WorkflowChatPayload;
    valid: boolean;
    applied_at?: string | null;
    created_at: string;
}

export interface AlertWorkflowChatSubmitRequest {
    message: string;
    session_id?: string | null;
    session_title?: string | null;
    workflow_id?: string | null;
    draft_workflow?: WorkflowChatPayload | null;
    editor_payload?: WorkflowChatPayload;
    provider?: LlmProvider | null;
    model?: string | null;
    metadata?: WorkflowChatPayload;
}

export interface AlertWorkflowChatSubmitResponse {
    run: AlertWorkflowChatRun;
    session: AlertWorkflowChatSession;
    stream_url: string;
    status_url: string;
    events_url: string;
}

export interface AlertWorkflowChatSnapshotApplyResult {
    snapshot: AlertWorkflowChatSnapshot;
    workflow: AlertWorkflow;
}

export interface AlertWorkflowChatQueueHealth {
    queue_name: string;
    base_queue_name: string;
    queue_fingerprint: string;
    queued_count: number;
    oldest_job_id?: string | null;
    oldest_queued_seconds?: number | null;
    workers: Array<Record<string, unknown>>;
    active_worker_count: number;
    external_worker_count: number;
    fallback_worker_count: number;
    fallback_worker_available: boolean;
    has_active_worker: boolean;
    in_process_worker_enabled: boolean;
    has_processing_path: boolean;
}
