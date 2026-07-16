"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStatus, UIMessage } from "ai";
import {
    IconAlertTriangle,
    IconCircleCheck,
    IconLoader2,
    IconMessagePlus,
    IconPlugConnected,
    IconSearch,
    IconTerminal2,
    IconTool,
    IconTrash
} from "@tabler/icons-react";
import { InputBar } from "@/components/agent-elements/input-bar";
import { MessageList } from "@/components/agent-elements/message-list";
import { formatDate } from "@/components/brokers/ui";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardPanel } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
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
import type { OpenRouterModel } from "@/service/actions/llm-models";
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
    openRouterModels: OpenRouterModel[];
    mcpServer: McpServerConfig;
    mcpServers: McpServerConfig[];
};

type ParsedSseEvent = {
    id?: string;
    event?: string;
    data?: string;
};

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

type BrokerChatConfigPayload = {
    default_provider: LlmProvider;
    default_model: string;
    event_visibility: BrokerChatVisibility;
    include_tool_outputs: boolean;
    include_reasoning: boolean;
    use_mcp: boolean;
    mcp_server_ids: string[];
};
type BrokerChatConfigKeyPayload = Omit<BrokerChatConfigPayload, "default_provider"> & {
    default_provider: LlmProvider | "";
};

type ComposerToggleProps = {
    checked: boolean;
    disabled?: boolean;
    icon: ComponentType<{ className?: string; stroke?: number }>;
    label: string;
    onChange: (checked: boolean) => void;
    title?: string;
};

const liveStatuses = new Set(["queued", "running"]);
const BROKER_CHAT_EVENT_VISIBILITY: BrokerChatVisibility = "full";

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

function payloadValue(payload: Record<string, unknown> | undefined, key: string) {
    return payload && Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
}

function isMarketQuoteHeader(line: string) {
    return /symbol/i.test(line) && /(price|ltp|change|quote)/i.test(line);
}

function isMarkdownTableSeparator(line: string) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line: string) {
    return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
}

function isNumericText(value: string) {
    return /^[+-−]?(?:₹|\$|€|£)?[\d,.]+%?$/.test(value.trim());
}

function normalizeMarketQuoteCells(cells: string[]) {
    const symbol = cells[0]?.trim() ?? "";
    if (!symbol) {
        return null;
    }
    const rest = cells.slice(1).map((cell) => cell.trim());
    const filledRest = rest.filter(Boolean);
    const numericCells = filledRest.filter(isNumericText);
    if (numericCells.length >= 3) {
        const [ltp, dayChange, dayChangePercent] = numericCells.slice(-3);
        return [symbol, ltp, dayChange, dayChangePercent];
    }
    const status = filledRest.join(" ");
    return [symbol, status, "", ""];
}

function escapeMarkdownTableCell(value: string) {
    return value.replace(/\|/g, "\\|");
}

function normalizeMarketQuoteMarkdownTable(lines: string[]) {
    const rows = lines
        .slice(1)
        .filter((line) => !isMarkdownTableSeparator(line))
        .map((line) => normalizeMarketQuoteCells(splitMarkdownTableRow(line)))
        .filter((row): row is string[] => Boolean(row));

    if (!rows.length) {
        return lines.join("\n");
    }

    return [
        "| Symbol | Last Traded Price (LTP) | Day Change | Day Change (%) |",
        "| --- | --- | --- | --- |",
        ...rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`)
    ].join("\n");
}

function normalizeAssistantMarkdown(value: string) {
    const lines = value.replace(/\r\n/g, "\n").split("\n");
    const output: string[] = [];
    let tableBlock: string[] = [];
    let inFence = false;

    function flushTableBlock() {
        if (!tableBlock.length) {
            return;
        }
        output.push(
            isMarketQuoteHeader(tableBlock[0])
                ? normalizeMarketQuoteMarkdownTable(tableBlock)
                : tableBlock.join("\n")
        );
        tableBlock = [];
    }

    for (const line of lines) {
        if (/^\s*```/.test(line)) {
            flushTableBlock();
            inFence = !inFence;
            output.push(line);
            continue;
        }

        if (!inFence && line.includes("|")) {
            tableBlock.push(line);
            continue;
        }

        flushTableBlock();
        output.push(line);
    }

    flushTableBlock();
    return output.join("\n");
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

function safeToolName(name: string) {
    return name.replace(/[^A-Za-z0-9_]/g, "_") || "broker_tool";
}

function brokerToolPart(item: Extract<BrokerTraceItem, { kind: "tool" }>, isRunActive: boolean) {
    const startPayload = item.start?.payload;
    const outputPayload = item.output?.payload;
    return {
        type: `tool-mcp__broker__${safeToolName(item.toolName)}`,
        toolCallId: item.callId || item.key,
        state: item.output ? "output-available" : isRunActive ? "input-available" : "output-error",
        input: payloadValue(startPayload, "arguments") ?? {},
        output: payloadValue(outputPayload, "output")
    };
}

function buildBrokerMessages({
    eventsByRun,
    includeReasoning,
    includeToolOutputs,
    runs,
    streamingIds
}: {
    eventsByRun: Record<string, BrokerChatEvent[]>;
    includeReasoning: boolean;
    includeToolOutputs: boolean;
    runs: BrokerChatRun[];
    streamingIds: string[];
}): UIMessage[] {
    return runs.flatMap((run) => {
        const events = eventsByRun[run.id] ?? [];
        const running = liveStatuses.has(run.status) || streamingIds.includes(run.id);
        const traceItems = buildBrokerTraceItems(events);
        const text = assistantText(events, run);
        const assistantParts: unknown[] = [];

        for (const item of traceItems) {
            if (item.kind === "reasoning") {
                assistantParts.push({
                    type: "tool-Thinking",
                    toolCallId: item.key,
                    state: running ? "input-available" : "output-available",
                    input: {},
                    output: includeReasoning ? item.text : "Reasoning hidden"
                });
                continue;
            }
            if (includeToolOutputs || running || !item.output) {
                assistantParts.push(brokerToolPart(item, running));
            }
        }

        if (text) {
            assistantParts.push({ type: "text", text: normalizeAssistantMarkdown(text) });
        } else if (!running && !assistantParts.length) {
            assistantParts.push({
                type: "text",
                text: run.error ? `Run failed: ${run.error}` : "No assistant response was stored for this run."
            });
        }

        const messages: UIMessage[] = [
            {
                id: `${run.id}:user`,
                role: "user",
                parts: [{ type: "text", text: run.message }],
                createdAt: new Date(run.created_at)
            } as UIMessage
        ];

        if (assistantParts.length || running) {
            messages.push({
                id: `${run.id}:assistant`,
                role: "assistant",
                parts: assistantParts as UIMessage["parts"],
                createdAt: new Date(run.completed_at || run.updated_at || run.created_at)
            } as UIMessage);
        }

        return messages;
    });
}

function ComposerToggle({ checked, disabled, icon: Icon, label, onChange, title }: ComposerToggleProps) {
    return (
        <button
            aria-label={label}
            aria-pressed={checked}
            className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold uppercase transition-colors",
                checked
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                disabled ? "cursor-not-allowed opacity-45 hover:border-border hover:text-muted-foreground" : null
            )}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            title={title ?? label}
            type="button"
        >
            <Icon className="size-3.5" stroke={1.8} />
            <span>{label}</span>
        </button>
    );
}

export function BrokerChatWorkspace({
    initialConfig,
    initialRuns,
    initialSessions,
    llmProviders,
    mcpServer,
    mcpServers
}: Props) {
    const { user } = useSession();
    const [sessions, setSessions] = useState(() => sortSessions(initialSessions));
    const [runs, setRuns] = useState(() => mergeRuns([], initialRuns));
    const [eventsByRun, setEventsByRun] = useState<Record<string, BrokerChatEvent[]>>({});
    const [activeSessionId, setActiveSessionId] = useState(initialSessions[0]?.id ?? initialRuns[0]?.session_id ?? "");
    const [message, setMessage] = useState("");
    const [sessionSearch, setSessionSearch] = useState("");
    const loadedSessionIdRef = useRef<string | null>(null);
    const [provider, setProvider] = useState<LlmProvider | "">(initialConfig.default_provider ?? "");
    const [model, setModel] = useState(initialConfig.default_model ?? "");
    const [includeToolOutputs, setIncludeToolOutputs] = useState(initialConfig.include_tool_outputs);
    const [includeReasoning, setIncludeReasoning] = useState(initialConfig.include_reasoning);
    const availableMcpServers = useMemo(
        () => (mcpServers.length ? mcpServers : [mcpServer]).filter((server) => server.id && server.is_enabled),
        [mcpServer, mcpServers]
    );
    const defaultMcpServerIds = useMemo(() => {
        const defaults = availableMcpServers.filter((server) => server.use_by_default).map((server) => server.id as string);
        return defaults.length ? defaults : availableMcpServers.map((server) => server.id as string);
    }, [availableMcpServers]);
    const [useMcp, setUseMcp] = useState(initialConfig.use_mcp && availableMcpServers.length > 0);
    const [selectedMcpServerIds, setSelectedMcpServerIds] = useState(
        initialConfig.mcp_server_ids.length ? initialConfig.mcp_server_ids : defaultMcpServerIds
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [configError, setConfigError] = useState<string | null>(null);
    const [streamingIds, setStreamingIds] = useState<string[]>([]);
    const [queueHealth, setQueueHealth] = useState<BrokerChatQueueHealth | null>(null);
    const streamControllersRef = useRef<Record<string, AbortController>>({});
    const runsRef = useRef(runs);
    const eventsByRunRef = useRef(eventsByRun);
    const streamDetailKeyRef = useRef(`${includeToolOutputs}:${includeReasoning}`);
    const previousProviderRef = useRef<LlmProvider | "">(initialConfig.default_provider ?? "");
    const configSaveRequestRef = useRef(0);
    const savedConfigKeyRef = useRef(
        brokerChatConfigKey({
            default_provider: initialConfig.default_provider ?? "",
            default_model: initialConfig.default_model ?? "",
            event_visibility: BROKER_CHAT_EVENT_VISIBILITY,
            include_tool_outputs: initialConfig.include_tool_outputs,
            include_reasoning: initialConfig.include_reasoning,
            use_mcp: initialConfig.use_mcp && availableMcpServers.length > 0,
            mcp_server_ids: initialConfig.mcp_server_ids.length ? initialConfig.mcp_server_ids : defaultMcpServerIds
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
        const providerChanged = previousProviderRef.current !== provider;
        previousProviderRef.current = provider;
        if (!providerChanged && model) {
            return;
        }
        const hasModel = selectedModels.some((item) => item.model_id === model);
        if (!model || (providerChanged && !hasModel)) {
            setModel(selectedModels[0]?.model_id ?? "");
        }
    }, [model, provider, selectedModels, selectedProvider]);

    const runsForActiveSession = useMemo(
        () => sortRuns(runs.filter((run) => run.session_id === activeSessionId)),
        [activeSessionId, runs]
    );
    const activeSession = sessions.find((session) => session.id === activeSessionId);

    const latestRunBySession = useMemo(() => {
        const map = new Map<string, BrokerChatRun>();
        for (const run of [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
            if (!map.has(run.session_id)) {
                map.set(run.session_id, run);
            }
        }
        return map;
    }, [runs]);

    const filteredSessions = useMemo(() => {
        const normalizedSearch = sessionSearch.trim().toLowerCase();
        if (!normalizedSearch) {
            return sessions;
        }
        return sessions.filter((session) => {
            const latestRun = latestRunBySession.get(session.id);
            return [session.title, latestRun?.message, latestRun?.status]
                .filter(Boolean)
                .some((value) => value?.toLowerCase().includes(normalizedSearch));
        });
    }, [latestRunBySession, sessionSearch, sessions]);

    const hasConfiguredLlm = Boolean(provider && model);
    const activeRun = runsForActiveSession.find((run) => liveStatuses.has(run.status)) ?? null;
    const brokerChatStatus: ChatStatus = activeRun || isSubmitting ? "streaming" : "ready";
    const brokerMessages = useMemo(
        () =>
            buildBrokerMessages({
                eventsByRun,
                includeReasoning,
                includeToolOutputs,
                runs: runsForActiveSession,
                streamingIds
            }),
        [eventsByRun, includeReasoning, includeToolOutputs, runsForActiveSession, streamingIds]
    );
    const activeLiveRunIdsKey = useMemo(
        () => runsForActiveSession.filter((run) => liveStatuses.has(run.status)).map((run) => run.id).join("|"),
        [runsForActiveSession]
    );
    const configPayload = useMemo<BrokerChatConfigPayload | null>(() => {
        if (!provider || !model) {
            return null;
        }
        return {
            default_provider: provider,
            default_model: model,
            event_visibility: BROKER_CHAT_EVENT_VISIBILITY,
            include_tool_outputs: includeToolOutputs,
            include_reasoning: includeReasoning,
            use_mcp: useMcp,
            mcp_server_ids: selectedMcpServerIds
        };
    }, [includeReasoning, includeToolOutputs, model, provider, selectedMcpServerIds, useMcp]);

    useEffect(() => {
        const requestId = ++configSaveRequestRef.current;
        if (!configPayload) {
            return;
        }
        const nextConfigKey = brokerChatConfigKey(configPayload);
        if (nextConfigKey === savedConfigKeyRef.current) {
            return;
        }
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
            }
        }, 600);
        return () => {
            window.clearTimeout(timeout);
        };
    }, [configPayload]);

    const streamRun = useCallback(
        async (runId: string, afterSequence = 0) => {
            if (!user?.id) {
                return;
            }
            const existingController = streamControllersRef.current[runId];
            if (existingController && !existingController.signal.aborted) {
                return;
            }
            if (existingController?.signal.aborted) {
                delete streamControllersRef.current[runId];
            }
            const controller = new AbortController();
            streamControllersRef.current[runId] = controller;
            setStreamingIds((current) => (current.includes(runId) ? current : [...current, runId]));
            let latestSequence = afterSequence;
            let reconnectAfterClose = false;
            const params = new URLSearchParams({
                after_sequence: String(afterSequence),
                visibility: BROKER_CHAT_EVENT_VISIBILITY,
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
                            latestSequence = Number.isFinite(sequence) ? Math.max(latestSequence, sequence) : latestSequence;
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
                    reconnectAfterClose = liveStatuses.has(freshRun.status) && !controller.signal.aborted;
                }
            } catch (err) {
                if ((err as Error).name !== "AbortError") {
                    setError((err as Error).message || "Broker chat stream stopped.");
                    const freshRun = await getBrokerChatRun(runId).catch(() => null);
                    if (freshRun) {
                        setRuns((current) => mergeRuns(current, [freshRun]));
                        reconnectAfterClose = liveStatuses.has(freshRun.status);
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
        [includeReasoning, includeToolOutputs, user?.id]
    );

    const loadRunEvents = useCallback(
        async (runId: string) => {
            const page = await getBrokerChatEvents(runId, {
                limit: 500,
                visibility: BROKER_CHAT_EVENT_VISIBILITY,
                includeToolOutputs,
                includeReasoning
            });
            setRuns((current) => mergeRuns(current, [page.run]));
            setEventsByRun((current) => ({
                ...current,
                [runId]: mergeEvents(current[runId] ?? [], page.events)
            }));
            if (liveStatuses.has(page.run.status)) {
                const lastSequence = page.events.at(-1)?.sequence ?? 0;
                void streamRun(runId, lastSequence);
            }
        },
        [includeReasoning, includeToolOutputs, streamRun]
    );

    useEffect(() => {
        if (!activeSessionId) {
            return;
        }
        if (loadedSessionIdRef.current === activeSessionId) {
            return;
        }
        loadedSessionIdRef.current = activeSessionId;
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
        runsRef.current = runs;
    }, [runs]);

    useEffect(() => {
        eventsByRunRef.current = eventsByRun;
    }, [eventsByRun]);

    useEffect(() => {
        for (const run of runs) {
            if (liveStatuses.has(run.status)) {
                const lastSequence = eventsByRun[run.id]?.at(-1)?.sequence ?? 0;
                void streamRun(run.id, lastSequence);
            }
        }
    }, [eventsByRun, runs, streamRun]);

    useEffect(() => {
        const nextKey = `${includeToolOutputs}:${includeReasoning}`;
        if (nextKey === streamDetailKeyRef.current) {
            return;
        }
        streamDetailKeyRef.current = nextKey;
        const liveRuns = runsRef.current.filter((run) => liveStatuses.has(run.status));
        for (const run of liveRuns) {
            streamControllersRef.current[run.id]?.abort();
        }
        window.setTimeout(() => {
            for (const run of liveRuns) {
                const lastSequence = eventsByRunRef.current[run.id]?.at(-1)?.sequence ?? 0;
                void streamRun(run.id, lastSequence);
            }
        }, 0);
    }, [includeReasoning, includeToolOutputs, streamRun]);

    useEffect(() => {
        const liveRuns = runsRef.current.filter(
            (run) => run.session_id === activeSessionId && liveStatuses.has(run.status)
        );
        if (!liveRuns.length) {
            return;
        }
        let cancelled = false;
        const pollLiveRuns = async () => {
            await Promise.all(
                liveRuns.map(async (run) => {
                    const afterSequence = eventsByRunRef.current[run.id]?.at(-1)?.sequence ?? 0;
                    const page = await getBrokerChatEvents(run.id, {
                        afterSequence,
                        limit: 100,
                        visibility: BROKER_CHAT_EVENT_VISIBILITY,
                        includeToolOutputs,
                        includeReasoning
                    }).catch(() => null);
                    if (!page || cancelled) {
                        return;
                    }
                    setRuns((current) => mergeRuns(current, [page.run]));
                    if (page.events.length) {
                        setEventsByRun((current) => ({
                            ...current,
                            [run.id]: mergeEvents(current[run.id] ?? [], page.events)
                        }));
                    }
                })
            );
        };
        const interval = window.setInterval(() => {
            void pollLiveRuns();
        }, 2500);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [activeLiveRunIdsKey, activeSessionId, includeReasoning, includeToolOutputs]);

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
            setRuns((current) => mergeRuns(current, [nextRun]));
            await loadRunEvents(activeRun.id);
        } catch (err) {
            setError((err as Error).message);
        }
    }

    async function deleteSession(sessionId: string) {
        if (!sessionId) return;
        setError(null);
        try {
            runs
                .filter((run) => run.session_id === sessionId)
                .forEach((run) => streamControllersRef.current[run.id]?.abort());
            await deleteBrokerChatSession(sessionId);
            const [nextSessions, nextRuns] = await Promise.all([
                getBrokerChatSessions(80),
                getBrokerChatRuns({ limit: 160 })
            ]);
            setSessions(sortSessions(nextSessions));
            setRuns(mergeRuns([], nextRuns));
            if (sessionId === activeSessionId) {
                setActiveSessionId(nextSessions[0]?.id ?? "");
            }
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

    async function sendMessage(nextMessage = message) {
        const trimmed = nextMessage.trim();
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
                event_visibility: BROKER_CHAT_EVENT_VISIBILITY,
                include_tool_outputs: includeToolOutputs,
                include_reasoning: includeReasoning,
                use_mcp: useMcp,
                mcp_server_ids: selectedMcpServerIds
            });
            setMessage("");
            setRuns((current) => mergeRuns(current, [result.run]));
            if (!activeSessionId) {
                setActiveSessionId(result.run.session_id);
            }
            void streamRun(result.run.id, 0);
            const nextSessions = await getBrokerChatSessions(80).catch(() => sessions);
            setSessions(sortSessions(nextSessions));
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    }

    const emptyState = !sessions.length && !runs.length;
    const starterPrompts = [
        "Summarize today's portfolio risk",
        "Show my available funds and margin",
        "Check broker connection health",
        "Get latest quotes for my watchlist"
    ];

    return (
        <section className="grid min-h-0 flex-1 gap-4 min-[1080px]:grid-cols-[284px_minmax(0,1fr)]">
            <Card className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                <CardHeader className="border-b border-border p-3">
                    <Button
                        className="h-10 w-full justify-start gap-2"
                        disabled={isCreatingSession}
                        onClick={createNewChat}
                        type="button"
                        variant="outline"
                    >
                        {isCreatingSession ? (
                            <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                        ) : (
                            <IconMessagePlus className="size-4" stroke={1.8} />
                        )}
                        New chat
                    </Button>
                    <Label className="relative mt-3 block">
                        <span className="sr-only">Search chats</span>
                        <IconSearch
                            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            stroke={1.8}
                        />
                        <Input
                            className="h-10 pl-9 text-sm"
                            onChange={(event) => setSessionSearch(event.target.value)}
                            placeholder="Search chats"
                            value={sessionSearch}
                        />
                    </Label>
                </CardHeader>

                <CardPanel className="min-h-0 overflow-y-auto p-2">
                    <div className="px-2 pb-2 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Recents
                    </div>
                    {emptyState ? (
                        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                            Start a chat to create the first broker data session.
                        </div>
                    ) : null}
                    {!emptyState && !filteredSessions.length ? (
                        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                            No chats match your search.
                        </div>
                    ) : null}
                    <div className="grid gap-1">
                        {filteredSessions.map((session) => {
                            const latestRun = latestRunBySession.get(session.id);
                            const active = session.id === activeSessionId;
                            const live = latestRun ? liveStatuses.has(latestRun.status) : false;
                            return (
                                <div
                                    className={cn(
                                        "group relative flex min-w-0 items-center gap-1 overflow-hidden rounded-lg border border-transparent transition",
                                        active
                                            ? "border-border bg-secondary"
                                            : "hover:border-border hover:bg-secondary/55",
                                        live ? "broker-chat-row-shimmer" : null
                                    )}
                                    key={session.id}
                                >
                                    <button
                                        className="relative z-10 min-w-0 flex-1 px-3 py-2 text-left"
                                        onClick={() => setActiveSessionId(session.id)}
                                        type="button"
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate text-sm font-semibold">{session.title}</span>
                                        </div>
                                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                            <span
                                                className={cn(
                                                    "size-1.5 shrink-0 rounded-full bg-muted-foreground/45",
                                                    live ? "bg-primary" : null,
                                                    latestRun?.status === "completed" ? "bg-[var(--success)]" : null,
                                                    latestRun?.status === "failed" ||
                                                        latestRun?.status === "cancelled"
                                                        ? "bg-destructive"
                                                        : null
                                                )}
                                            />
                                            <span className="min-w-0 truncate">{latestRun?.status ?? "empty"}</span>
                                            <span aria-hidden="true">·</span>
                                            <span className="shrink-0 whitespace-nowrap">
                                                {formatDate(session.updated_at)}
                                            </span>
                                        </div>
                                    </button>
                                    <button
                                        aria-label={`Delete ${session.title}`}
                                        className="relative z-10 mr-1 flex size-8 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void deleteSession(session.id);
                                        }}
                                        type="button"
                                    >
                                        <IconTrash className="size-3.5" stroke={1.8} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </CardPanel>
            </Card>

            <Card className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] [--an-border-radius:10px] [--an-input-background:var(--background)] [--an-input-border-radius:10px] [--an-max-width:760px] [--an-tool-border-radius:8px]">
                <CardHeader className="border-b border-border p-4">
                    <div className="flex flex-col gap-3 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
                        <div className="min-w-0">
                            <h2 className="truncate text-xl font-heading font-semibold tracking-tight">
                                {activeSession?.title ?? "New broker chat"}
                            </h2>
                        </div>
                        <div className="shrink-0 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                            {runsForActiveSession.length || "No"} run{runsForActiveSession.length === 1 ? "" : "s"}
                        </div>
                    </div>

                    {!configuredProviders.length ? (
                        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)] dark:text-[var(--accent)]">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            Configure and enable at least one LLM provider in Settings before sending broker chat messages.
                        </div>
                    ) : null}
                    {error ? (
                        <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            {error}
                        </div>
                    ) : null}
                    {configError ? (
                        <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            {configError}
                        </div>
                    ) : null}
                    {queueHealth && !queueHealth.has_processing_path ? (
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)] dark:text-[var(--accent)]">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            Broker chat jobs are queued, but no RQ worker or in-process worker is currently available.
                        </div>
                    ) : null}
                </CardHeader>

                <CardPanel className="relative min-h-0 overflow-hidden p-0">
                    {!runsForActiveSession.length ? (
                        <div className="flex h-full min-h-0 items-center justify-center px-4 py-10 text-center">
                            <div className="w-full max-w-2xl">
                                <span className="mx-auto flex size-11 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
                                    <IconTerminal2 className="size-5" stroke={1.8} />
                                </span>
                                <p className="mt-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                                    Broker data assistant
                                </p>
                                <h3 className="mt-2 text-2xl font-heading font-semibold tracking-tight">
                                    Ask a market or portfolio question
                                </h3>
                                <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                                    Use your connected broker data for holdings, positions, quotes, option chains, and
                                    account health.
                                </p>
                                <div className="mx-auto mt-6 grid max-w-xl gap-2 min-[640px]:grid-cols-2">
                                    {starterPrompts.map((prompt) => (
                                        <button
                                            className="rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm font-semibold text-foreground transition hover:border-primary hover:bg-[var(--accent-glow)] hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                            disabled={!hasConfiguredLlm || isSubmitting || Boolean(activeRun)}
                                            key={prompt}
                                            onClick={() => {
                                                void sendMessage(prompt);
                                            }}
                                            type="button"
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <MessageList
                            className="h-full"
                            messages={brokerMessages}
                            showCopyToolbar
                            status={brokerChatStatus}
                        />
                    )}
                </CardPanel>

                <CardFooter className="border-t border-border bg-secondary/20 px-4 pb-3 pt-4">
                    <div className="mx-auto w-full max-w-[760px]">
                        <div className="rounded-lg border border-border/80 bg-background">
                            <InputBar
                                className="px-0 pb-0"
                                disabled={!hasConfiguredLlm || isSubmitting || Boolean(activeRun)}
                                leftActions={
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <SimpleSelect
                                            aria-label="Broker chat provider"
                                            className="h-7 w-[128px] bg-background px-2 text-xs"
                                            disabled={!configuredProviders.length}
                                            onValueChange={(nextProvider) => setProvider(nextProvider as LlmProvider)}
                                            options={configuredProviders.map((item) => ({
                                                value: item.provider,
                                                label: providerName(item)
                                            }))}
                                            placeholder="Provider"
                                            size="sm"
                                            value={provider}
                                        />
                                        <SimpleSelect
                                            aria-label="Broker chat model"
                                            className="h-7 w-[min(280px,42vw)] bg-background px-2 text-xs"
                                            disabled={!provider || !selectedModels.length}
                                            onValueChange={setModel}
                                            options={selectedModels.map((item) => ({
                                                value: item.model_id,
                                                label: item.label || item.model_id
                                            }))}
                                            placeholder={provider ? "Model" : "Select provider"}
                                            size="sm"
                                            value={model}
                                        />
                                    </div>
                                }
                                onChange={setMessage}
                                onSend={({ content }) => {
                                    void sendMessage(content);
                                }}
                                onStop={() => {
                                    void stopActiveRun();
                                }}
                                placeholder="Ask about holdings, positions, quotes, option chains, or broker health."
                                rightActions={
                                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                        <ComposerToggle
                                            checked={includeToolOutputs}
                                            icon={IconTool}
                                            label="Tools"
                                            onChange={setIncludeToolOutputs}
                                            title="Show broker tool calls and outputs"
                                        />
                                        <ComposerToggle
                                            checked={includeReasoning}
                                            icon={IconTerminal2}
                                            label="Reasoning"
                                            onChange={setIncludeReasoning}
                                            title="Show model reasoning when the provider returns it"
                                        />
                                        <ComposerToggle
                                            checked={useMcp}
                                            disabled={!availableMcpServers.length}
                                            icon={IconPlugConnected}
                                            label="MCP"
                                            onChange={setUseMcp}
                                            title="Use configured MCP servers for broker chat"
                                        />
                                    </div>
                                }
                                status={brokerChatStatus}
                                suggestions={
                                    runsForActiveSession.length
                                        ? []
                                        : starterPrompts.map((prompt) => ({ id: prompt, label: prompt, value: prompt }))
                                }
                                value={message}
                            />
                            {useMcp && availableMcpServers.length > 1 ? (
                                <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-3 py-2">
                                    {availableMcpServers.map((server) => {
                                        const serverId = server.id as string;
                                        return (
                                            <Label
                                                className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-semibold uppercase text-muted-foreground"
                                                key={serverId}
                                            >
                                                <Checkbox
                                                    checked={selectedMcpServerIds.includes(serverId)}
                                                    onCheckedChange={(value) =>
                                                        setSelectedMcpServerIds((current) => {
                                                            const next = value
                                                                ? Array.from(new Set([...current, serverId]))
                                                                : current.filter((id) => id !== serverId);
                                                            return next.length ? next : [serverId];
                                                        })
                                                    }
                                                />
                                                {server.name || server.url}
                                            </Label>
                                        );
                                    })}
                                </div>
                            ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <IconCircleCheck className="size-3.5" stroke={1.8} />
                                Saved credentials
                            </span>
                            <span>Enter sends. Shift + Enter adds a line.</span>
                        </div>
                    </div>
                </CardFooter>
            </Card>
        </section>
    );
}
