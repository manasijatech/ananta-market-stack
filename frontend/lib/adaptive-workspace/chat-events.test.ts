import { describe, expect, it } from "vitest";
import { describeAgentActivity, buildAdaptiveWorkspaceMessages, type BrokerToolPart } from "./chat-events";
import type { BrokerChatEvent, BrokerChatRun } from "@/service/types/broker-chat";

function event(sequence: number, eventType: string, payload: Record<string, unknown>): BrokerChatEvent {
    return {
        id: `event-${sequence}`,
        run_id: "run-1",
        sequence,
        event_type: eventType,
        payload,
        created_at: "2026-11-05T10:00:00Z"
    };
}

const run: BrokerChatRun = {
    id: "run-1",
    session_id: "session-1",
    user_id: "user-1",
    status: "completed",
    provider: "openrouter",
    model_id: "test-model",
    message: "Compare the sources",
    response_text: "",
    event_visibility: "tool_calls",
    include_tool_outputs: true,
    include_reasoning: false,
    metadata_json: "{}",
    queued_at: "2026-11-05T10:00:00Z",
    completed_at: "2026-11-05T10:00:02Z",
    created_at: "2026-11-05T10:00:00Z",
    updated_at: "2026-11-05T10:00:02Z"
};

describe("code mode nested activity", () => {
    const parent = (sequence: number) => event(sequence, "tool_call_started", { tool_name: "code_run", tool_call_id: "code" });
    const child = (sequence: number, id: string, completed = false, extra: Record<string, unknown> = {}) =>
        event(sequence, completed ? "tool_call_completed" : "tool_call_started", {
            tool_name: "broker_get_quotes",
            tool_call_id: id,
            parent_tool: "code_run",
            parent_tool_call_id: "code",
            ...extra
        });
    const parts = (events: BrokerChatEvent[]) =>
        buildAdaptiveWorkspaceMessages({
            runs: [run],
            eventsByRun: { [run.id]: events },
            streamingIds: []
        })
            .filter((message) => message.role === "assistant")
            .flatMap((message) => message.parts) as unknown as BrokerToolPart[];

    it("groups parallel calls by parent and matches reversed completions by ID", () => {
        const tools = parts([
            parent(1),
            child(2, "a"),
            child(3, "b"),
            child(4, "b", true, { output: { value: "B" }, cached: true }),
            child(5, "a", true, { output: { value: "A" } })
        ]);
        const code = tools.find((part) => part.toolCallId === "code")!;
        expect(code.displayName).toBe("Run code");
        expect(code.children).toHaveLength(2);
        expect(code.children?.[0]).toMatchObject({ toolCallId: "a", output: { value: "A" }, parent_tool_call_id: "code" });
        expect(code.children?.[1]).toMatchObject({ toolCallId: "b", output: { value: "B" }, cached: true });
        expect(tools.some((part) => part.toolCallId === "a")).toBe(false);
    });

    it("buffers early children on reprojection and leaves missing parents flat", () => {
        const early = [child(1, "a"), child(2, "a", true, { cached: true })];
        expect(parts(early).find((part) => part.toolCallId === "a")?.cached).toBe(true);
        const grouped = parts([...early, parent(3)]);
        expect(grouped.find((part) => part.toolCallId === "code")?.children?.[0].toolCallId).toBe("a");
        expect(grouped.some((part) => part.toolCallId === "a")).toBe(false);
    });

    it("handles completion before start without stealing another same-name call", () => {
        const code = parts([parent(1), child(2, "a"), child(3, "b", true, { cached: true }), child(4, "b")]).find(
            (part) => part.toolCallId === "code"
        )!;
        expect(code.children?.find((part) => part.toolCallId === "a")?.output).toBeUndefined();
        expect(code.children?.find((part) => part.toolCallId === "b")).toMatchObject({
            cached: true,
            state: "output-available"
        });
    });
});

it("keeps the code parent live while parallel children finish", () => {
    const events = [
        event(1, "tool_call_started", { tool_name: "code_run", tool_call_id: "code" }),
        event(2, "tool_call_started", { tool_name: "broker_get_quotes", tool_call_id: "a", parent_tool_call_id: "code" }),
        event(3, "tool_call_started", { tool_name: "web_search", tool_call_id: "b", parent_tool_call_id: "code" }),
        event(4, "tool_call_completed", { tool_name: "web_search", tool_call_id: "b" })
    ];
    expect(describeAgentActivity(events, { ...run, status: "running" })).toEqual({
        title: "Running code",
        detail: "Live quotes"
    });
});
