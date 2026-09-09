import type { UIMessage } from "ai";
import { displayNameForTool } from "@/lib/agent/tool-labels";
import type { BrokerChatEvent, BrokerChatRun } from "@/service/types/broker-chat";

export const LIVE_BROKER_CHAT_STATUSES = new Set(["queued", "running"]);

/** Runs that should open an SSE stream (not waiting behind another turn). */
export function shouldStreamBrokerChatRun(run: { status: string; job_id?: string | null }): boolean {
    if (run.status === "running") return true;
    return run.status === "queued" && Boolean(run.job_id);
}

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

export function mergeBrokerChatSessions<T extends { id: string; updated_at: string }>(
    existing: T[],
    incoming: T[],
    options?: { dropIds?: ReadonlySet<string> }
) {
    const dropped = options?.dropIds;
    const byId = new Map<string, T>();
    for (const item of existing) {
        if (dropped?.has(item.id)) continue;
        byId.set(item.id, item);
    }
    for (const item of incoming) {
        if (dropped?.has(item.id)) continue;
        byId.set(item.id, { ...byId.get(item.id), ...item });
    }
    return sortBrokerChatSessions([...byId.values()]);
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

function coerceToolArguments(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value === "string" && value.trim()) {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            /* keep raw */
        }
        return { raw: value };
    }
    return {};
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

const CONTINUE_REASON_LABELS: Record<string, string> = {
    provider_retry: "Retrying the model",
    provider_param_fix: "Adjusting model settings",
    unknown_tool: "Correcting a tool call",
    incomplete_answer: "Continuing the answer",
    max_turns: "Still working through tools",
    evidence_gap: "Filling a gap in the evidence"
};

export function harnessRetryParts(events: BrokerChatEvent[], running: boolean) {
    return events
        .filter((event) => event.event_type === "run_continued")
        .map((event) => {
            const reason = textPayload(event.payload, "reason") || "continue";
            return {
                input: { reason },
                output: running ? "" : "Finished this step",
                state: running ? "input-available" : "output-available",
                toolCallId: event.id,
                type: "tool-harness__retry",
                displayName: CONTINUE_REASON_LABELS[reason] || textPayload(event.payload, "display_name") || "Still working"
            };
        });
}

export function describeAgentActivity(
    events: BrokerChatEvent[],
    run: BrokerChatRun | null
): { title: string; detail?: string } | null {
    if (!run || !LIVE_BROKER_CHAT_STATUSES.has(run.status)) return null;
    if (run.status === "queued") {
        if (run.job_id) {
            return { title: "Waiting for a worker", detail: "Your turn is in the queue." };
        }
        return {
            title: "Queued",
            detail: "Waiting for the previous turn in this chat to finish."
        };
    }
    const sorted = [...events].sort((left, right) => left.sequence - right.sequence);
    const pending: Array<{ callId: string; name: string; display: string }> = [];
    let lastReasoning = "";
    let lastContinue = "";
    let wroteTokens = false;
    for (const event of sorted) {
        if (event.event_type === "reasoning") {
            lastReasoning = textPayload(event.payload, "message");
            continue;
        }
        if (event.event_type === "run_continued") {
            const reason = textPayload(event.payload, "reason");
            lastContinue = CONTINUE_REASON_LABELS[reason] || "Still working";
            continue;
        }
        if (event.event_type === "token" || event.event_type === "message_output") {
            wroteTokens = true;
            continue;
        }
        if (event.event_type === "tool_call_started") {
            const name = textPayload(event.payload, "tool_name") || "tool";
            pending.push({
                callId: textPayload(event.payload, "tool_call_id") || event.id,
                name,
                display: displayNameForTool(name, textPayload(event.payload, "display_name"))
            });
            continue;
        }
        if (event.event_type === "tool_call_completed") {
            const callId = textPayload(event.payload, "tool_call_id");
            const name = textPayload(event.payload, "tool_name");
            const index = callId
                ? pending.findIndex((item) => item.callId === callId)
                : pending.findIndex((item) => !name || name === "unknown" || item.name === name);
            if (index >= 0) pending.splice(index, 1);
            else if (pending.length) pending.pop();
        }
    }
    const current = pending.at(-1);
    if (current) {
        return {
            title: current.display,
            detail: "In progress — market data, search, and calculations can take a minute."
        };
    }
    if (lastContinue) {
        return { title: lastContinue, detail: "The run has not finished the answer yet." };
    }
    if (lastReasoning) {
        return { title: "Thinking", detail: lastReasoning.slice(0, 180) };
    }
    if (wroteTokens) {
        return { title: "Writing the answer" };
    }
    return { title: "Working on your question", detail: "Gathering sources and updating the desk." };
}

function lastEventOfType(events: BrokerChatEvent[], eventType: string) {
    return [...events].reverse().find((event) => event.event_type === eventType);
}

export function evidenceTodoParts(events: BrokerChatEvent[]) {
    const event = lastEventOfType(events, "evidence_todos");
    if (!event) return [];
    const todos = event.payload?.todos;
    if (!Array.isArray(todos) || todos.length === 0) return [];
    return [
        {
            input: { todos },
            output: { todos },
            state: "output-available",
            toolCallId: event.id,
            type: "tool-TodoWrite",
            displayName: textPayload(event.payload, "title") || "Research steps"
        }
    ];
}

export function evidenceIncompleteParts(events: BrokerChatEvent[]) {
    const event = lastEventOfType(events, "evidence_incomplete");
    if (!event) return [];
    const message = textPayload(event.payload, "message");
    if (!message) return [];
    return [{ text: message, type: "text" as const }];
}

export function brokerChatToolPartType(toolName: string) {
    const name = toolName || "tool";
    const safe = name.replace(/[^A-Za-z0-9_]/g, "_") || "tool";
    if (name.startsWith("sandbox_")) {
        return `tool-mcp__ananta_compute__${safe}`;
    }
    if (name.startsWith("web_")) {
        return `tool-mcp__ananta_web__${safe}`;
    }
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
            if (message) {
                if (!reasoningStartSequence) reasoningStartSequence = event.sequence;
                reasoningEvents.push(event);
                reasoningText.push(message);
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
    const label = displayNameForTool(
        item.toolName,
        textPayload(startPayload || {}, "display_name") || textPayload(outputPayload || {}, "display_name")
    );
    return {
        input: coerceToolArguments(
            payloadValue(startPayload, "arguments") ?? payloadValue(outputPayload, "arguments")
        ),
        output: payloadValue(outputPayload, "output"),
        state: item.output ? "output-available" : isRunActive ? "input-available" : "output-error",
        toolCallId: item.callId || item.key,
        type: brokerChatToolPartType(item.toolName),
        displayName: label
    };
}

export function buildAdaptiveWorkspaceMessages({
    eventsByRun,
    includeReasoning = true,
    includeUnmappedTools = true,
    runs,
    streamingIds: _streamingIds
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
            const waitingInSessionQueue = run.status === "queued" && !run.job_id;
            const running = LIVE_BROKER_CHAT_STATUSES.has(run.status) && !waitingInSessionQueue;
            const traceItems = buildBrokerTraceItems(events);
            const text = assistantText(events, run);
            const assistantParts: unknown[] = [
                ...harnessRetryParts(events, running),
                ...evidenceTodoParts(events),
                ...events
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
                })),
            ];

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
                const noisyHelper = item.toolName === "workspace_get_authoring_docs";
                if (noisyHelper) {
                    continue;
                }
                if (includeUnmappedTools || running || !item.output) {
                    assistantParts.push(brokerToolPart(item, running));
                }
            }

            if (text) {
                assistantParts.push({ text, type: "text" });
            } else if (!running && !waitingInSessionQueue && !assistantParts.length) {
                assistantParts.push({
                    text: run.error ? `Run failed: ${run.error}` : "No assistant response was stored for this run.",
                    type: "text"
                });
            }
            assistantParts.push(...evidenceIncompleteParts(events));

            const messages: UIMessage[] = [
                {
                    createdAt: new Date(run.created_at),
                    id: `${run.id}:user`,
                    metadata: {
                        brokerChatRunId: run.id,
                        queued: waitingInSessionQueue,
                        queuePosition: run.queue_position ?? null
                    },
                    parts: [{ text: run.message, type: "text" }],
                    role: "user"
                } as UIMessage
            ];

            if (waitingInSessionQueue) {
                messages.push({
                    createdAt: new Date(run.created_at),
                    id: `${run.id}:queued`,
                    metadata: { brokerChatRunId: run.id, queued: true },
                    parts: [
                        {
                            text:
                                run.queue_position && run.queue_position > 1
                                    ? `Queued (#${run.queue_position}) — waiting for earlier turns.`
                                    : "Queued — waiting for the current turn to finish.",
                            type: "text"
                        }
                    ],
                    role: "assistant"
                } as UIMessage);
                return messages;
            }

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
