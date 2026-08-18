"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type { AdaptiveWorkspaceCurrent, AdaptiveWorkspaceSnapshot, WorkspaceSpec } from "@/service/types/adaptive-workspace";

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
