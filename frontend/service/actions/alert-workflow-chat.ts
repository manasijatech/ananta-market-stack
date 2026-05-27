"use server";

import { revalidatePath } from "next/cache";
import { fetchFastApi } from "@/lib/fastapi";
import type {
    AlertWorkflowChatEvent,
    AlertWorkflowChatEventsPage,
    AlertWorkflowChatPreference,
    AlertWorkflowChatPreferenceUpdate,
    AlertWorkflowChatQueueHealth,
    AlertWorkflowChatRun,
    AlertWorkflowChatSession,
    AlertWorkflowChatSnapshot,
    AlertWorkflowChatSnapshotApplyResult,
    AlertWorkflowChatSubmitRequest,
    AlertWorkflowChatSubmitResponse
} from "@/service/types/alert-workflow-chat";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJson(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { detail: text };
    }
}

function extractMessage(payload: unknown, fallback: string): string {
    if (!isJsonObject(payload)) return fallback;
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.message === "string") return payload.message;
    return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchFastApi(path, {
        ...init,
        headers: {
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...Object.fromEntries(new Headers(init.headers).entries())
        }
    });
    const payload = await parseJson(response);
    if (!response.ok) {
        throw new Error(extractMessage(payload, "Request failed."));
    }
    return payload as T;
}

export async function getAlertWorkflowChatConfig(): Promise<AlertWorkflowChatPreference> {
    return request<AlertWorkflowChatPreference>("/alert-workflow-chat/config");
}

export async function updateAlertWorkflowChatConfig(
    payload: AlertWorkflowChatPreferenceUpdate
): Promise<AlertWorkflowChatPreference> {
    return request<AlertWorkflowChatPreference>("/alert-workflow-chat/config", {
        method: "PUT",
        body: JSON.stringify(payload)
    });
}

export async function getAlertWorkflowChatQueueHealth(): Promise<AlertWorkflowChatQueueHealth> {
    return request<AlertWorkflowChatQueueHealth>("/alert-workflow-chat/queue/health");
}

export async function createAlertWorkflowChatSession(payload: {
    title?: string | null;
    workflow_id?: string | null;
    draft_workflow?: Record<string, unknown> | null;
}): Promise<AlertWorkflowChatSession> {
    const result = await request<AlertWorkflowChatSession>("/alert-workflow-chat/sessions", {
        method: "POST",
        body: JSON.stringify(payload)
    });
    revalidatePath("/alerts-workspace/workflows");
    return result;
}

export async function getAlertWorkflowChatSessions(params: { limit?: number } = {}): Promise<AlertWorkflowChatSession[]> {
    const limit = params.limit ?? 50;
    return request<AlertWorkflowChatSession[]>(`/alert-workflow-chat/sessions?limit=${limit}`);
}

export async function getAlertWorkflowChatSession(sessionId: string): Promise<AlertWorkflowChatSession> {
    return request<AlertWorkflowChatSession>(`/alert-workflow-chat/sessions/${sessionId}`);
}

export async function getAlertWorkflowChatRuns(params: {
    sessionId?: string;
    limit?: number;
} = {}): Promise<AlertWorkflowChatRun[]> {
    const limit = params.limit ?? 50;
    if (params.sessionId) {
        return request<AlertWorkflowChatRun[]>(
            `/alert-workflow-chat/sessions/${params.sessionId}/runs?limit=${limit}`
        );
    }
    return request<AlertWorkflowChatRun[]>(`/alert-workflow-chat/runs?limit=${limit}`);
}

export async function submitAlertWorkflowChatRun(
    payload: AlertWorkflowChatSubmitRequest
): Promise<AlertWorkflowChatSubmitResponse> {
    const result = await request<AlertWorkflowChatSubmitResponse>("/alert-workflow-chat/runs", {
        method: "POST",
        body: JSON.stringify(payload)
    });
    revalidatePath("/alerts-workspace/workflows");
    if (result.session.workflow_id) {
        revalidatePath(`/alerts-workspace/workflows/${result.session.workflow_id}`);
    }
    return result;
}

export async function getAlertWorkflowChatRun(runId: string): Promise<AlertWorkflowChatRun> {
    return request<AlertWorkflowChatRun>(`/alert-workflow-chat/runs/${runId}`);
}

export async function cancelAlertWorkflowChatRun(runId: string): Promise<AlertWorkflowChatRun> {
    return request<AlertWorkflowChatRun>(`/alert-workflow-chat/runs/${runId}/cancel`, { method: "POST" });
}

export async function getAlertWorkflowChatEvents(
    runId: string,
    params: { afterSequence?: number; limit?: number } = {}
): Promise<AlertWorkflowChatEventsPage> {
    const query = new URLSearchParams();
    if (params.afterSequence !== undefined) query.set("after_sequence", String(params.afterSequence));
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<AlertWorkflowChatEventsPage>(`/alert-workflow-chat/runs/${runId}/events${suffix}`);
}

export async function getAlertWorkflowChatSnapshots(sessionId: string): Promise<AlertWorkflowChatSnapshot[]> {
    return request<AlertWorkflowChatSnapshot[]>(`/alert-workflow-chat/sessions/${sessionId}/snapshots`);
}

export async function getAlertWorkflowChatSnapshot(snapshotId: string): Promise<AlertWorkflowChatSnapshot> {
    return request<AlertWorkflowChatSnapshot>(`/alert-workflow-chat/snapshots/${snapshotId}`);
}

export async function applyAlertWorkflowChatSnapshot(snapshotId: string): Promise<AlertWorkflowChatSnapshotApplyResult> {
    const result = await request<AlertWorkflowChatSnapshotApplyResult>(
        `/alert-workflow-chat/snapshots/${snapshotId}/apply`,
        { method: "POST" }
    );
    revalidatePath("/alerts-workspace/workflows");
    revalidatePath(`/alerts-workspace/workflows/${result.workflow.id}`);
    return result;
}

export async function deployAlertWorkflowChatSnapshot(snapshotId: string): Promise<AlertWorkflowChatSnapshotApplyResult> {
    const result = await request<AlertWorkflowChatSnapshotApplyResult>(
        `/alert-workflow-chat/snapshots/${snapshotId}/deploy`,
        { method: "POST" }
    );
    revalidatePath("/alerts-workspace");
    revalidatePath("/alerts-workspace/workflows");
    revalidatePath(`/alerts-workspace/workflows/${result.workflow.id}`);
    return result;
}

export async function getAlertWorkflowChatRunEvents(runId: string): Promise<AlertWorkflowChatEvent[]> {
    const page = await getAlertWorkflowChatEvents(runId);
    return page.events;
}
