"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStatus } from "ai";
import { useSession } from "@/components/session-provider";
import {
    LIVE_BROKER_CHAT_STATUSES,
    buildAdaptiveWorkspaceMessages,
    mergeBrokerChatEvents,
    mergeBrokerChatRuns,
    parseSseBlock,
    sortBrokerChatSessions,
    textPayload
} from "@/lib/adaptive-workspace/chat-events";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";
import {
    cancelBrokerChatRun,
    createBrokerChatSession,
    deleteBrokerChatSession,
    getBrokerChatEvents,
    getBrokerChatQueueHealth,
    getBrokerChatRun,
    getBrokerChatRuns,
    getBrokerChatSessions,
    submitBrokerChatRun
} from "@/service/actions/broker-chat";
import type { LlmProvider, LlmProviderConfig, McpServerConfig } from "@/service/types/broker";
import type {
    BrokerChatEvent,
    BrokerChatPreference,
    BrokerChatQueueHealth,
    BrokerChatRun,
    BrokerChatSession
} from "@/service/types/broker-chat";

type Args = {
    initialRuns: BrokerChatRun[];
    initialSessions: BrokerChatSession[];
    llmProviders: LlmProviderConfig[];
    mcpServer: McpServerConfig;
    mcpServers: McpServerConfig[];
    preference: BrokerChatPreference;
};

function enabledModels(provider?: LlmProviderConfig) {
    return provider?.models.filter((model) => model.is_enabled) ?? [];
}

export function useAdaptiveWorkspaceChat({
    initialRuns,
    initialSessions,
    llmProviders,
    mcpServer,
    mcpServers,
    preference
}: Args) {
    const { user } = useSession();
    const [sessions, setSessions] = useState(() => sortBrokerChatSessions(initialSessions));
    const [runs, setRuns] = useState(() => mergeBrokerChatRuns([], initialRuns));
    const [eventsByRun, setEventsByRun] = useState<Record<string, BrokerChatEvent[]>>({});
    const [activeSessionId, setActiveSessionId] = useState(initialSessions[0]?.id ?? initialRuns[0]?.session_id ?? "");
    const [message, setMessage] = useState("");
    const loadedSessionIdRef = useRef<string | null>(null);
    const [provider, setProvider] = useState<LlmProvider | "">(preference.default_provider ?? "");
    const [model, setModel] = useState(preference.default_model ?? "");
    const availableMcpServers = useMemo(
        () => (mcpServers.length ? mcpServers : [mcpServer]).filter((server) => server.id && server.is_enabled),
        [mcpServer, mcpServers]
    );
    const [useMcp, setUseMcp] = useState(preference.use_mcp && availableMcpServers.length > 0);
    const [selectedMcpServerIds, setSelectedMcpServerIds] = useState(() => {
        if (preference.mcp_server_ids.length) return preference.mcp_server_ids;
        const defaults = availableMcpServers.filter((server) => server.use_by_default).map((server) => server.id as string);
        return defaults.length ? defaults : availableMcpServers.map((server) => server.id as string);
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [streamingIds, setStreamingIds] = useState<string[]>([]);
    const [queueHealth, setQueueHealth] = useState<BrokerChatQueueHealth | null>(null);
    const streamControllersRef = useRef<Record<string, AbortController>>({});
    const previousProviderRef = useRef<LlmProvider | "">(preference.default_provider ?? "");
    const runsRef = useRef(runs);
    const eventsByRunRef = useRef(eventsByRun);

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
        if (!selectedProvider) return;
        const providerChanged = previousProviderRef.current !== provider;
        previousProviderRef.current = provider;
        if (!providerChanged && model) return;
        const hasModel = selectedModels.some((item) => item.model_id === model);
        if (!model || (providerChanged && !hasModel)) {
            setModel(selectedModels[0]?.model_id ?? "");
        }
    }, [model, provider, selectedModels, selectedProvider]);

    const runsForActiveSession = useMemo(
        () => [...runs.filter((run) => run.session_id === activeSessionId)].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
        [activeSessionId, runs]
    );
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    const hasConfiguredLlm = Boolean(provider && model);
    const activeRun = runsForActiveSession.find((run) => LIVE_BROKER_CHAT_STATUSES.has(run.status)) ?? null;
    const chatStatus: ChatStatus = activeRun || isSubmitting ? "streaming" : "ready";
    const messages = useMemo(
        () =>
            buildAdaptiveWorkspaceMessages({
                eventsByRun,
                includeReasoning: false,
                includeUnmappedTools: false,
                runs: runsForActiveSession,
                streamingIds
            }),
        [eventsByRun, runsForActiveSession, streamingIds]
    );
    const activeLiveRunIdsKey = useMemo(
        () => runsForActiveSession.filter((run) => LIVE_BROKER_CHAT_STATUSES.has(run.status)).map((run) => run.id).join("|"),
        [runsForActiveSession]
    );

    const streamRun = useCallback(
        async (runId: string, afterSequence = 0) => {
            if (!user?.id) return;
            const existingController = streamControllersRef.current[runId];
            if (existingController && !existingController.signal.aborted) return;
            if (existingController?.signal.aborted) delete streamControllersRef.current[runId];
            const controller = new AbortController();
            streamControllersRef.current[runId] = controller;
            setStreamingIds((current) => (current.includes(runId) ? current : [...current, runId]));
            let latestSequence = afterSequence;
            let reconnectAfterClose = false;
            const params = new URLSearchParams({
                after_sequence: String(afterSequence),
                visibility: "full",
                include_tool_outputs: "true",
                include_reasoning: "false"
            });
            const url = `${getPublicApiBaseUrl()}/broker-chat/runs/${runId}/stream?${params.toString()}`;
            try {
                const response = await fetch(url, {
                    cache: "no-store",
                    headers: { Accept: "text/event-stream", "X-User-Id": user.id },
                    signal: controller.signal
                });
                if (!response.ok || !response.body) {
                    throw new Error("Could not open adaptive workspace stream.");
                }
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
                            latestSequence = Number.isFinite(sequence) ? Math.max(latestSequence, sequence) : latestSequence;
                            const payload = parsed.data ? (JSON.parse(parsed.data) as Record<string, unknown>) : {};
                            const event: BrokerChatEvent = {
                                created_at: new Date().toISOString(),
                                event_type: parsed.event,
                                id: `${runId}:${sequence}`,
                                payload,
                                run_id: runId,
                                sequence
                            };
                            setEventsByRun((current) => ({
                                ...current,
                                [runId]: mergeBrokerChatEvents(current[runId] ?? [], [event])
                            }));
                            if (parsed.event === "run_started") {
                                setRuns((current) =>
                                    current.map((run) =>
                                        run.id === runId ? { ...run, started_at: new Date().toISOString(), status: "running" } : run
                                    )
                                );
                            }
                            if (parsed.event === "run_completed" || parsed.event === "run_failed" || parsed.event === "run_cancelled") {
                                setRuns((current) =>
                                    current.map((run) =>
                                        run.id === runId
                                            ? {
                                                  ...run,
                                                  error: textPayload(payload, "message") || run.error,
                                                  response_text: textPayload(payload, "response_text") || run.response_text,
                                                  status:
                                                      parsed.event === "run_completed"
                                                          ? "completed"
                                                          : parsed.event === "run_cancelled"
                                                            ? "cancelled"
                                                            : "failed",
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
                    setRuns((current) => mergeBrokerChatRuns(current, [freshRun]));
                    reconnectAfterClose = LIVE_BROKER_CHAT_STATUSES.has(freshRun.status) && !controller.signal.aborted;
                }
            } catch (err) {
                if ((err as Error).name !== "AbortError") {
                    setError((err as Error).message || "Adaptive workspace stream stopped.");
                    const freshRun = await getBrokerChatRun(runId).catch(() => null);
                    if (freshRun) {
                        setRuns((current) => mergeBrokerChatRuns(current, [freshRun]));
                        reconnectAfterClose = LIVE_BROKER_CHAT_STATUSES.has(freshRun.status);
                    }
                }
            } finally {
                if (streamControllersRef.current[runId] === controller) {
                    delete streamControllersRef.current[runId];
                }
                setStreamingIds((current) => current.filter((id) => id !== runId));
                if (reconnectAfterClose && !controller.signal.aborted) {
                    window.setTimeout(() => {
                        void streamRun(runId, latestSequence);
                    }, 1000);
                }
            }
        },
        [user?.id]
    );

    const loadRunEvents = useCallback(
        async (runId: string) => {
            const page = await getBrokerChatEvents(runId, {
                includeReasoning: false,
                includeToolOutputs: true,
                limit: 500,
                visibility: "full"
            });
            setRuns((current) => mergeBrokerChatRuns(current, [page.run]));
            setEventsByRun((current) => ({
                ...current,
                [runId]: mergeBrokerChatEvents(current[runId] ?? [], page.events)
            }));
            if (LIVE_BROKER_CHAT_STATUSES.has(page.run.status)) {
                void streamRun(runId, page.events.at(-1)?.sequence ?? 0);
            }
        },
        [streamRun]
    );

    useEffect(() => {
        if (!activeSessionId || loadedSessionIdRef.current === activeSessionId) return;
        loadedSessionIdRef.current = activeSessionId;
        let cancelled = false;
        async function loadSession() {
            try {
                const sessionRuns = await getBrokerChatRuns({ limit: 80, sessionId: activeSessionId });
                if (cancelled) return;
                setRuns((current) => mergeBrokerChatRuns(current, sessionRuns));
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
        runsRef.current = runs;
    }, [runs]);

    useEffect(() => {
        eventsByRunRef.current = eventsByRun;
    }, [eventsByRun]);

    useEffect(() => {
        for (const run of runs) {
            if (LIVE_BROKER_CHAT_STATUSES.has(run.status)) {
                void streamRun(run.id, eventsByRun[run.id]?.at(-1)?.sequence ?? 0);
            }
        }
    }, [eventsByRun, runs, streamRun]);

    useEffect(() => {
        const liveRuns = runsRef.current.filter(
            (run) => run.session_id === activeSessionId && LIVE_BROKER_CHAT_STATUSES.has(run.status)
        );
        if (!liveRuns.length) return;
        let cancelled = false;
        const interval = window.setInterval(() => {
            void Promise.all(
                liveRuns.map(async (run) => {
                    const page = await getBrokerChatEvents(run.id, {
                        afterSequence: eventsByRunRef.current[run.id]?.at(-1)?.sequence ?? 0,
                        includeReasoning: false,
                        includeToolOutputs: true,
                        limit: 100,
                        visibility: "full"
                    }).catch(() => null);
                    if (!page || cancelled) return;
                    setRuns((current) => mergeBrokerChatRuns(current, [page.run]));
                    if (page.events.length) {
                        setEventsByRun((current) => ({
                            ...current,
                            [run.id]: mergeBrokerChatEvents(current[run.id] ?? [], page.events)
                        }));
                    }
                })
            );
        }, 2500);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [activeLiveRunIdsKey, activeSessionId]);

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

    async function stopActiveRun() {
        if (!activeRun) return;
        setError(null);
        try {
            const nextRun = await cancelBrokerChatRun(activeRun.id);
            streamControllersRef.current[activeRun.id]?.abort();
            setRuns((current) => mergeBrokerChatRuns(current, [nextRun]));
            await loadRunEvents(activeRun.id);
        } catch (err) {
            setError((err as Error).message);
        }
    }

    async function deleteSession(sessionId: string) {
        if (!sessionId) return;
        setError(null);
        try {
            runs.filter((run) => run.session_id === sessionId).forEach((run) => streamControllersRef.current[run.id]?.abort());
            await deleteBrokerChatSession(sessionId);
            const [nextSessions, nextRuns] = await Promise.all([getBrokerChatSessions(80), getBrokerChatRuns({ limit: 160 })]);
            setSessions(sortBrokerChatSessions(nextSessions));
            setRuns(mergeBrokerChatRuns([], nextRuns));
            if (sessionId === activeSessionId) {
                setActiveSessionId(nextSessions[0]?.id ?? "");
                loadedSessionIdRef.current = null;
            }
        } catch (err) {
            setError((err as Error).message);
        }
    }

    async function createNewChat() {
        setIsCreatingSession(true);
        setError(null);
        try {
            const session = await createBrokerChatSession("Adaptive workspace");
            setSessions((current) => sortBrokerChatSessions([session, ...current]));
            setActiveSessionId(session.id);
            loadedSessionIdRef.current = session.id;
            setMessage("");
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsCreatingSession(false);
        }
    }

    async function sendMessage(nextMessage = message) {
        const trimmed = nextMessage.trim();
        if (!trimmed || !provider || !model || isSubmitting || activeRun) return;
        setIsSubmitting(true);
        setError(null);
        try {
            const result = await submitBrokerChatRun({
                include_reasoning: false,
                include_tool_outputs: true,
                mcp_server_ids: selectedMcpServerIds,
                message: trimmed,
                model,
                provider,
                session_id: activeSessionId || null,
                session_title: activeSessionId ? null : "Adaptive workspace",
                use_mcp: useMcp,
                event_visibility: "full"
            });
            setMessage("");
            setRuns((current) => mergeBrokerChatRuns(current, [result.run]));
            if (!activeSessionId) {
                setActiveSessionId(result.run.session_id);
            }
            void streamRun(result.run.id, 0);
            const nextSessions = await getBrokerChatSessions(80).catch(() => sessions);
            setSessions(sortBrokerChatSessions(nextSessions));
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    }

    return {
        activeRun,
        activeSession,
        activeSessionId,
        availableMcpServers,
        chatStatus,
        configuredProviders,
        createNewChat,
        deleteSession,
        error,
        hasConfiguredLlm,
        isCreatingSession,
        isSubmitting,
        message,
        messages,
        model,
        provider,
        queueHealth,
        selectedMcpServerIds,
        selectedModels,
        selectedProvider,
        sendMessage,
        sessions,
        setActiveSessionId,
        setMessage,
        setModel,
        setProvider,
        setSelectedMcpServerIds,
        setUseMcp,
        stopActiveRun,
        useMcp
    };
}
