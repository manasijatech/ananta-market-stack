"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type {
    AdaptiveWorkspaceCatalogItem,
    AdaptiveWorkspaceCurrent,
    AdaptiveWorkspacePreference,
    AdaptiveWorkspaceSavedDesk,
    AdaptiveWorkspaceSnapshot,
    AdaptiveWorkspaceSuggestion,
    AdaptiveAlertStudio,
    WorkspaceSpec
} from "@/service/types/adaptive-workspace";

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
        throw new Error(extractMessage(payload, "Adaptive workspace request failed."));
    }
    return payload as T;
}

export async function getAdaptiveWorkspaceCurrent(sessionId: string): Promise<AdaptiveWorkspaceCurrent> {
    return request<AdaptiveWorkspaceCurrent>(`/adaptive-workspace/sessions/${sessionId}/current`);
}

export async function listAdaptiveWorkspaceSnapshots(sessionId: string): Promise<AdaptiveWorkspaceSnapshot[]> {
    return request<AdaptiveWorkspaceSnapshot[]>(`/adaptive-workspace/sessions/${sessionId}/snapshots`);
}

export async function createAdaptiveWorkspaceSnapshot(
    sessionId: string,
    spec: WorkspaceSpec,
    label = "Canvas edit"
): Promise<AdaptiveWorkspaceSnapshot> {
    return request<AdaptiveWorkspaceSnapshot>(`/adaptive-workspace/sessions/${sessionId}/snapshots`, {
        body: JSON.stringify({ apply: true, label, workspace_payload: spec }),
        method: "POST"
    });
}

export async function applyAdaptiveWorkspaceSnapshot(snapshotId: string): Promise<AdaptiveWorkspaceCurrent> {
    return request<AdaptiveWorkspaceCurrent>(`/adaptive-workspace/snapshots/${snapshotId}/apply`, {
        method: "POST"
    });
}

export async function listAdaptiveWorkspaceTemplates(): Promise<AdaptiveWorkspaceCatalogItem[]> {
    return request<AdaptiveWorkspaceCatalogItem[]>("/adaptive-workspace/templates");
}

export async function applyAdaptiveWorkspaceTemplate(
    templateId: string,
    sessionId: string
): Promise<AdaptiveWorkspaceCurrent> {
    return request<AdaptiveWorkspaceCurrent>(
        `/adaptive-workspace/templates/${templateId}/apply?session_id=${encodeURIComponent(sessionId)}`,
        { body: JSON.stringify({ confirm: true }), method: "POST" }
    );
}

export async function listAdaptiveWorkspaceSkills(): Promise<AdaptiveWorkspaceCatalogItem[]> {
    return request<AdaptiveWorkspaceCatalogItem[]>("/adaptive-workspace/skills");
}

export async function applyAdaptiveWorkspaceSkill(skillId: string, sessionId: string): Promise<AdaptiveWorkspaceCurrent> {
    return request<AdaptiveWorkspaceCurrent>(
        `/adaptive-workspace/skills/${skillId}/apply?session_id=${encodeURIComponent(sessionId)}`,
        { body: JSON.stringify({ confirm: true }), method: "POST" }
    );
}

export async function listAdaptiveWorkspaceDesks(): Promise<AdaptiveWorkspaceSavedDesk[]> {
    return request<AdaptiveWorkspaceSavedDesk[]>("/adaptive-workspace/desks");
}

export async function saveAdaptiveWorkspaceDesk(name: string, spec: WorkspaceSpec): Promise<AdaptiveWorkspaceSavedDesk> {
    return request<AdaptiveWorkspaceSavedDesk>("/adaptive-workspace/desks", {
        body: JSON.stringify({ name, workspace_payload: spec }),
        method: "POST"
    });
}

export async function renameAdaptiveWorkspaceDesk(deskId: string, name: string): Promise<AdaptiveWorkspaceSavedDesk> {
    return request<AdaptiveWorkspaceSavedDesk>(`/adaptive-workspace/desks/${deskId}`, {
        body: JSON.stringify({ name }),
        method: "PATCH"
    });
}

export async function applyAdaptiveWorkspaceDesk(deskId: string, sessionId: string): Promise<AdaptiveWorkspaceCurrent> {
    return request<AdaptiveWorkspaceCurrent>(
        `/adaptive-workspace/desks/${deskId}/apply?session_id=${encodeURIComponent(sessionId)}`,
        { method: "POST" }
    );
}

export async function deleteAdaptiveWorkspaceDesk(deskId: string): Promise<void> {
    await request(`/adaptive-workspace/desks/${deskId}`, { method: "DELETE" });
}

export async function listAdaptiveWorkspacePreferences(): Promise<AdaptiveWorkspacePreference[]> {
    return request<AdaptiveWorkspacePreference[]>("/adaptive-workspace/preferences");
}

export async function putAdaptiveWorkspacePreference(key: string, value: unknown): Promise<AdaptiveWorkspacePreference> {
    return request<AdaptiveWorkspacePreference>("/adaptive-workspace/preferences", {
        body: JSON.stringify({ key, value }),
        method: "PUT"
    });
}

export async function deleteAdaptiveWorkspacePreference(key: string): Promise<void> {
    await request(`/adaptive-workspace/preferences/${key}`, { method: "DELETE" });
}

export async function listAdaptiveWorkspaceSuggestions(): Promise<AdaptiveWorkspaceSuggestion[]> {
    return request<AdaptiveWorkspaceSuggestion[]>("/adaptive-workspace/suggestions");
}

export async function getAdaptiveAlertStudio(params?: {
    snapshotId?: string;
    workflowId?: string;
}): Promise<AdaptiveAlertStudio> {
    const query = new URLSearchParams();
    if (params?.workflowId) query.set("workflow_id", params.workflowId);
    if (params?.snapshotId) query.set("snapshot_id", params.snapshotId);
    const encoded = query.toString();
    const suffix = encoded ? `?${encoded}` : "";
    return request<AdaptiveAlertStudio>(`/adaptive-workspace/alert-studio${suffix}`);
}

export async function refreshAdaptiveAlertStudio(workflowId?: string): Promise<AdaptiveAlertStudio> {
    const suffix = workflowId ? `?workflow_id=${encodeURIComponent(workflowId)}` : "";
    return request<AdaptiveAlertStudio>(`/adaptive-workspace/alert-studio/refresh${suffix}`, {
        method: "POST"
    });
}

export async function createAdaptiveAlertStudioDraft(payload: {
    exchange?: string;
    field?: string;
    name?: string;
    operator?: string;
    symbol: string;
    value: number;
}): Promise<AdaptiveAlertStudio> {
    return request<AdaptiveAlertStudio>("/adaptive-workspace/alert-studio/draft", {
        body: JSON.stringify(payload),
        method: "POST"
    });
}

export async function deployAdaptiveAlertStudio(snapshotId: string, confirm: boolean): Promise<AdaptiveAlertStudio> {
    return request<AdaptiveAlertStudio>("/adaptive-workspace/alert-studio/deploy", {
        body: JSON.stringify({ confirm, snapshot_id: snapshotId }),
        method: "POST"
    });
}
