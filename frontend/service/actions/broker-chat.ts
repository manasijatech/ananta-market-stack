"use server";

import { revalidatePath } from "next/cache";
import { fetchFastApi } from "@/lib/fastapi";
import type {
    BrokerChatEvent,
    BrokerChatEventsPage,
    BrokerChatPreference,
    BrokerChatPreferenceUpdate,
    BrokerChatRun,
    BrokerChatSession,
    BrokerChatSubmitRequest,
    BrokerChatSubmitResponse,
    BrokerChatVisibility
} from "@/service/types/broker-chat";

type FastApiValidationItem = {
    loc?: (string | number)[];
    msg?: string;
    type?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJson(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return null;
    }
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { detail: text };
    }
}

function extractMessage(payload: unknown, fallback: string): string {
    if (!isRecord(payload)) {
        return fallback;
    }
    if (typeof payload.detail === "string") {
        return payload.detail;
    }
    if (Array.isArray(payload.detail)) {
        const first = payload.detail.find((item): item is FastApiValidationItem => {
            return isRecord(item) && typeof item.msg === "string";
        });
        if (first?.msg) {
            return first.msg;
        }
    }
    if (typeof payload.message === "string") {
        return payload.message;
    }
    return fallback;
}

async function readResponse<T>(response: Response): Promise<T> {
    const payload = await parseJson(response);
    if (!response.ok) {
        const message =
            response.status >= 500
                ? "The broker chat service is unavailable. Please try again."
                : extractMessage(payload, "Broker chat request failed.");
        throw new Error(message);
    }
    return payload as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchFastApi(path, {
        ...init,
        headers: {
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...Object.fromEntries(new Headers(init.headers).entries())
        }
    });
    return readResponse<T>(response);
}

export async function getBrokerChatConfig(): Promise<BrokerChatPreference> {
    return request<BrokerChatPreference>("/broker-chat/config");
}

export async function updateBrokerChatConfig(payload: BrokerChatPreferenceUpdate): Promise<BrokerChatPreference> {
    const result = await request<BrokerChatPreference>("/broker-chat/config", {
        method: "PUT",
        body: JSON.stringify(payload)
    });
    revalidatePath("/broker-chat");
    return result;
}

export async function getBrokerChatSessions(limit = 50): Promise<BrokerChatSession[]> {
    return request<BrokerChatSession[]>(`/broker-chat/sessions?limit=${limit}`);
}

export async function createBrokerChatSession(title?: string | null): Promise<BrokerChatSession> {
    const result = await request<BrokerChatSession>("/broker-chat/sessions", {
        method: "POST",
        body: JSON.stringify({ title: title || null })
    });
    revalidatePath("/broker-chat");
    return result;
}

export async function getBrokerChatRuns(params: {
    sessionId?: string | null;
    limit?: number;
} = {}): Promise<BrokerChatRun[]> {
    const limit = params.limit ?? 100;
    if (params.sessionId) {
        return request<BrokerChatRun[]>(`/broker-chat/sessions/${params.sessionId}/runs?limit=${limit}`);
    }
    return request<BrokerChatRun[]>(`/broker-chat/runs?limit=${limit}`);
}

export async function submitBrokerChatRun(payload: BrokerChatSubmitRequest): Promise<BrokerChatSubmitResponse> {
    const result = await request<BrokerChatSubmitResponse>("/broker-chat/runs", {
        method: "POST",
        body: JSON.stringify(payload)
    });
    revalidatePath("/broker-chat");
    return result;
}

export async function getBrokerChatEvents(
    runId: string,
    params: {
        afterSequence?: number | null;
        limit?: number;
        visibility?: BrokerChatVisibility;
        includeToolOutputs?: boolean;
        includeReasoning?: boolean;
    } = {}
): Promise<BrokerChatEventsPage> {
    const query = new URLSearchParams();
    query.set("limit", String(params.limit ?? 500));
    if (params.afterSequence !== undefined && params.afterSequence !== null) {
        query.set("after_sequence", String(params.afterSequence));
    }
    if (params.visibility) {
        query.set("visibility", params.visibility);
    }
    if (params.includeToolOutputs !== undefined) {
        query.set("include_tool_outputs", String(params.includeToolOutputs));
    }
    if (params.includeReasoning !== undefined) {
        query.set("include_reasoning", String(params.includeReasoning));
    }
    return request<BrokerChatEventsPage>(`/broker-chat/runs/${runId}/events?${query.toString()}`);
}

export async function getBrokerChatRun(runId: string): Promise<BrokerChatRun> {
    return request<BrokerChatRun>(`/broker-chat/runs/${runId}`);
}

export async function getBrokerChatRunEvents(runId: string): Promise<BrokerChatEvent[]> {
    const page = await getBrokerChatEvents(runId);
    return page.events;
}
