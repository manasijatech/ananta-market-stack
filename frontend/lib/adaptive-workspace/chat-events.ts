import type { UIMessage } from "ai";
import { isAdaptiveRenderTool } from "@/lib/adaptive-workspace/catalog";
import type { BrokerChatEvent, BrokerChatRun } from "@/service/types/broker-chat";

export const LIVE_BROKER_CHAT_STATUSES = new Set(["queued", "running"]);

type BrokerTraceItem =
    | {
          events: BrokerChatEvent[];
          key: string;
          kind: "reasoning";
          sequence: number;
          text: string;
      }
    | {
          callId?: string | null;
          key: string;
          kind: "tool";
          output?: BrokerChatEvent;
          sequence: number;
          start?: BrokerChatEvent;
          toolName: string;
      };

export function mergeBrokerChatRuns(existing: BrokerChatRun[], incoming: BrokerChatRun[]) {
    const byId = new Map(existing.map((item) => [item.id, item]));
    incoming.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
    return Array.from(byId.values()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function mergeBrokerChatEvents(existing: BrokerChatEvent[], incoming: BrokerChatEvent[]) {
    const bySequence = new Map(existing.map((item) => [item.sequence, item]));
    incoming.forEach((item) => bySequence.set(item.sequence, { ...bySequence.get(item.sequence), ...item }));
    return Array.from(bySequence.values()).sort((a, b) => a.sequence - b.sequence);
}

export function sortBrokerChatSessions<T extends { updated_at: string }>(sessions: T[]) {
    return [...sessions].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export function textPayload(payload: Record<string, unknown>, key: string) {
    const value = payload[key];
    return typeof value === "string" ? value : "";
}

function payloadValue(payload: Record<string, unknown> | undefined, key: string) {
    return payload && Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
}

export function parseSseBlock(block: string): { data?: string; event?: string; id?: string } | null {
    const event: { data?: string; event?: string; id?: string } = {};
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":") || line.startsWith("retry:")) {
            continue;
        }
        const separator = line.indexOf(":");
        const field = separator >= 0 ? line.slice(0, separator) : line;
        const rawValue = separator >= 0 ? line.slice(separator + 1) : "";
        const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
        if (field === "id") event.id = value;
        if (field === "event") event.event = value;
        if (field === "data") data.push(value);
    }
    if (!event.event && !event.id && !data.length) {
        return null;
    }
    event.data = data.join("\n");
    return event;
}

export function assistantText(events: BrokerChatEvent[], run: BrokerChatRun) {
    const completed =
        run.status === "completed" || run.status === "failed" || run.status === "cancelled";
    const completedEvent = [...events]
        .reverse()
        .find((event) => event.event_type === "run_completed" && textPayload(event.payload, "response_text"));
    if (completed) {
        return (
            (completedEvent ? textPayload(completedEvent.payload, "response_text") : "") ||
            run.response_text ||
            lastMessageOutput(events) ||
            tokenText(events)
        );
    }
    const lastOutput = lastMessageOutput(events);
    const lastOutputEvent = [...events]
        .reverse()
        .find((event) => event.event_type === "message_output" && textPayload(event.payload, "content"));
    const laterTokens = events
        .filter(
            (event) =>
                event.event_type === "token" &&
                (!lastOutputEvent || event.sequence > lastOutputEvent.sequence)
        )
        .map((event) => textPayload(event.payload, "text"))
        .join("");
    if (laterTokens) {
        return `${lastOutput}${laterTokens}`;
    }
    return lastOutput || tokenText(events) || run.response_text || "";
}

function lastMessageOutput(events: BrokerChatEvent[]) {
    const finalMessage = [...events]
        .reverse()
        .find((event) => event.event_type === "message_output" && textPayload(event.payload, "content"));
    return finalMessage ? textPayload(finalMessage.payload, "content") : "";
}

function tokenText(events: BrokerChatEvent[]) {
    return events
        .filter((event) => event.event_type === "token")
        .map((event) => textPayload(event.payload, "text"))
        .join("");
}

export function brokerChatToolPartType(toolName: string) {
    const name = toolName || "tool";
    const safe = name.replace(/[^A-Za-z0-9_]/g, "_") || "tool";
    if (name.startsWith("intel_")) {
        return `tool-mcp__ananta_intel__${safe}`;
    }
    if (name.startsWith("broker_")) {
        return `tool-mcp__ananta_broker__${safe}`;
    }
    if (
        name.startsWith("workspace_") ||
        name.startsWith("alert_") ||
        name.startsWith("compose_") ||
        name.startsWith("patch_")
    ) {
        return `tool-mcp__ananta__${safe}`;
    }
    return `tool-mcp__mcp__${safe}`;
}

function safeToolName(name: string) {
    return name.replace(/[^A-Za-z0-9_]/g, "_") || "broker_tool";
}

function buildBrokerTraceItems(events: BrokerChatEvent[]): BrokerTraceItem[] {
    const items: BrokerTraceItem[] = [];
    const toolIndexes = new Map<string, number>();
    const pendingToolKeys: string[] = [];
    let reasoningEvents: BrokerChatEvent[] = [];
    let reasoningText: string[] = [];
    let reasoningStartSequence = 0;

    function flushReasoning() {
        const text = reasoningText.join("\n\n").trim();
        if (!text) {
            reasoningEvents = [];
            reasoningText = [];
            reasoningStartSequence = 0;
            return;
        }
        items.push({
            events: reasoningEvents,
            key: `${reasoningEvents[0]?.run_id}:reasoning:${reasoningStartSequence}`,
            kind: "reasoning",
            sequence: reasoningStartSequence,
            text
        });
        reasoningEvents = [];
        reasoningText = [];
        reasoningStartSequence = 0;
    }

    for (const event of events.slice().sort((left, right) => left.sequence - right.sequence)) {
        if (event.event_type === "reasoning") {
            const message = textPayload(event.payload, "message");
            const rawType = textPayload(event.payload, "raw_type");
            if (!rawType.endsWith(".delta") && (message || rawType)) {
                if (!reasoningStartSequence) reasoningStartSequence = event.sequence;
                reasoningEvents.push(event);
                if (message) reasoningText.push(message);
            }
            continue;
        }
        if (event.event_type !== "tool_call_started" && event.event_type !== "tool_call_completed") {
            continue;
        }
        flushReasoning();
        if (event.event_type === "tool_call_started") {
            const callId = textPayload(event.payload, "tool_call_id") || null;
            const key = callId || `${event.run_id}:tool:${event.sequence}`;
            const item: BrokerTraceItem = {
                callId,
                key,
                kind: "tool",
                sequence: event.sequence,
                start: event,
                toolName: textPayload(event.payload, "tool_name") || "tool"
            };
            toolIndexes.set(key, items.length);
            pendingToolKeys.push(key);
            items.push(item);
            continue;
        }
        const callId = textPayload(event.payload, "tool_call_id") || null;
        const outputName = textPayload(event.payload, "tool_name");
        let key = callId || "";
        let existingIndex = key ? toolIndexes.get(key) : undefined;
        if (existingIndex === undefined) {
            const matchingPendingIndex = pendingToolKeys.findIndex((pendingKey) => {
                const pendingItem = items[toolIndexes.get(pendingKey) ?? -1];
                return pendingItem?.kind === "tool" && (!outputName || outputName === "unknown" || pendingItem.toolName === outputName);
            });
            if (matchingPendingIndex >= 0) {
                key = pendingToolKeys.splice(matchingPendingIndex, 1)[0] ?? key;
                existingIndex = toolIndexes.get(key);
            }
        }
        if (existingIndex !== undefined) {
            const existing = items[existingIndex];
            if (existing?.kind === "tool") {
                items[existingIndex] = {
                    ...existing,
                    output: event,
                    toolName: outputName && outputName !== "unknown" ? outputName : existing.toolName
                };
            }
        } else {
            items.push({
                callId,
                key: `${event.run_id}:tool-output:${event.sequence}`,
                kind: "tool",
                output: event,
                sequence: event.sequence,
                toolName: outputName && outputName !== "unknown" ? outputName : "tool"
            });
        }
    }
    flushReasoning();
    return items.sort((left, right) => left.sequence - right.sequence);
}

function brokerToolPart(item: Extract<BrokerTraceItem, { kind: "tool" }>, isRunActive: boolean) {
    const startPayload = item.start?.payload;
    const outputPayload = item.output?.payload;
    return {
        input: payloadValue(startPayload, "arguments") ?? {},
        output: payloadValue(outputPayload, "output"),
        state: item.output ? "output-available" : isRunActive ? "input-available" : "output-error",
        toolCallId: item.callId || item.key,
        type: brokerChatToolPartType(item.toolName),
    };
}

export function buildAdaptiveWorkspaceMessages({
    eventsByRun,
    includeReasoning = false,
    includeUnmappedTools = false,
    runs,
    streamingIds
}: {
    eventsByRun: Record<string, BrokerChatEvent[]>;
    includeReasoning?: boolean;
    includeUnmappedTools?: boolean;
    runs: BrokerChatRun[];
    streamingIds: string[];
}): UIMessage[] {
    return [...runs]
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .flatMap((run) => {
            const events = eventsByRun[run.id] ?? [];
            const running = LIVE_BROKER_CHAT_STATUSES.has(run.status);
            const traceItems = buildBrokerTraceItems(events);
            const text = assistantText(events, run);
            const assistantParts: unknown[] = events
                .filter((event) => event.event_type.startsWith("mcp_"))
                .map((event) => ({
                    input: {
                        status: textPayload(event.payload, "status") || event.event_type,
                        servers: Array.isArray(event.payload?.server_names)
                            ? event.payload.server_names.filter((item): item is string => typeof item === "string").join(", ")
                            : ""
                    },
                    output: textPayload(event.payload, "message") || textPayload(event.payload, "status") || event.event_type,
                    state: "output-available",
                    toolCallId: event.id,
                    type: `tool-mcp__status__${event.event_type}`
                }));

            for (const item of traceItems) {
                if (item.kind === "reasoning") {
                    if (!includeReasoning) continue;
                    assistantParts.push({
                        input: {},
                        output: item.text,
                        state: running ? "input-available" : "output-available",
                        toolCallId: item.key,
                        type: "tool-Thinking"
                    });
                    continue;
                }
                const mapped = isAdaptiveRenderTool(item.toolName);
                if (
                    item.toolName === "workspace_get_authoring_docs" ||
                    item.toolName === "workspace_evaluate_request" ||
                    item.toolName === "workspace_validate_spec" ||
                    item.toolName === "workspace_get_current"
                ) {
                    continue;
                }
                if (mapped || includeUnmappedTools || running || !item.output) {
                    assistantParts.push(brokerToolPart(item, running));
                }
            }

            if (text) {
                assistantParts.push({ text, type: "text" });
            } else if (!running && !assistantParts.length) {
                assistantParts.push({
                    text: run.error ? `Run failed: ${run.error}` : "No assistant response was stored for this run.",
                    type: "text"
                });
            }

            const messages: UIMessage[] = [
                {
                    createdAt: new Date(run.created_at),
                    id: `${run.id}:user`,
                    parts: [{ text: run.message, type: "text" }],
                    role: "user"
                } as UIMessage
            ];

            if (assistantParts.length || running) {
                messages.push({
                    createdAt: new Date(run.completed_at || run.updated_at || run.created_at),
                    id: `${run.id}:assistant`,
                    parts: assistantParts as UIMessage["parts"],
                    role: "assistant"
                } as UIMessage);
            }

            return messages;
        });
}
