"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    IconAlertTriangle,
    IconArrowRight,
    IconCircleCheck,
    IconPlayerStop,
    IconLoader2,
    IconMessagePlus,
    IconRefresh,
    IconTerminal2,
    IconTool,
    IconTrash,
    IconUser
} from "@tabler/icons-react";
import { formatDate, StatusBadge } from "@/components/brokers/ui";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";
import { cn } from "@/lib/utils";
import {
    cancelBrokerChatRun,
    createBrokerChatSession,
    deleteBrokerChatSession,
    getBrokerChatEvents,
    getBrokerChatQueueHealth,
    getBrokerChatRun,
    getBrokerChatRuns,
    getBrokerChatSessions,
    submitBrokerChatRun,
    updateBrokerChatConfig
} from "@/service/actions/broker-chat";
import type { LlmProvider, LlmProviderConfig, McpServerConfig } from "@/service/types/broker";
import type {
    BrokerChatEvent,
    BrokerChatPreference,
    BrokerChatQueueHealth,
    BrokerChatRun,
    BrokerChatSession,
    BrokerChatVisibility
} from "@/service/types/broker-chat";

type Props = {
    initialConfig: BrokerChatPreference;
    initialSessions: BrokerChatSession[];
    initialRuns: BrokerChatRun[];
    llmProviders: LlmProviderConfig[];
    mcpServer: McpServerConfig;
};

type ParsedSseEvent = {
    id?: string;
    event?: string;
    data?: string;
};

type ToolStep = {
    key: string;
    toolName: string;
    callId?: string | null;
    start?: BrokerChatEvent;
    output?: BrokerChatEvent;
};

type BrokerChatConfigPayload = {
    default_provider: LlmProvider;
    default_model: string;
    event_visibility: BrokerChatVisibility;
    include_tool_outputs: boolean;
    include_reasoning: boolean;
    use_mcp: boolean;
};
type BrokerChatConfigKeyPayload = Omit<BrokerChatConfigPayload, "default_provider"> & {
    default_provider: LlmProvider | "";
};

const liveStatuses = new Set(["queued", "running"]);

function brokerChatConfigKey(config: BrokerChatConfigKeyPayload) {
    return JSON.stringify(config);
}

function sortSessions(sessions: BrokerChatSession[]) {
    return [...sessions].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function sortRuns(runs: BrokerChatRun[]) {
    return [...runs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

function mergeRuns(existing: BrokerChatRun[], incoming: BrokerChatRun[]) {
    const byId = new Map(existing.map((item) => [item.id, item]));
    incoming.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
    return Array.from(byId.values()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function mergeEvents(existing: BrokerChatEvent[], incoming: BrokerChatEvent[]) {
    const bySequence = new Map(existing.map((item) => [item.sequence, item]));
    incoming.forEach((item) => bySequence.set(item.sequence, { ...bySequence.get(item.sequence), ...item }));
    return Array.from(bySequence.values()).sort((a, b) => a.sequence - b.sequence);
}

function statusClass(status: string) {
    if (status === "completed") {
        return "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]";
    }
    if (status === "failed" || status === "cancelled") {
        return "border-destructive/50 bg-destructive/10 text-destructive";
    }
    if (status === "running" || status === "queued") {
        return "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]";
    }
    return "border-border bg-card text-muted-foreground";
}

function providerName(provider: LlmProviderConfig | undefined, providerId?: string | null) {
    return provider?.label || providerId || "Provider";
}

function enabledModels(provider?: LlmProviderConfig) {
    return provider?.models.filter((model) => model.is_enabled) ?? [];
}

function textPayload(payload: Record<string, unknown>, key: string) {
    const value = payload[key];
    return typeof value === "string" ? value : "";
}

function jsonPreview(value: unknown) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function assistantText(events: BrokerChatEvent[], run: BrokerChatRun) {
    const finalMessage = [...events]
        .reverse()
        .find((event) => event.event_type === "message_output" && textPayload(event.payload, "content"));
    if (finalMessage) {
        return textPayload(finalMessage.payload, "content");
    }
    const completed = [...events]
        .reverse()
        .find((event) => event.event_type === "run_completed" && textPayload(event.payload, "response_text"));
    if (completed) {
        return textPayload(completed.payload, "response_text");
    }
    const tokens = events
        .filter((event) => event.event_type === "token")
        .map((event) => textPayload(event.payload, "text"))
        .join("");
    return tokens || run.response_text || "";
}

function parseSseBlock(block: string): ParsedSseEvent | null {
    const event: ParsedSseEvent = {};
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

function toolOutputPreview(event?: BrokerChatEvent) {
    const outputMetadata = event?.payload.output_metadata;
    if (typeof outputMetadata === "object" && outputMetadata !== null && "preview" in outputMetadata) {
        return String((outputMetadata as { preview?: unknown }).preview ?? "");
    }
    return event ? textPayload(event.payload, "message") : "";
}

function groupToolSteps(events: BrokerChatEvent[]): ToolStep[] {
    const steps: ToolStep[] = [];
    const pending: ToolStep[] = [];
    for (const event of events) {
        if (event.event_type === "tool_call_started") {
            const callId = textPayload(event.payload, "tool_call_id") || null;
            const step = {
                key: callId || `${event.run_id}:${event.sequence}`,
                toolName: textPayload(event.payload, "tool_name") || "tool",
                callId,
                start: event
            };
            steps.push(step);
            pending.push(step);
            continue;
        }
        if (event.event_type === "tool_call_completed") {
            const callId = textPayload(event.payload, "tool_call_id") || null;
            const outputName = textPayload(event.payload, "tool_name");
            const byCall = callId ? pending.find((item) => item.callId === callId && !item.output) : null;
            const byName = pending.find(
                (item) => !item.output && outputName !== "unknown" && item.toolName === outputName
            );
            const step = byCall ?? byName ?? pending.find((item) => !item.output);
            if (step) {
                step.output = event;
                step.toolName = outputName && outputName !== "unknown" ? outputName : step.toolName;
                continue;
            }
            steps.push({
                key: `${event.run_id}:${event.sequence}`,
                toolName: outputName && outputName !== "unknown" ? outputName : "tool",
                callId,
                output: event
            });
        }
    }
    return steps;
}

function ToolStepRow({ step }: { step: ToolStep }) {
    const argumentsPayload = step.start?.payload.arguments ?? null;
    const outputPayload = step.output?.payload.output ?? null;
    const preview = toolOutputPreview(step.output);
    const status = step.output ? "completed" : "running";

    return (
        <div className="border-l-2 border-border bg-secondary/35 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <IconTool className="size-4 text-muted-foreground" stroke={1.8} />
                <span className="font-mono text-[11px] font-bold uppercase text-muted-foreground">
                    Tool
                </span>
                <span className="truncate text-sm font-semibold">{step.toolName}</span>
                <StatusBadge className={status === "completed" ? statusClass("completed") : statusClass("running")}>
                    {status}
                </StatusBadge>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    #{step.start?.sequence ?? step.output?.sequence}
                    {step.output ? `-${step.output.sequence}` : ""}
                </span>
            </div>
            {preview ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{preview}</p> : null}
            {argumentsPayload || outputPayload ? (
                <details className="mt-2">
                    <summary className="cursor-pointer font-mono text-[10px] font-bold uppercase text-primary">
                        Details
                    </summary>
                    {argumentsPayload ? (
                        <>
                            <div className="mt-2 font-mono text-[10px] font-bold uppercase text-muted-foreground">
                                Arguments
                            </div>
                            <pre className="mt-1 max-h-52 overflow-auto border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
                                {jsonPreview(argumentsPayload)}
                            </pre>
                        </>
                    ) : null}
                    {outputPayload ? (
                        <>
                            <div className="mt-2 font-mono text-[10px] font-bold uppercase text-muted-foreground">
                                Output
                            </div>
                            <pre className="mt-1 max-h-72 overflow-auto border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
                                {jsonPreview(outputPayload)}
                            </pre>
                        </>
                    ) : null}
                </details>
            ) : null}
        </div>
    );
}

function AssistantMessage({ text, running }: { text: string; running: boolean }) {
    return (
        <div className="flex gap-3">
            <span className="mt-1 flex size-8 shrink-0 items-center justify-center border border-primary/50 bg-[var(--accent-subtle)] text-primary">
                <IconTerminal2 className="size-4" stroke={1.8} />
            </span>
            <div className="min-w-0 flex-1 border border-border bg-card px-4 py-3">
                {text ? (
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                            ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>,
                            ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>,
                            code: ({ children }) => (
                                <code className="bg-secondary px-1 py-0.5 font-mono text-[0.92em]">{children}</code>
                            ),
                            pre: ({ children }) => (
                                <pre className="mb-3 overflow-auto border border-border bg-secondary p-3 text-xs">
                                    {children}
                                </pre>
                            )
                        }}
                    >
                        {text}
                    </ReactMarkdown>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {running ? "Waiting for the assistant..." : "No assistant response was stored for this run."}
                    </p>
                )}
            </div>
        </div>
    );
}

function UserMessage({ text }: { text: string }) {
    return (
        <div className="flex gap-3">
            <span className="mt-1 flex size-8 shrink-0 items-center justify-center border border-border bg-secondary text-muted-foreground">
                <IconUser className="size-4" stroke={1.8} />
            </span>
            <div className="min-w-0 flex-1 border border-border bg-background px-4 py-3">
                <p className="whitespace-pre-wrap text-sm leading-6">{text}</p>
            </div>
        </div>
    );
}

export function BrokerChatWorkspace({ initialConfig, initialRuns, initialSessions, llmProviders, mcpServer }: Props) {
    const { user } = useSession();
    const [sessions, setSessions] = useState(() => sortSessions(initialSessions));
    const [runs, setRuns] = useState(() => mergeRuns([], initialRuns));
    const [eventsByRun, setEventsByRun] = useState<Record<string, BrokerChatEvent[]>>({});
    const [activeSessionId, setActiveSessionId] = useState(initialSessions[0]?.id ?? initialRuns[0]?.session_id ?? "");
    const [message, setMessage] = useState("");
    const [provider, setProvider] = useState<LlmProvider | "">(initialConfig.default_provider ?? "");
    const [model, setModel] = useState(initialConfig.default_model ?? "");
    const [visibility, setVisibility] = useState<BrokerChatVisibility>(initialConfig.event_visibility);
    const [includeToolOutputs, setIncludeToolOutputs] = useState(initialConfig.include_tool_outputs);
    const [includeReasoning, setIncludeReasoning] = useState(initialConfig.include_reasoning);
    const [useMcp, setUseMcp] = useState(initialConfig.use_mcp && mcpServer.is_enabled);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [configError, setConfigError] = useState<string | null>(null);
    const [streamingIds, setStreamingIds] = useState<string[]>([]);
    const [queueHealth, setQueueHealth] = useState<BrokerChatQueueHealth | null>(null);
    const streamControllersRef = useRef<Record<string, AbortController>>({});
    const configSaveRequestRef = useRef(0);
    const savedConfigKeyRef = useRef(
        brokerChatConfigKey({
            default_provider: initialConfig.default_provider ?? "",
            default_model: initialConfig.default_model ?? "",
            event_visibility: initialConfig.event_visibility,
            include_tool_outputs: initialConfig.include_tool_outputs,
            include_reasoning: initialConfig.include_reasoning,
            use_mcp: initialConfig.use_mcp && mcpServer.is_enabled
        })
    );

    const configuredProviders = useMemo(
        () => llmProviders.filter((item) => item.is_enabled && item.has_api_key),
        [llmProviders]
    );
    const selectedProvider = configuredProviders.find((item) => item.provider === provider);
    const selectedModels = useMemo(() => enabledModels(selectedProvider), [selectedProvider]);

    useEffect(() => {
        if (!provider && configuredProviders[0]) {
            setProvider(configuredProviders[0].provider);
            setModel(configuredProviders[0].models.find((item) => item.is_enabled)?.model_id ?? "");
        }
    }, [configuredProviders, provider]);

    useEffect(() => {
        if (!selectedProvider) {
            return;
        }
        const hasModel = selectedModels.some((item) => item.model_id === model);
        if (!hasModel) {
            setModel(selectedModels[0]?.model_id ?? "");
        }
    }, [model, selectedModels, selectedProvider]);

    const runsForActiveSession = useMemo(
        () => sortRuns(runs.filter((run) => run.session_id === activeSessionId)),
        [activeSessionId, runs]
    );

    const latestRunBySession = useMemo(() => {
        const map = new Map<string, BrokerChatRun>();
        for (const run of [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
            if (!map.has(run.session_id)) {
                map.set(run.session_id, run);
            }
        }
        return map;
    }, [runs]);

    const hasConfiguredLlm = Boolean(provider && model);
    const activeRun = runsForActiveSession.find((run) => liveStatuses.has(run.status)) ?? null;
    const sendDisabled = Boolean(activeRun) || !message.trim() || !hasConfiguredLlm || isSubmitting;
    const configPayload = useMemo<BrokerChatConfigPayload | null>(() => {
        if (!provider || !model) {
            return null;
        }
        return {
            default_provider: provider,
            default_model: model,
            event_visibility: visibility,
            include_tool_outputs: includeToolOutputs,
            include_reasoning: includeReasoning,
            use_mcp: useMcp
        };
    }, [includeReasoning, includeToolOutputs, model, provider, useMcp, visibility]);

    useEffect(() => {
        const requestId = ++configSaveRequestRef.current;
        if (!configPayload) {
            setIsSavingConfig(false);
            return;
        }
        const nextConfigKey = brokerChatConfigKey(configPayload);
        if (nextConfigKey === savedConfigKeyRef.current) {
            setIsSavingConfig(false);
            return;
        }
        setIsSavingConfig(true);
        const timeout = window.setTimeout(async () => {
            try {
                await updateBrokerChatConfig(configPayload);
                if (requestId === configSaveRequestRef.current) {
                    savedConfigKeyRef.current = nextConfigKey;
                    setConfigError(null);
                }
            } catch (err) {
                if (requestId === configSaveRequestRef.current) {
                    setConfigError((err as Error).message);
                }
            } finally {
                if (requestId === configSaveRequestRef.current) {
                    setIsSavingConfig(false);
                }
            }
        }, 600);
        return () => {
            window.clearTimeout(timeout);
        };
    }, [configPayload]);

    const streamRun = useCallback(
        async (runId: string, afterSequence = 0) => {
            if (!user?.id || streamControllersRef.current[runId]) {
                return;
            }
            const controller = new AbortController();
            streamControllersRef.current[runId] = controller;
            setStreamingIds((current) => (current.includes(runId) ? current : [...current, runId]));
            const params = new URLSearchParams({
                after_sequence: String(afterSequence),
                visibility,
                include_tool_outputs: String(includeToolOutputs),
                include_reasoning: String(includeReasoning)
            });
            const url = `${getPublicApiBaseUrl()}/broker-chat/runs/${runId}/stream?${params.toString()}`;

            try {
                const response = await fetch(url, {
                    cache: "no-store",
                    headers: {
                        Accept: "text/event-stream",
                        "X-User-Id": user.id
                    },
                    signal: controller.signal
                });
                if (!response.ok || !response.body) {
                    throw new Error("Could not open broker chat stream.");
                }
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    let boundary = buffer.indexOf("\n\n");
                    while (boundary >= 0) {
                        const block = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const parsed = parseSseBlock(block);
                        if (parsed?.event && parsed.event !== "ping" && parsed.event !== "error") {
                            const sequence = Number(parsed.id ?? 0);
                            const payload = parsed.data ? (JSON.parse(parsed.data) as Record<string, unknown>) : {};
                            const event: BrokerChatEvent = {
                                id: `${runId}:${sequence}`,
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
                            if (parsed.event === "run_started") {
                                setRuns((current) =>
                                    current.map((run) =>
                                        run.id === runId
                                            ? { ...run, status: "running", started_at: new Date().toISOString() }
                                            : run
                                    )
                                );
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
                const freshRun = await getBrokerChatRun(runId).catch(() => null);
                if (freshRun) {
                    setRuns((current) => mergeRuns(current, [freshRun]));
                }
            } catch (err) {
                if ((err as Error).name !== "AbortError") {
                    setError((err as Error).message || "Broker chat stream stopped.");
                }
            } finally {
                delete streamControllersRef.current[runId];
                setStreamingIds((current) => current.filter((id) => id !== runId));
            }
        },
        [includeReasoning, includeToolOutputs, user?.id, visibility]
    );

    const loadRunEvents = useCallback(
        async (runId: string) => {
            const page = await getBrokerChatEvents(runId, {
                limit: 500,
                visibility,
                includeToolOutputs,
                includeReasoning
            });
            setRuns((current) => mergeRuns(current, [page.run]));
            setEventsByRun((current) => ({ ...current, [runId]: page.events }));
            if (liveStatuses.has(page.run.status)) {
                const lastSequence = page.events.at(-1)?.sequence ?? 0;
                void streamRun(runId, lastSequence);
            }
        },
        [includeReasoning, includeToolOutputs, streamRun, visibility]
    );

    useEffect(() => {
        if (!activeSessionId) {
            return;
        }
        let cancelled = false;
        async function loadSession() {
            try {
                const sessionRuns = await getBrokerChatRuns({ sessionId: activeSessionId, limit: 80 });
                if (cancelled) return;
                setRuns((current) => mergeRuns(current, sessionRuns));
                await Promise.all(sessionRuns.map((run) => loadRunEvents(run.id)));
            } catch (err) {
                if (!cancelled) setError((err as Error).message);
            }
        }
        void loadSession();
        return () => {
            cancelled = true;
        };
    }, [activeSessionId, loadRunEvents]);

    useEffect(() => {
        for (const run of runs) {
            if (liveStatuses.has(run.status)) {
                const lastSequence = eventsByRun[run.id]?.at(-1)?.sequence ?? 0;
                void streamRun(run.id, lastSequence);
            }
        }
    }, [eventsByRun, runs, streamRun]);

    useEffect(() => {
        return () => {
            Object.values(streamControllersRef.current).forEach((controller) => controller.abort());
        };
    }, []);

    useEffect(() => {
        void getBrokerChatQueueHealth()
            .then(setQueueHealth)
            .catch(() => setQueueHealth(null));
    }, []);

    async function refreshAll() {
        setError(null);
        const [nextSessions, nextRuns, nextQueueHealth] = await Promise.all([
            getBrokerChatSessions(80),
            getBrokerChatRuns({ limit: 160 }),
            getBrokerChatQueueHealth().catch(() => null)
        ]);
        setSessions(sortSessions(nextSessions));
        setRuns((current) => mergeRuns(current, nextRuns));
        if (nextQueueHealth) {
            setQueueHealth(nextQueueHealth);
        }
        await Promise.all(runsForActiveSession.map((run) => loadRunEvents(run.id)));
    }

    async function stopActiveRun() {
        if (!activeRun) return;
        setError(null);
        try {
            const nextRun = await cancelBrokerChatRun(activeRun.id);
            streamControllersRef.current[activeRun.id]?.abort();
            setRuns((current) => mergeRuns(current, [nextRun]));
            await loadRunEvents(activeRun.id);
        } catch (err) {
            setError((err as Error).message);
        }
    }

    async function deleteActiveSession() {
        if (!activeSessionId) return;
        setError(null);
        try {
            const deleteId = activeSessionId;
            runs
                .filter((run) => run.session_id === deleteId)
                .forEach((run) => streamControllersRef.current[run.id]?.abort());
            await deleteBrokerChatSession(deleteId);
            const [nextSessions, nextRuns] = await Promise.all([
                getBrokerChatSessions(80),
                getBrokerChatRuns({ limit: 160 })
            ]);
            setSessions(sortSessions(nextSessions));
            setRuns(mergeRuns([], nextRuns));
            setActiveSessionId(nextSessions[0]?.id ?? "");
        } catch (err) {
            setError((err as Error).message);
        }
    }

    async function createNewChat() {
        setIsCreatingSession(true);
        setError(null);
        try {
            const session = await createBrokerChatSession("Broker chat");
            setSessions((current) => sortSessions([session, ...current]));
            setActiveSessionId(session.id);
            setMessage("");
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsCreatingSession(false);
        }
    }

    async function sendMessage() {
        const trimmed = message.trim();
        if (!trimmed || !provider || !model || isSubmitting || activeRun) {
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const result = await submitBrokerChatRun({
                message: trimmed,
                session_id: activeSessionId || null,
                provider,
                model,
                event_visibility: visibility,
                include_tool_outputs: includeToolOutputs,
                include_reasoning: includeReasoning,
                use_mcp: useMcp
            });
            setMessage("");
            setRuns((current) => mergeRuns(current, [result.run]));
            if (!activeSessionId) {
                setActiveSessionId(result.run.session_id);
            }
            const nextSessions = await getBrokerChatSessions(80).catch(() => sessions);
            setSessions(sortSessions(nextSessions));
            void streamRun(result.run.id, 0);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    }

    const emptyState = !sessions.length && !runs.length;

    return (
        <section className="grid min-h-[650px] gap-4 min-[1080px]:grid-cols-[312px_minmax(0,1fr)]">
            <aside className="min-h-0 border border-border bg-background">
                <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                    <div>
                        <h2 className="text-sm font-bold uppercase">Chats</h2>
                        <p className="mt-1 text-xs text-muted-foreground">{sessions.length} saved sessions</p>
                    </div>
                    <Button
                        aria-label="New chat"
                        className="size-9"
                        disabled={isCreatingSession}
                        onClick={createNewChat}
                        size="icon"
                        type="button"
                        variant="outline"
                    >
                        {isCreatingSession ? (
                            <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                        ) : (
                            <IconMessagePlus className="size-4" stroke={1.8} />
                        )}
                    </Button>
                </div>

                <div className="max-h-[calc(100dvh-250px)] min-h-[520px] overflow-y-auto p-2">
                    {emptyState ? (
                        <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
                            Start a chat to create the first broker data session.
                        </div>
                    ) : null}
                    <div className="grid gap-2">
                        {sessions.map((session) => {
                            const latestRun = latestRunBySession.get(session.id);
                            const active = session.id === activeSessionId;
                            const live = latestRun ? liveStatuses.has(latestRun.status) : false;
                            return (
                                <div
                                    className={cn(
                                        "min-w-0 border px-3 py-3 transition hover:border-primary/50",
                                        active
                                            ? "border-primary bg-[var(--accent-subtle)]"
                                            : "border-border bg-card hover:bg-secondary/50"
                                    )}
                                    key={session.id}
                                >
                                    <button
                                        className="w-full min-w-0 text-left"
                                        onClick={() => setActiveSessionId(session.id)}
                                        type="button"
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate text-sm font-semibold">{session.title}</span>
                                            {live ? (
                                                <IconLoader2
                                                    className="ml-auto size-4 animate-spin text-primary"
                                                    stroke={1.8}
                                                />
                                            ) : null}
                                        </div>
                                        <div className="mt-2 flex min-w-0 items-center gap-2">
                                            {latestRun ? (
                                                <StatusBadge className={statusClass(latestRun.status)}>
                                                    {latestRun.status}
                                                </StatusBadge>
                                            ) : (
                                                <StatusBadge>empty</StatusBadge>
                                            )}
                                            <span className="truncate text-xs text-muted-foreground">
                                                {formatDate(session.updated_at)}
                                            </span>
                                        </div>
                                    </button>
                                    {active ? (
                                        <button
                                            className="mt-3 inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-muted-foreground hover:text-destructive"
                                            onClick={deleteActiveSession}
                                            type="button"
                                        >
                                            <IconTrash className="size-3.5" stroke={1.8} />
                                            Delete
                                        </button>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </aside>

            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border border-border bg-background">
                <div className="border-b border-border p-4">
                    <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-end min-[900px]:justify-between">
                        <div className="min-w-0">
                            <h2 className="truncate text-xl font-semibold">
                                {sessions.find((session) => session.id === activeSessionId)?.title ?? "New broker chat"}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {runsForActiveSession.length} message run
                                {runsForActiveSession.length === 1 ? "" : "s"} in this chat
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {activeRun ? (
                                <Button onClick={stopActiveRun} size="sm" type="button" variant="destructive">
                                    <IconPlayerStop className="size-4" stroke={1.8} />
                                    Stop
                                </Button>
                            ) : null}
                            {activeSessionId ? (
                                <Button onClick={deleteActiveSession} size="sm" type="button" variant="outline">
                                    <IconTrash className="size-4" stroke={1.8} />
                                    Delete
                                </Button>
                            ) : null}
                            <Button onClick={refreshAll} size="sm" type="button" variant="outline">
                                <IconRefresh className="size-4" stroke={1.8} />
                                Refresh
                            </Button>
                            {isSavingConfig ? (
                                <span
                                    aria-live="polite"
                                    className="inline-flex h-8 items-center gap-2 border border-border bg-secondary px-3 font-mono text-[10px] font-bold uppercase text-muted-foreground"
                                >
                                    <IconLoader2 className="size-3.5 animate-spin" stroke={1.8} />
                                    Autosaving
                                </span>
                            ) : null}
                        </div>
                    </div>

                    <div className="mt-4 grid gap-3 min-[780px]:grid-cols-2 min-[1280px]:grid-cols-[1fr_1fr_180px_auto_auto_auto]">
                        <Label className="grid gap-1 text-xs uppercase text-muted-foreground">
                            Provider
                            <Select
                                disabled={!configuredProviders.length}
                                onChange={(event) => setProvider(event.target.value as LlmProvider)}
                                value={provider}
                            >
                                <option value="">Select provider</option>
                                {configuredProviders.map((item) => (
                                    <option key={item.provider} value={item.provider}>
                                        {providerName(item)}
                                    </option>
                                ))}
                            </Select>
                        </Label>
                        <Label className="grid gap-1 text-xs uppercase text-muted-foreground">
                            Model
                            <Select disabled={!selectedModels.length} onChange={(event) => setModel(event.target.value)} value={model}>
                                <option value="">Select model</option>
                                {selectedModels.map((item) => (
                                    <option key={item.id} value={item.model_id}>
                                        {item.label || item.model_id}
                                    </option>
                                ))}
                            </Select>
                        </Label>
                        <Label className="grid gap-1 text-xs uppercase text-muted-foreground">
                            Detail
                            <Select
                                onChange={(event) => setVisibility(event.target.value as BrokerChatVisibility)}
                                value={visibility}
                            >
                                <option value="minimal">Minimal</option>
                                <option value="tool_calls">Tool calls</option>
                                <option value="full">Full</option>
                            </Select>
                        </Label>
                        <Label className="flex items-center gap-2 self-end text-xs font-semibold uppercase text-muted-foreground">
                            <Checkbox
                                checked={includeToolOutputs}
                                onCheckedChange={(value) => setIncludeToolOutputs(Boolean(value))}
                            />
                            Tool output
                        </Label>
                        <Label className="flex items-center gap-2 self-end text-xs font-semibold uppercase text-muted-foreground">
                            <Checkbox
                                checked={includeReasoning}
                                onCheckedChange={(value) => setIncludeReasoning(Boolean(value))}
                            />
                            Reasoning
                        </Label>
                        <Label className="flex items-center gap-2 self-end text-xs font-semibold uppercase text-muted-foreground">
                            <Checkbox
                                checked={useMcp}
                                disabled={!mcpServer.is_enabled}
                                onCheckedChange={(value) => setUseMcp(Boolean(value))}
                            />
                            MCP
                        </Label>
                    </div>

                    {!configuredProviders.length ? (
                        <div className="mt-4 flex items-start gap-2 border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)] dark:text-[var(--accent)]">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            Configure and enable at least one LLM provider in System Config before sending broker chat messages.
                        </div>
                    ) : null}
                    {error ? (
                        <div className="mt-4 flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            {error}
                        </div>
                    ) : null}
                    {configError ? (
                        <div className="mt-4 flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            {configError}
                        </div>
                    ) : null}
                    {!mcpServer.is_enabled ? (
                        <div className="mt-3 text-xs text-muted-foreground">
                            MCP tools are disabled in System Config.
                        </div>
                    ) : null}
                    {queueHealth && !queueHealth.has_processing_path ? (
                        <div className="mt-3 flex items-start gap-2 border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)] dark:text-[var(--accent)]">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            Broker chat jobs are queued, but no RQ worker or in-process worker is currently available.
                        </div>
                    ) : null}
                </div>

                <div className="min-h-0 overflow-y-auto p-4">
                    {!runsForActiveSession.length ? (
                        <div className="flex min-h-[360px] items-center justify-center border border-dashed border-border p-8 text-center">
                            <div>
                                <IconMessagePlus className="mx-auto size-8 text-muted-foreground" stroke={1.6} />
                                <h3 className="mt-3 text-lg font-semibold">Ask about broker data</h3>
                                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                                    The assistant can call the broker data tools for connected accounts, quotes, history,
                                    instruments, option chains, greeks, funds, positions, holdings, and stream state.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-6">
                            {runsForActiveSession.map((run) => {
                                const events = eventsByRun[run.id] ?? [];
                                const running = liveStatuses.has(run.status) || streamingIds.includes(run.id);
                                const toolSteps = groupToolSteps(events);
                                const text = assistantText(events, run);
                                return (
                                    <article className="grid gap-3" key={run.id}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StatusBadge className={statusClass(run.status)}>{run.status}</StatusBadge>
                                            <span className="text-xs text-muted-foreground">
                                                {run.provider} / {run.model_id}
                                            </span>
                                            <span className="ml-auto text-xs text-muted-foreground">
                                                {formatDate(run.created_at)}
                                            </span>
                                        </div>
                                        <UserMessage text={run.message} />
                                        {toolSteps.length ? (
                                            <div className="ml-11 grid gap-2">
                                                {toolSteps.map((step) => (
                                                    <ToolStepRow step={step} key={step.key} />
                                                ))}
                                            </div>
                                        ) : null}
                                        <AssistantMessage running={running} text={text} />
                                        {run.error ? (
                                            <div className="ml-11 flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                                                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                                                {run.error}
                                            </div>
                                        ) : null}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>

                <form
                    className="border-t border-border p-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void sendMessage();
                    }}
                >
                    <div className="grid gap-3 min-[760px]:grid-cols-[minmax(0,1fr)_auto]">
                        <Textarea
                            className="min-h-24 resize-none"
                            disabled={!hasConfiguredLlm || isSubmitting || Boolean(activeRun)}
                            onChange={(event) => setMessage(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                    event.preventDefault();
                                    void sendMessage();
                                }
                            }}
                            placeholder="Ask for connected broker status, holdings, positions, latest quotes, option chain data, or stream health."
                            value={message}
                        />
                        <Button
                            className="h-full min-h-12 min-[760px]:w-36"
                            disabled={sendDisabled}
                            type="submit"
                        >
                            {isSubmitting ? (
                                <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                            ) : (
                                <IconArrowRight className="size-4" stroke={1.8} />
                            )}
                            Send
                        </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <IconCircleCheck className="size-3.5" stroke={1.8} />
                            Uses saved broker and LLM credentials
                        </span>
                        <span>Ctrl/Command + Enter sends</span>
                        <span>
                            {visibility === "minimal"
                                ? "Minimal tool visibility"
                                : visibility === "tool_calls"
                                  ? "Tool call visibility"
                                  : "Full event visibility"}
                        </span>
                        <span>{useMcp ? "MCP enabled for this chat" : "MCP disabled"}</span>
                        {queueHealth ? (
                            <span>
                                Queue {queueHealth.queue_name}: {queueHealth.queued_count} queued ·{" "}
                                {typeof queueHealth.oldest_queued_seconds === "number"
                                    ? `oldest ${Math.round(queueHealth.oldest_queued_seconds)}s · `
                                    : ""}
                                {queueHealth.has_active_worker
                                    ? `${queueHealth.external_worker_count ?? queueHealth.active_worker_count} RQ worker${(queueHealth.external_worker_count ?? queueHealth.active_worker_count) === 1 ? "" : "s"}${queueHealth.fallback_worker_count ? ` · ${queueHealth.fallback_worker_count} fallback` : ""}`
                                    : queueHealth.in_process_worker_enabled
                                      ? "fallback available"
                                      : "no worker"}
                            </span>
                        ) : null}
                        {activeRun ? <span>Stop the active run before sending another message.</span> : null}
                    </div>
                </form>
            </div>
        </section>
    );
}
