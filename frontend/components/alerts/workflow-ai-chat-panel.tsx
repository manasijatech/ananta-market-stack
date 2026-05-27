"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    History,
    MessageCircle,
    PanelRightClose,
    Plus,
    Send,
    Settings2,
    Square
} from "lucide-react";
import { AlertLlmMarkdown } from "@/components/alerts/llm-output-markdown";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";
import { cn } from "@/lib/utils";
import {
    applyAlertWorkflowChatSnapshot,
    cancelAlertWorkflowChatRun,
    deployAlertWorkflowChatSnapshot,
    getAlertWorkflowChatEvents,
    getAlertWorkflowChatRun,
    getAlertWorkflowChatRuns,
    getAlertWorkflowChatSessions,
    getAlertWorkflowChatSnapshots,
    submitAlertWorkflowChatRun
} from "@/service/actions/alert-workflow-chat";
import type {
    AlertWorkflowChatEvent,
    AlertWorkflowChatRun,
    AlertWorkflowChatSession,
    AlertWorkflowChatSnapshot
} from "@/service/types/alert-workflow-chat";
import type { AlertWorkflow } from "@/service/types/alerts";
import type { LlmProvider, LlmProviderConfig } from "@/service/types/broker";

type ParsedSseEvent = {
    id?: string;
    event?: string;
    data?: string;
};

const MIN_PANEL_WIDTH = 380;
const DEFAULT_PANEL_WIDTH = 520;

function clampPanelWidth(value: number) {
    if (typeof window === "undefined") return value;
    const max = Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * 0.5));
    return Math.min(max, Math.max(MIN_PANEL_WIDTH, value));
}

function parseSseBlock(block: string): ParsedSseEvent | null {
    const parsed: ParsedSseEvent = {};
    for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const index = line.indexOf(":");
        const key = index >= 0 ? line.slice(0, index) : line;
        const value = index >= 0 ? line.slice(index + 1).replace(/^ /, "") : "";
        if (key === "id") parsed.id = value;
        if (key === "event") parsed.event = value;
        if (key === "data") parsed.data = parsed.data ? `${parsed.data}\n${value}` : value;
    }
    return parsed.event ? parsed : null;
}

function mergeEvents(existing: AlertWorkflowChatEvent[], incoming: AlertWorkflowChatEvent[]) {
    const map = new Map<string, AlertWorkflowChatEvent>();
    for (const event of [...existing, ...incoming]) {
        map.set(`${event.run_id}:${event.sequence}:${event.event_type}`, event);
    }
    return Array.from(map.values()).sort((left, right) => left.sequence - right.sequence);
}

function textPayload(payload: Record<string, unknown>, key: string) {
    const value = payload[key];
    return typeof value === "string" ? value : "";
}

function eventText(event: AlertWorkflowChatEvent) {
    if (event.event_type === "token") return textPayload(event.payload, "text");
    if (event.event_type === "message_output") return textPayload(event.payload, "content");
    if (event.event_type === "run_completed") return textPayload(event.payload, "response_text");
    return "";
}

type TimelineItem =
    | { id: string; kind: "text"; sequence: number; text: string }
    | {
          arguments?: unknown;
          id: string;
          kind: "tool";
          output?: Record<string, unknown>;
          sequence: number;
          status: "running" | "completed";
          toolName: string;
      }
    | {
          id: string;
          kind: "snapshot";
          label: string;
          sequence: number;
          snapshotId?: string;
          status: string;
          version?: number;
      };

function snapshotSummary(snapshot: AlertWorkflowChatSnapshot) {
    const summary = snapshot.explanation?.summary;
    if (typeof summary === "string" && summary) return summary;
    const compiled = snapshot.validation?.compiled_summary;
    if (compiled && typeof compiled === "object" && "summary" in compiled) {
        const value = (compiled as Record<string, unknown>).summary;
        if (typeof value === "string") return value;
    }
    return snapshot.valid ? "Valid workflow snapshot." : "Snapshot has validation errors.";
}

function formatShortDate(value?: string | null) {
    if (!value) return "";
    try {
        return new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            month: "short"
        }).format(new Date(value));
    } catch {
        return "";
    }
}

function sessionLabel(session: AlertWorkflowChatSession) {
    return `${session.title || "Workflow chat"}${session.updated_at ? ` · ${formatShortDate(session.updated_at)}` : ""}`;
}

function terminalStatus(status: string) {
    return status === "completed" || status === "failed" || status === "cancelled";
}

function compactJson(value: unknown) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function snapshotFromPayload(payload: Record<string, unknown>) {
    const snapshot = payload.snapshot;
    return snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>) : null;
}

function buildTimelineItems(events: AlertWorkflowChatEvent[], run: AlertWorkflowChatRun | null) {
    const sorted = events.slice().sort((left, right) => left.sequence - right.sequence);
    const hasTokens = sorted.some((event) => event.event_type === "token");
    const items: TimelineItem[] = [];
    const toolIndexes = new Map<string, number>();
    const unmatchedStarted: string[] = [];
    let textBuffer = "";
    let textStartSequence = 0;

    function flushText() {
        const text = textBuffer.trim();
        if (!text) {
            textBuffer = "";
            textStartSequence = 0;
            return;
        }
        items.push({
            id: `text-${textStartSequence}-${items.length}`,
            kind: "text",
            sequence: textStartSequence,
            text
        });
        textBuffer = "";
        textStartSequence = 0;
    }

    for (const event of sorted) {
        if (event.event_type === "token" || (!hasTokens && event.event_type === "message_output")) {
            const text = eventText(event);
            if (text) {
                if (!textStartSequence) textStartSequence = event.sequence;
                textBuffer += text;
            }
            continue;
        }
        if (!hasTokens && event.event_type === "run_completed") {
            const text = eventText(event);
            if (text && !textBuffer.includes(text)) {
                if (!textStartSequence) textStartSequence = event.sequence;
                textBuffer += text;
            }
            continue;
        }
        flushText();
        if (event.event_type === "tool_call_started") {
            const callId = String(event.payload.tool_call_id || `tool-${event.sequence}`);
            const item: TimelineItem = {
                id: callId,
                kind: "tool",
                arguments: event.payload.arguments,
                sequence: event.sequence,
                status: "running",
                toolName: String(event.payload.tool_name || "workflow_tool")
            };
            toolIndexes.set(callId, items.length);
            unmatchedStarted.push(callId);
            items.push(item);
        } else if (event.event_type === "tool_call_completed") {
            let callId = String(event.payload.tool_call_id || "");
            if (!callId || !toolIndexes.has(callId)) {
                const matchingIndex = unmatchedStarted.findIndex((id) => {
                    const item = items[toolIndexes.get(id) ?? -1];
                    return item?.kind === "tool" && item.toolName === String(event.payload.tool_name || item.toolName);
                });
                if (matchingIndex >= 0) {
                    callId = unmatchedStarted.splice(matchingIndex, 1)[0] ?? callId;
                }
            }
            const existingIndex = callId ? toolIndexes.get(callId) : undefined;
            if (existingIndex !== undefined) {
                const existing = items[existingIndex];
                if (existing?.kind === "tool") {
                    items[existingIndex] = {
                        ...existing,
                        output: event.payload.output_metadata as Record<string, unknown>,
                        status: "completed"
                    };
                }
            } else {
                items.push({
                    id: `tool-completed-${event.sequence}`,
                    kind: "tool",
                    output: event.payload.output_metadata as Record<string, unknown>,
                    sequence: event.sequence,
                    status: "completed",
                    toolName: String(event.payload.tool_name || "workflow_tool")
                });
            }
        } else if (event.event_type === "snapshot_created" || event.event_type === "snapshot_applied") {
            const snapshot = snapshotFromPayload(event.payload);
            items.push({
                id: `${event.event_type}-${event.sequence}`,
                kind: "snapshot",
                label: String(snapshot?.label || (event.event_type === "snapshot_applied" ? "Snapshot applied" : "Snapshot saved")),
                sequence: event.sequence,
                snapshotId: typeof snapshot?.id === "string" ? snapshot.id : undefined,
                status: event.event_type === "snapshot_applied" ? "applied" : "saved",
                version: typeof snapshot?.version === "number" ? snapshot.version : undefined
            });
        }
    }
    flushText();

    if (!items.length && run?.response_text) {
        items.push({ id: `text-${run.id}`, kind: "text", sequence: 0, text: run.response_text });
    }
    return items;
}

function TimelineTool({ collapsed, item }: { collapsed: boolean; item: Extract<TimelineItem, { kind: "tool" }> }) {
    return (
        <details className="group border border-border bg-secondary/20 px-2.5 py-2 text-xs" open={!collapsed}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                <span className="truncate">{item.toolName}</span>
                <span>{item.status}</span>
            </summary>
            {item.arguments ? (
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap border border-border bg-background/70 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
                    {compactJson(item.arguments)}
                </pre>
            ) : null}
            {item.output ? (
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap border border-border bg-background/70 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
                    {compactJson(item.output)}
                </pre>
            ) : null}
        </details>
    );
}

function TimelineSnapshot({ item }: { item: Extract<TimelineItem, { kind: "snapshot" }> }) {
    return (
        <div className="flex items-center justify-between gap-2 border border-border bg-secondary/20 px-2.5 py-2 text-xs text-muted-foreground">
            <span className="truncate">
                Snapshot {item.version ? `v${item.version}` : ""} {item.status}: {item.label}
            </span>
            {item.snapshotId ? <span className="font-mono text-[10px]">{item.snapshotId.slice(0, 8)}</span> : null}
        </div>
    );
}

function SnapshotDock({
    applySnapshot,
    snapshots
}: {
    applySnapshot: (snapshotId: string, deploy?: boolean) => Promise<void>;
    snapshots: AlertWorkflowChatSnapshot[];
}) {
    const ordered = snapshots.slice().sort((left, right) => right.version - left.version);
    const latest = ordered[0];
    if (!latest) return null;
    const history = ordered.slice(1);
    return (
        <div className="mt-5 border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="type-step-eyebrow">Snapshot</div>
                {history.length ? (
                    <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer list-none hover:text-foreground">
                            {history.length} older
                        </summary>
                        <div className="absolute right-4 z-10 mt-2 grid max-h-72 w-[min(420px,calc(100%-2rem))] gap-1 overflow-auto border border-border bg-background p-2 shadow-xl">
                            {history.map((snapshot) => (
                                <button
                                    className="grid gap-0.5 border border-border px-2 py-1.5 text-left hover:bg-secondary/40"
                                    key={snapshot.id}
                                    onClick={() => void applySnapshot(snapshot.id)}
                                    type="button"
                                >
                                    <span className="truncate text-xs font-medium">{snapshot.label}</span>
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                        v{snapshot.version} · {snapshot.valid ? "valid" : "invalid"} · {formatShortDate(snapshot.created_at)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </details>
                ) : null}
            </div>
            <div className="grid gap-2 border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{latest.label}</div>
                        <div className="text-xs text-muted-foreground">
                            v{latest.version} · {latest.valid ? "valid" : "invalid"} · {formatShortDate(latest.created_at)}
                        </div>
                    </div>
                    <span className={cn("text-xs", latest.valid ? "text-primary" : "text-[var(--danger)]")}>
                        {latest.valid ? "ready" : "blocked"}
                    </span>
                </div>
                <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {snapshotSummary(latest)}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={!latest.valid}
                        onClick={() => void applySnapshot(latest.id)}
                        size="sm"
                        type="button"
                        variant="secondary"
                    >
                        Apply
                    </Button>
                    <Button
                        disabled={!latest.valid}
                        onClick={() => void applySnapshot(latest.id, true)}
                        size="sm"
                        type="button"
                    >
                        Deploy
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function WorkflowAiChatPanel({
    currentWorkflowId,
    disabled,
    getEditorPayload,
    llmProviders,
    onWorkflowApplied
}: {
    currentWorkflowId?: string | null;
    disabled?: boolean;
    getEditorPayload: () => Record<string, unknown>;
    llmProviders: LlmProviderConfig[];
    onWorkflowApplied: (workflow: AlertWorkflow) => void;
}) {
    const { user } = useSession();
    const enabledProviders = useMemo(
        () => llmProviders.filter((provider) => provider.has_api_key && provider.is_enabled),
        [llmProviders]
    );
    const firstProvider = enabledProviders[0];
    const firstModel = firstProvider?.models.find((model) => model.is_enabled);
    const [open, setOpen] = useState(false);
    const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
    const [session, setSession] = useState<AlertWorkflowChatSession | null>(null);
    const [sessions, setSessions] = useState<AlertWorkflowChatSession[]>([]);
    const [provider, setProvider] = useState<LlmProvider | "">(firstProvider?.provider ?? "");
    const selectedProvider = enabledProviders.find((item) => item.provider === provider);
    const [model, setModel] = useState(firstModel?.model_id ?? "");
    const selectedModels = selectedProvider?.models.filter((item) => item.is_enabled) ?? [];
    const [message, setMessage] = useState("");
    const [runs, setRuns] = useState<AlertWorkflowChatRun[]>([]);
    const [eventsByRun, setEventsByRun] = useState<Record<string, AlertWorkflowChatEvent[]>>({});
    const [snapshots, setSnapshots] = useState<AlertWorkflowChatSnapshot[]>([]);
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [isSending, setIsSending] = useState(false);
    const streamControllersRef = useRef<Record<string, AbortController>>({});
    const bodyRef = useRef<HTMLDivElement | null>(null);

    const workflowSessions = useMemo(() => {
        if (!currentWorkflowId) return sessions;
        return sessions.filter((item) => item.workflow_id === currentWorkflowId);
    }, [currentWorkflowId, sessions]);

    const activeRun = runs.find((item) => item.id === activeRunId) ?? runs[0] ?? null;
    const busy = Boolean(activeRun && ["queued", "running"].includes(activeRun.status));
    const orderedRuns = useMemo(
        () => runs.slice().sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()),
        [runs]
    );

    useEffect(() => {
        if (provider && selectedModels.some((item) => item.model_id === model)) return;
        setModel(selectedModels[0]?.model_id ?? "");
    }, [model, provider, selectedModels]);

    useEffect(() => {
        if (!bodyRef.current) return;
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [eventsByRun, orderedRuns.length, snapshots.length, open]);

    useEffect(() => {
        if (!open) return;
        void refreshSessions();
    }, [open, currentWorkflowId]);

    useEffect(() => {
        return () => {
            for (const controller of Object.values(streamControllersRef.current)) {
                controller.abort();
            }
        };
    }, []);

    async function refreshSessions() {
        const next = await getAlertWorkflowChatSessions({ limit: 100 }).catch(() => null);
        if (!next) return;
        setSessions(next);
    }

    async function refreshSnapshots(nextSessionId = session?.id) {
        if (!nextSessionId) return;
        const next = await getAlertWorkflowChatSnapshots(nextSessionId).catch(() => null);
        if (next) setSnapshots(next);
    }

    async function hydrateRunEvents(runId: string) {
        const page = await getAlertWorkflowChatEvents(runId).catch(() => null);
        if (page) {
            setEventsByRun((current) => ({ ...current, [runId]: mergeEvents(current[runId] ?? [], page.events) }));
        }
    }

    async function loadSession(sessionId: string) {
        if (!sessionId) {
            return;
        }
        setError("");
        const selected = sessions.find((item) => item.id === sessionId) ?? null;
        if (selected) {
            setSession(selected);
            if (selected.workflow) onWorkflowApplied(selected.workflow);
        }
        const [nextRuns, nextSnapshots] = await Promise.all([
            getAlertWorkflowChatRuns({ sessionId, limit: 50 }).catch(() => []),
            getAlertWorkflowChatSnapshots(sessionId).catch(() => [])
        ]);
        setRuns(nextRuns);
        setSnapshots(nextSnapshots);
        setEventsByRun({});
        setActiveRunId(nextRuns[0]?.id ?? null);
        await Promise.all(nextRuns.slice(0, 20).map((run) => hydrateRunEvents(run.id)));
        for (const run of nextRuns) {
            if (!terminalStatus(run.status)) void streamRun(run.id);
        }
    }

    function startNewChat() {
        setSession(null);
        setRuns([]);
        setEventsByRun({});
        setSnapshots([]);
        setActiveRunId(null);
        setError("");
        setMessage("");
    }

    function startResize(event: React.PointerEvent<HTMLDivElement>) {
        event.preventDefault();
        const pointerId = event.pointerId;
        event.currentTarget.setPointerCapture(pointerId);
        function move(moveEvent: PointerEvent) {
            setWidth(clampPanelWidth(window.innerWidth - moveEvent.clientX));
        }
        function up() {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        }
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
    }

    const streamRun = useCallback(
        async (runId: string, afterSequence = 0) => {
            if (!user?.id) return;
            const existing = streamControllersRef.current[runId];
            if (existing && !existing.signal.aborted) return;
            const controller = new AbortController();
            streamControllersRef.current[runId] = controller;
            let latestSequence = afterSequence;
            let reconnectAfterClose = false;
            const params = new URLSearchParams({ after_sequence: String(afterSequence) });
            const url = `${getPublicApiBaseUrl()}/alert-workflow-chat/runs/${runId}/stream?${params.toString()}`;
            try {
                const response = await fetch(url, {
                    cache: "no-store",
                    headers: { Accept: "text/event-stream", "X-User-Id": user.id },
                    signal: controller.signal
                });
                if (!response.ok || !response.body) throw new Error("Could not open workflow chat stream.");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let boundary = buffer.indexOf("\n\n");
                    while (boundary >= 0) {
                        const block = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const parsed = parseSseBlock(block);
                        if (parsed?.event && parsed.event !== "ping" && parsed.event !== "error") {
                            const sequence = Number(parsed.id ?? 0);
                            latestSequence = Number.isFinite(sequence)
                                ? Math.max(latestSequence, sequence)
                                : latestSequence;
                            const payload = parsed.data ? (JSON.parse(parsed.data) as Record<string, unknown>) : {};
                            const event: AlertWorkflowChatEvent = {
                                id: `${runId}:${sequence}:${parsed.event}`,
                                run_id: runId,
                                sequence,
                                event_type: parsed.event,
                                payload,
                                created_at: new Date().toISOString()
                            };
                            setEventsByRun((current) => ({
                                ...current,
                                [runId]: mergeEvents(current[runId] ?? [], [event])
                            }));
                            if (parsed.event === "snapshot_created") void refreshSnapshots();
                            if (parsed.event === "snapshot_applied") {
                                void refreshSnapshots();
                                const workflow = payload.workflow;
                                if (workflow && typeof workflow === "object") {
                                    onWorkflowApplied(workflow as AlertWorkflow);
                                }
                            }
                            if (
                                parsed.event === "run_completed" ||
                                parsed.event === "run_failed" ||
                                parsed.event === "run_cancelled"
                            ) {
                                setRuns((current) =>
                                    current.map((run) =>
                                        run.id === runId
                                            ? {
                                                  ...run,
                                                  status:
                                                      parsed.event === "run_completed"
                                                          ? "completed"
                                                          : parsed.event === "run_cancelled"
                                                            ? "cancelled"
                                                            : "failed",
                                                  response_text: textPayload(payload, "response_text") || run.response_text,
                                                  error: textPayload(payload, "message") || run.error,
                                                  updated_at: new Date().toISOString()
                                              }
                                            : run
                                    )
                                );
                            }
                        }
                        boundary = buffer.indexOf("\n\n");
                    }
                }
                const freshRun = await getAlertWorkflowChatRun(runId).catch(() => null);
                if (freshRun) {
                    setRuns((current) => [freshRun, ...current.filter((item) => item.id !== freshRun.id)]);
                    reconnectAfterClose = ["queued", "running"].includes(freshRun.status) && !controller.signal.aborted;
                }
                await refreshSnapshots();
                await refreshSessions();
            } catch (caught) {
                if ((caught as Error).name !== "AbortError") {
                    setError((caught as Error).message || "Workflow chat stream stopped.");
                }
            } finally {
                if (streamControllersRef.current[runId] === controller) {
                    delete streamControllersRef.current[runId];
                }
                if (reconnectAfterClose && !controller.signal.aborted) {
                    window.setTimeout(() => void streamRun(runId, latestSequence), 1000);
                }
            }
        },
        [onWorkflowApplied, user?.id]
    );

    async function sendMessage() {
        if (!message.trim() || isSending || disabled) return;
        setError("");
        setIsSending(true);
        const outgoing = message.trim();
        setMessage("");
        try {
            const editorPayload = getEditorPayload();
            const result = await submitAlertWorkflowChatRun({
                message: outgoing,
                session_id: session?.id ?? null,
                session_title: "Workflow AI chat",
                workflow_id: session?.workflow_id ?? currentWorkflowId ?? null,
                draft_workflow: currentWorkflowId || session?.workflow_id ? null : editorPayload,
                editor_payload: editorPayload,
                provider: provider || null,
                model: model || null
            });
            setOpen(true);
            setSession(result.session);
            if (result.session.workflow) onWorkflowApplied(result.session.workflow);
            setSessions((current) => [result.session, ...current.filter((item) => item.id !== result.session.id)]);
            setRuns((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)]);
            setActiveRunId(result.run.id);
            await hydrateRunEvents(result.run.id);
            void streamRun(result.run.id);
            await refreshSnapshots(result.session.id);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Workflow chat failed to start.");
            setMessage(outgoing);
        } finally {
            setIsSending(false);
        }
    }

    async function applySnapshot(snapshotId: string, deploy = false) {
        setError("");
        try {
            const result = deploy
                ? await deployAlertWorkflowChatSnapshot(snapshotId)
                : await applyAlertWorkflowChatSnapshot(snapshotId);
            onWorkflowApplied(result.workflow);
            await refreshSnapshots(result.snapshot.session_id);
            await refreshSessions();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not apply snapshot.");
        }
    }

    async function cancelActiveRun() {
        if (!activeRunId) return;
        const run = await cancelAlertWorkflowChatRun(activeRunId).catch(() => null);
        if (run) setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    }

    if (disabled) return null;

    if (!open) {
        return (
            <button
                className="fixed right-0 top-28 z-40 flex h-14 w-11 items-center justify-center border border-r-0 border-border bg-background shadow-xl hover:bg-secondary"
                onClick={() => setOpen(true)}
                title="Open Workflow AI Chat"
                type="button"
            >
                <MessageCircle className="size-4" />
            </button>
        );
    }

    return (
        <aside
            className="fixed bottom-0 right-0 top-[76px] z-50 grid grid-rows-[auto_minmax(0,1fr)_auto] border-l border-border bg-background shadow-2xl"
            style={{ width: clampPanelWidth(width) }}
        >
            <div
                aria-label="Resize Workflow AI Chat"
                className="absolute bottom-0 left-0 top-0 w-1.5 cursor-col-resize bg-transparent hover:bg-primary/50"
                onPointerDown={startResize}
                role="separator"
            />
            <div className="border-b border-border px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="type-step-eyebrow">Workflow AI Chat</div>
                        <div className="mt-1 text-sm leading-5 text-muted-foreground">
                            Create, edit, validate, snapshot, and deploy market-data workflows.
                        </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                        <Button className="h-8 gap-1 px-2" onClick={startNewChat} size="sm" title="Start new chat" type="button" variant="ghost">
                            <Plus className="size-4" />
                            New
                        </Button>
                        <Button className="h-8 px-2" onClick={() => setOpen(false)} size="sm" title="Collapse chat" type="button" variant="ghost">
                            <PanelRightClose className="size-4" />
                        </Button>
                    </div>
                </div>
                <div className="mt-3 flex min-w-0 items-center gap-2">
                    <History className="size-4 shrink-0 text-muted-foreground" />
                    <Select
                        className="h-8 min-w-0 flex-1 rounded-full border border-input bg-background px-3 text-xs"
                        onChange={(event) => void loadSession(event.target.value)}
                        value={session?.id ?? ""}
                    >
                        <option value="">Chat history</option>
                        {workflowSessions.map((item) => (
                            <option key={item.id} value={item.id}>
                                {sessionLabel(item)}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>

            <div className="min-h-0 overflow-y-auto px-4 py-4" ref={bodyRef}>
                {error ? (
                    <div className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]">
                        {error}
                    </div>
                ) : null}
                <div className="grid gap-5">
                    {orderedRuns.length ? (
                        orderedRuns.map((run) => {
                            const events = eventsByRun[run.id] ?? [];
                            const isRunning = ["queued", "running"].includes(run.status);
                            const timelineItems = buildTimelineItems(events, run);
                            const collapseTrace = !isRunning && timelineItems.some((item) => item.kind === "text");
                            return (
                                <div className="grid gap-3" key={run.id}>
                                    <div className="flex justify-end">
                                        <div className="max-w-[86%] border border-border bg-secondary/50 px-3 py-2 text-sm leading-6 text-foreground">
                                            {run.message}
                                        </div>
                                    </div>
                                    <div className="grid gap-2 border border-border bg-background px-3 py-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                                {run.status}
                                            </div>
                                            <div className="font-mono text-[10px] text-muted-foreground">
                                                {formatShortDate(run.created_at)}
                                            </div>
                                        </div>
                                        {timelineItems.length ? (
                                            <div className="grid gap-2">
                                                {timelineItems.map((item) => {
                                                    if (item.kind === "text") {
                                                        return (
                                                            <AlertLlmMarkdown className="text-sm text-foreground" key={item.id}>
                                                                {item.text}
                                                            </AlertLlmMarkdown>
                                                        );
                                                    }
                                                    if (item.kind === "tool") {
                                                        return <TimelineTool collapsed={collapseTrace} item={item} key={item.id} />;
                                                    }
                                                    return <TimelineSnapshot item={item} key={item.id} />;
                                                })}
                                            </div>
                                        ) : isRunning ? (
                                            <div className="text-sm text-muted-foreground">
                                                Working through workflow tools...
                                            </div>
                                        ) : (
                                            <div className="text-sm text-muted-foreground">
                                                No assistant response was stored for this turn.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="grid gap-3 border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                            <div className="font-semibold text-foreground">Start with a request.</div>
                            <div>
                                Example: “Create a rolling price-volume breakout for my test watchlist and use Discord.”
                            </div>
                            {workflowSessions.length ? (
                                <div>Select a chat from History above to reopen earlier runs and snapshots.</div>
                            ) : null}
                        </div>
                    )}
                </div>

                {snapshots.length ? (
                    <SnapshotDock applySnapshot={applySnapshot} snapshots={snapshots} />
                ) : null}
            </div>

            <div className="border-t border-border bg-background px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-[11px] text-muted-foreground">
                        <Settings2 className="size-3" />
                        Model
                    </span>
                    <Select
                        className="h-8 max-w-[160px] rounded-full border border-input bg-background px-3 text-xs"
                        onChange={(event) => setProvider(event.target.value as LlmProvider)}
                        value={provider}
                    >
                        <option value="">Provider</option>
                        {enabledProviders.map((item) => (
                            <option key={item.provider} value={item.provider}>
                                {item.label}
                            </option>
                        ))}
                    </Select>
                    <Select
                        className="h-8 min-w-[180px] flex-1 rounded-full border border-input bg-background px-3 text-xs"
                        onChange={(event) => setModel(event.target.value)}
                        value={model}
                    >
                        <option value="">Model</option>
                        {selectedModels.map((item) => (
                            <option key={item.id} value={item.model_id}>
                                {item.label || item.model_id}
                            </option>
                        ))}
                    </Select>
                </div>
                <Textarea
                    className="min-h-[82px] resize-none border border-input bg-background px-3 py-2 text-sm outline-none"
                    disabled={isSending || busy}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void sendMessage();
                        }
                    }}
                    placeholder="Ask the agent to explain, create, or modify this workflow..."
                    value={message}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">Enter sends. Shift+Enter adds a new line.</div>
                    <div className="flex gap-2">
                        {busy ? (
                            <Button onClick={cancelActiveRun} type="button" variant="secondary">
                                <Square className="size-4" />
                                Stop
                            </Button>
                        ) : null}
                        <Button
                            disabled={!message.trim() || isSending || busy || !provider || !model}
                            onClick={sendMessage}
                            type="button"
                        >
                            <Send className="size-4" />
                            Send
                        </Button>
                    </div>
                </div>
                {!enabledProviders.length ? (
                    <div className="mt-2 text-xs text-[var(--danger)]">
                        Configure an enabled LLM provider and model in System Config first.
                    </div>
                ) : null}
            </div>
        </aside>
    );
}
