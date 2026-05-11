"use server";

import { revalidatePath } from "next/cache";
import { fetchFastApi } from "@/lib/fastapi";
import type {
  AlertChannel,
  AlertChannelSelection,
  AlertGraphDsl,
  AlertNotification,
  AlertTemplate,
  AlertUnreadCount,
  AlertWorkflow,
  AlertWorkflowDsl,
  AlertWorkflowRun,
  LiveStreamsStatus,
  LiveSubscription
} from "@/service/types/alerts";
import type { BrokerCode } from "@/service/types/broker";

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

export async function getAlertTemplates(): Promise<AlertTemplate[]> {
  return request<AlertTemplate[]>("/alert-templates");
}

export async function instantiateAlertTemplate(payload: {
  template_id: string;
  name?: string;
  account_id?: string | null;
  broker_code?: BrokerCode | string | null;
  symbol?: string | null;
  exchange?: string | null;
  instrument_ref?: Record<string, unknown>;
}): Promise<AlertWorkflow> {
  const result = await request<AlertWorkflow>(`/alert-templates/${payload.template_id}/instantiate`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  revalidatePath("/alerts");
  revalidatePath("/alerts/workflows");
  return result;
}

export async function getAlertWorkflows(status?: string): Promise<AlertWorkflow[]> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<AlertWorkflow[]>(`/alert-workflows${suffix}`);
}

export async function getAlertWorkflow(id: string): Promise<AlertWorkflow> {
  return request<AlertWorkflow>(`/alert-workflows/${id}`);
}

export async function createAlertWorkflow(payload: {
  template_id?: string | null;
  name: string;
  description?: string;
  account_id?: string | null;
  broker_code?: BrokerCode | string | null;
  symbol?: string | null;
  exchange?: string | null;
  instrument_ref?: Record<string, unknown>;
  workflow_dsl: AlertWorkflowDsl;
  graph_dsl: AlertGraphDsl;
  editor_mode: "rule" | "graph";
  channel_override?: AlertChannelSelection | null;
}): Promise<AlertWorkflow> {
  const result = await request<AlertWorkflow>("/alert-workflows", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  revalidatePath("/alerts");
  revalidatePath("/alerts/workflows");
  return result;
}

export async function updateAlertWorkflow(id: string, payload: JsonObject): Promise<AlertWorkflow> {
  const result = await request<AlertWorkflow>(`/alert-workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  revalidatePath("/alerts");
  revalidatePath("/alerts/workflows");
  revalidatePath(`/alerts/workflows/${id}`);
  return result;
}

export async function setAlertWorkflowStatus(id: string, status: "active" | "inactive"): Promise<AlertWorkflow> {
  const result = await request<AlertWorkflow>(`/alert-workflows/${id}/${status === "active" ? "enable" : "disable"}`, {
    method: "POST"
  });
  revalidatePath("/alerts");
  revalidatePath("/alerts/workflows");
  revalidatePath(`/alerts/workflows/${id}`);
  return result;
}

export async function duplicateAlertWorkflow(id: string): Promise<AlertWorkflow> {
  const result = await request<AlertWorkflow>(`/alert-workflows/${id}/duplicate`, {
    method: "POST"
  });
  revalidatePath("/alerts/workflows");
  return result;
}

export async function deleteAlertWorkflow(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/alert-workflows/${id}`, { method: "DELETE" });
  revalidatePath("/alerts");
  revalidatePath("/alerts/workflows");
}

export async function testAlertWorkflow(id: string, tick: Record<string, unknown>): Promise<{ matched: boolean; reason: string }> {
  return request<{ matched: boolean; reason: string }>(`/alert-workflows/${id}/test`, {
    method: "POST",
    body: JSON.stringify({ tick })
  });
}

export async function sendWorkflowTestNotification(id: string, tick: Record<string, unknown>): Promise<{ notification_id: string; message: string }> {
  return request<{ notification_id: string; message: string }>(`/alert-workflows/${id}/test-notification`, {
    method: "POST",
    body: JSON.stringify({ tick })
  });
}

export async function getAlertWorkflowRuns(id: string, limit = 50): Promise<AlertWorkflowRun[]> {
  return request<AlertWorkflowRun[]>(`/alert-workflows/${id}/runs?limit=${encodeURIComponent(String(limit))}`);
}

export async function getAlertHistory(limit = 50): Promise<AlertWorkflowRun[]> {
  return request<AlertWorkflowRun[]>(`/alert-workflows/history/all?limit=${encodeURIComponent(String(limit))}`);
}

export async function getAlertNotifications(params: { unread_only?: boolean; workflow_id?: string; limit?: number } = {}): Promise<AlertNotification[]> {
  const query = new URLSearchParams();
  if (params.unread_only) query.set("unread_only", "true");
  if (params.workflow_id) query.set("workflow_id", params.workflow_id);
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<AlertNotification[]>(`/alert-notifications${suffix}`);
}

export async function getAlertUnreadCount(): Promise<AlertUnreadCount> {
  return request<AlertUnreadCount>("/alert-notifications/unread-count");
}

export async function markAlertNotificationRead(id: string): Promise<AlertNotification> {
  return request<AlertNotification>(`/alert-notifications/${id}/read`, { method: "POST" });
}

export async function readAllAlertNotifications(): Promise<{ updated: number }> {
  return request<{ updated: number }>("/alert-notifications/read-all", { method: "POST" });
}

export async function sendTestAlert(payload: {
  title?: string;
  message?: string;
  level?: string;
  channels?: string[];
} = {}): Promise<AlertNotification> {
  return request<AlertNotification>("/alert-notifications/test", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getAlertChannels(): Promise<AlertChannel[]> {
  return request<AlertChannel[]>("/alert-channels");
}

export async function saveAlertChannel(
  channelType: string,
  payload: { label?: string; is_enabled: boolean; is_default: boolean; config: Record<string, unknown> }
): Promise<AlertChannel> {
  const result = await request<AlertChannel>(`/alert-channels/${channelType}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  revalidatePath("/alert-channels");
  return result;
}

export async function testAlertChannel(channelType: string, message: string): Promise<AlertChannel> {
  return request<AlertChannel>(`/alert-channels/${channelType}/test`, {
    method: "POST",
    body: JSON.stringify({ message })
  });
}

export async function getLiveStreamsStatus(): Promise<LiveStreamsStatus> {
  return request<LiveStreamsStatus>("/live-streams/status");
}

export async function getLiveSubscriptions(): Promise<LiveSubscription[]> {
  return request<LiveSubscription[]>("/live-streams/subscriptions");
}

export async function addLiveSubscription(payload: {
  account_id?: string | null;
  broker_code?: string | null;
  workflow_id?: string | null;
  symbol: string;
  exchange?: string | null;
  instrument_ref?: Record<string, unknown>;
  source_kind?: string;
}): Promise<LiveSubscription> {
  const result = await request<LiveSubscription>("/live-streams/subscriptions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function addLiveSubscriptionsBulk(payload: {
  subscriptions: Array<{
    account_id?: string | null;
    broker_code?: string | null;
    workflow_id?: string | null;
    symbol: string;
    exchange?: string | null;
    instrument_ref?: Record<string, unknown>;
    source_kind?: string;
  }>;
}): Promise<LiveSubscription[]> {
  const result = await request<LiveSubscription[]>("/live-streams/subscriptions/bulk", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function replaceLiveSubscriptions(payload: { subscriptions: Array<Record<string, unknown>> }): Promise<LiveSubscription[]> {
  const result = await request<LiveSubscription[]>("/live-streams/subscriptions/replace", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}

export async function deleteLiveSubscription(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/live-streams/subscriptions/${id}`, { method: "DELETE" });
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
}

export async function deleteLiveSubscriptions(ids: string[]): Promise<{ deleted: number }> {
  const query = new URLSearchParams({ subscription_ids: ids.join(",") });
  const result = await request<{ deleted: number }>(`/live-streams/subscriptions?${query.toString()}`, { method: "DELETE" });
  revalidatePath("/alerts/subscriptions");
  revalidatePath("/alerts/stream-manager");
  return result;
}
