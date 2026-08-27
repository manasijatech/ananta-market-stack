import type { BrokerChatEvent, BrokerChatRun } from "@/service/types/broker-chat";
import type { WorkspaceSpec } from "@/service/types/adaptive-workspace";

export type AguiEvent = {
    code?: string;
    content?: string;
    delta?: string;
    message?: string;
    messageId?: string;
    parentMessageId?: string;
    role?: string;
    runId?: string;
    snapshot?: { spec?: WorkspaceSpec | Record<string, unknown> };
    threadId?: string;
    toolCallId?: string;
    toolCallName?: string;
    type: string;
};

function jsonText(value: unknown) {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function brokerEventsToAgui({
    events,
    run,
    spec,
    threadId
}: {
    events: BrokerChatEvent[];
    run: BrokerChatRun;
    spec?: WorkspaceSpec | Record<string, unknown> | null;
    threadId: string;
}): AguiEvent[] {
    const mapped: AguiEvent[] = [{ type: "RUN_STARTED", threadId, runId: run.id }];
    if (spec) mapped.push({ type: "STATE_SNAPSHOT", snapshot: { spec } });

    const messageId = `${run.id}:assistant`;
    const reasoningId = `${run.id}:reasoning`;
    let textOpen = false;
    let reasoningOpen = false;
    let streamedTokens = false;
    let finished = false;

    function closeText() {
        if (!textOpen) return;
        mapped.push({ type: "TEXT_MESSAGE_END", messageId });
        textOpen = false;
    }

    function closeReasoning() {
        if (!reasoningOpen) return;
        mapped.push({ type: "REASONING_MESSAGE_END", messageId: reasoningId });
        mapped.push({ type: "REASONING_END", messageId: reasoningId });
        reasoningOpen = false;
    }

    function openText() {
        if (textOpen) return;
        closeReasoning();
        mapped.push({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
        textOpen = true;
    }

    for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
        const payload = event.payload ?? {};
        if (event.event_type === "run_started" || event.event_type === "response_started" || event.event_type === "response_completed" || event.event_type === "agent_updated") {
            continue;
        }
        if (event.event_type === "token") {
            const delta = typeof payload.text === "string" ? payload.text : "";
            if (!delta) continue;
            openText();
            mapped.push({ type: "TEXT_MESSAGE_CONTENT", messageId, delta });
            streamedTokens = true;
            continue;
        }
        if (event.event_type === "reasoning") {
            const message = typeof payload.message === "string" ? payload.message : "";
            if (!message) continue;
            if (!reasoningOpen) {
                closeText();
                mapped.push({ type: "REASONING_START", messageId: reasoningId });
                mapped.push({ type: "REASONING_MESSAGE_START", messageId: reasoningId, role: "reasoning" });
                reasoningOpen = true;
            }
            mapped.push({ type: "REASONING_MESSAGE_CONTENT", messageId: reasoningId, delta: message });
            continue;
        }
        if (event.event_type === "tool_call_started") {
            closeText();
            closeReasoning();
            const toolCallId = (typeof payload.tool_call_id === "string" && payload.tool_call_id) || `${run.id}:tool:${event.sequence}`;
            mapped.push({
                type: "TOOL_CALL_START",
                toolCallId,
                toolCallName: typeof payload.tool_name === "string" ? payload.tool_name : "tool",
                parentMessageId: messageId
            });
            if (Object.prototype.hasOwnProperty.call(payload, "arguments")) {
                mapped.push({ type: "TOOL_CALL_ARGS", toolCallId, delta: jsonText(payload.arguments) });
            }
            continue;
        }
        if (event.event_type === "tool_call_completed") {
            closeText();
            closeReasoning();
            const toolCallId = (typeof payload.tool_call_id === "string" && payload.tool_call_id) || `${run.id}:tool-end:${event.sequence}`;
            mapped.push({ type: "TOOL_CALL_END", toolCallId });
            const content = payload.output ?? payload.output_metadata;
            mapped.push({
                type: "TOOL_CALL_RESULT",
                messageId: `${run.id}:tool-result:${event.sequence}`,
                toolCallId,
                content: jsonText(content),
                role: "tool"
            });
            continue;
        }
        if (event.event_type === "message_output") {
            closeReasoning();
            const content = typeof payload.content === "string" ? payload.content : "";
            if (!streamedTokens && content) {
                openText();
                mapped.push({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: content });
            }
            continue;
        }
        if (event.event_type === "run_completed") {
            closeReasoning();
            closeText();
            if (spec) mapped.push({ type: "STATE_SNAPSHOT", snapshot: { spec } });
            mapped.push({ type: "RUN_FINISHED", threadId, runId: run.id });
            finished = true;
            continue;
        }
        if (event.event_type === "run_failed" || event.event_type === "run_cancelled") {
            closeReasoning();
            closeText();
            mapped.push({
                type: "RUN_ERROR",
                message: typeof payload.message === "string" ? payload.message : event.event_type,
                code: event.event_type
            });
            finished = true;
        }
    }

    if (!finished && spec) mapped.push({ type: "STATE_SNAPSHOT", snapshot: { spec } });
    return mapped;
}

export function summarizeAguiEvent(event: AguiEvent) {
    if (event.type === "TEXT_MESSAGE_CONTENT" || event.type === "REASONING_MESSAGE_CONTENT" || event.type === "TOOL_CALL_ARGS") {
        return (event.delta || "").slice(0, 140);
    }
    if (event.type === "TOOL_CALL_START") return event.toolCallName || "";
    if (event.type === "TOOL_CALL_RESULT") return (event.content || "").slice(0, 140);
    if (event.type === "RUN_ERROR") return event.message || "";
    if (event.type === "STATE_SNAPSHOT") return "WorkspaceSpec";
    return event.runId || event.threadId || event.messageId || event.toolCallId || "";
}
