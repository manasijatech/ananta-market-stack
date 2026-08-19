"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    IconAlertTriangle,
    IconChevronRight,
    IconLayoutDashboard,
    IconLoader2,
    IconMessagePlus,
    IconPlugConnected,
    IconTrash
} from "@tabler/icons-react";
import { AdaptiveCanvasBoard } from "@/components/adaptive-workspace/canvas-board";
import { adaptiveBrokerToolRenderers } from "@/components/adaptive-workspace/broker-tool-renderers";
import { AdaptiveWorkspaceProvider, useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { InputBar } from "@/components/agent-elements/input-bar";
import { MessageList } from "@/components/agent-elements/message-list";
import { formatDate } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardPanel } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useAdaptiveWorkspaceChat } from "@/hooks/use-adaptive-workspace-chat";
import { latestSurfaceSpecFromMessages } from "@/lib/adaptive-workspace/spec";
import { cn } from "@/lib/utils";
import type { OpenRouterModel } from "@/service/actions/llm-models";
import type { LlmProvider, LlmProviderConfig, McpServerConfig } from "@/service/types/broker";
import type { BrokerChatPreference, BrokerChatRun, BrokerChatSession } from "@/service/types/broker-chat";

type Props = {
    initialConfig: BrokerChatPreference;
    initialRuns: BrokerChatRun[];
    initialSessions: BrokerChatSession[];
    llmProviders: LlmProviderConfig[];
    mcpServer: McpServerConfig;
    mcpServers: McpServerConfig[];
    openRouterModels: OpenRouterModel[];
};

const STARTER_PROMPTS = [
    "Compose a desk with my holdings and broker health",
    "Show my holdings and available funds",
    "Check broker connection health",
    "Get latest quotes for my largest holdings"
];

function AdaptiveWorkspaceShellInner({
    initialConfig,
    initialRuns,
    initialSessions,
    llmProviders,
    mcpServer,
    mcpServers
}: Props) {
    const canvas = useAdaptiveWorkspace();
    const { applySpec, bindSession } = canvas;
    const getRunMetadata = useCallback(
        () => ({
            selected_component_id: canvas.selectedId,
            workspace_spec: canvas.spec
        }),
        [canvas.selectedId, canvas.spec]
    );
    const chat = useAdaptiveWorkspaceChat({
        getRunMetadata,
        initialRuns,
        initialSessions,
        llmProviders,
        mcpServer,
        mcpServers,
        preference: initialConfig
    });
    const [chatOpen, setChatOpen] = useState(true);
    const seenSurfaceKeysRef = useRef<Set<string>>(new Set());
    const hydratedSessionRef = useRef<string | null>(null);

    useEffect(() => {
        bindSession(chat.activeSessionId || null);
        seenSurfaceKeysRef.current = new Set();
        hydratedSessionRef.current = null;
    }, [bindSession, chat.activeSessionId]);

    useEffect(() => {
        const latest = latestSurfaceSpecFromMessages(chat.messages);
        if (hydratedSessionRef.current !== chat.activeSessionId) {
            if (latest) seenSurfaceKeysRef.current.add(latest.key);
            hydratedSessionRef.current = chat.activeSessionId;
            return;
        }
        if (!latest || seenSurfaceKeysRef.current.has(latest.key)) return;
        seenSurfaceKeysRef.current.add(latest.key);
        applySpec(latest.spec, "agent");
    }, [applySpec, chat.activeSessionId, chat.messages]);

    const selectedLabel = canvas.spec.components.find((item) => item.id === canvas.selectedId)?.type;

    return (
        <section
            className={cn(
                "grid h-full min-h-0 flex-1 gap-4 overflow-hidden",
                chatOpen
                    ? "grid-rows-[minmax(8.5rem,10.5rem)_minmax(0,1fr)_minmax(16rem,42vh)] min-[1280px]:grid-rows-none min-[1280px]:grid-cols-[220px_minmax(0,1fr)_minmax(320px,400px)]"
                    : "grid-rows-[minmax(8.5rem,10.5rem)_minmax(0,1fr)_auto] min-[1280px]:grid-rows-none min-[1280px]:grid-cols-[220px_minmax(0,1fr)_auto]"
            )}
        >
            <Card className="grid min-h-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)]">
                <CardHeader className="border-b border-border p-3">
                    <Button
                        className="h-10 w-full justify-start gap-2"
                        disabled={chat.isCreatingSession}
                        onClick={() => void chat.createNewChat()}
                        type="button"
                        variant="outline"
                    >
                        {chat.isCreatingSession ? (
                            <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                        ) : (
                            <IconMessagePlus className="size-4" stroke={1.8} />
                        )}
                        New desk
                    </Button>
                </CardHeader>
                <CardPanel className="min-h-0 overflow-y-auto p-2">
                    <div className="px-2 pb-2 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Conversations
                    </div>
                    {!chat.sessions.length ? (
                        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                            Start a desk conversation. Broker Chat stays unchanged at /broker-chat.
                        </div>
                    ) : (
                        <div className="grid gap-1">
                            {chat.sessions.map((session) => {
                                const active = session.id === chat.activeSessionId;
                                return (
                                    <div
                                        className={cn(
                                            "group relative flex min-w-0 items-center gap-1 overflow-hidden rounded-lg border border-transparent",
                                            active ? "border-border bg-secondary" : "hover:border-border hover:bg-secondary/55"
                                        )}
                                        key={session.id}
                                    >
                                        <button
                                            className="relative z-10 min-w-0 flex-1 px-3 py-2 text-left"
                                            onClick={() => chat.setActiveSessionId(session.id)}
                                            type="button"
                                        >
                                            <span className="block truncate text-sm font-semibold">{session.title}</span>
                                            <span className="mt-1 block text-xs text-muted-foreground">{formatDate(session.updated_at)}</span>
                                        </button>
                                        <button
                                            aria-label={`Delete ${session.title}`}
                                            className="relative z-10 mr-1 flex size-8 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void chat.deleteSession(session.id);
                                            }}
                                            type="button"
                                        >
                                            <IconTrash className="size-3.5" stroke={1.8} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardPanel>
            </Card>

            <Card className="grid min-h-0 overflow-hidden grid-rows-[minmax(0,1fr)]">
                <AdaptiveCanvasBoard
                    onPrompt={(prompt) => {
                        setChatOpen(true);
                        void chat.sendMessage(prompt);
                    }}
                    starterPrompts={STARTER_PROMPTS}
                />
            </Card>

            {chatOpen ? (
                <Card className="grid min-h-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto] [--an-border-radius:10px] [--an-input-background:var(--background)] [--an-input-border-radius:10px] [--an-max-width:760px] [--an-tool-border-radius:8px]">
                    <CardHeader className="border-b border-border p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Inspector</p>
                                <h2 className="mt-1 truncate text-lg font-heading font-semibold tracking-tight">
                                    {chat.activeSession?.title ?? "Adaptive workspace"}
                                </h2>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Chat authors the canvas. Existing Broker Chat is unchanged.
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <IconLayoutDashboard className="size-5 text-muted-foreground" stroke={1.8} />
                                <Button onClick={() => setChatOpen(false)} size="xs" type="button" variant="ghost">
                                    Hide
                                </Button>
                            </div>
                        </div>
                        {!chat.configuredProviders.length ? (
                            <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)]">
                                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                                Configure and enable at least one LLM provider in Settings before using this preview.
                            </div>
                        ) : null}
                        {chat.error ? (
                            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                                {chat.error}
                            </div>
                        ) : null}
                        {chat.queueHealth && !chat.queueHealth.has_processing_path ? (
                            <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)]">
                                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                                Broker chat jobs are queued, but no worker is currently available.
                            </div>
                        ) : null}
                        {selectedLabel ? (
                            <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs text-primary">
                                Scoped to <span className="font-semibold">{selectedLabel}</span> ({canvas.selectedId}). Follow-ups can change this widget.
                            </p>
                        ) : null}
                    </CardHeader>
                    <CardPanel className="relative min-h-0 overflow-hidden p-0">
                        {!chat.messages.length ? (
                            <div className="flex h-full min-h-0 items-center justify-center px-4 py-10 text-center">
                                <div className="w-full max-w-sm">
                                    <h3 className="text-lg font-heading font-semibold tracking-tight">Ask, then compose</h3>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                        The agent can pin data cards and emit a WorkspaceSpec onto the canvas.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <MessageList
                                className="h-full min-h-0"
                                messages={chat.messages}
                                showCopyToolbar
                                status={chat.chatStatus}
                                toolRenderers={adaptiveBrokerToolRenderers}
                            />
                        )}
                    </CardPanel>
                    <CardFooter className="border-t border-border bg-secondary/20 px-4 pb-3 pt-4">
                        <div className="mx-auto w-full">
                            <div className="rounded-lg border border-border/80 bg-background">
                                <InputBar
                                    className="px-0 pb-0"
                                    disabled={!chat.hasConfiguredLlm || chat.isSubmitting || Boolean(chat.activeRun)}
                                    leftActions={
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                            <SimpleSelect
                                                aria-label="Adaptive workspace provider"
                                                className="h-7 w-[110px] bg-background px-2 text-xs"
                                                disabled={!chat.configuredProviders.length}
                                                onValueChange={(nextProvider) => chat.setProvider(nextProvider as LlmProvider)}
                                                options={chat.configuredProviders.map((item) => ({
                                                    label: item.label || item.provider,
                                                    value: item.provider
                                                }))}
                                                placeholder="Provider"
                                                size="sm"
                                                value={chat.provider}
                                            />
                                            <SimpleSelect
                                                aria-label="Adaptive workspace model"
                                                className="h-7 w-[min(220px,36vw)] bg-background px-2 text-xs"
                                                disabled={!chat.provider || !chat.selectedModels.length}
                                                onValueChange={chat.setModel}
                                                options={chat.selectedModels.map((item) => ({
                                                    label: item.label || item.model_id,
                                                    value: item.model_id
                                                }))}
                                                placeholder={chat.provider ? "Model" : "Select provider"}
                                                size="sm"
                                                value={chat.model}
                                            />
                                        </div>
                                    }
                                    onChange={chat.setMessage}
                                    onSend={({ content }) => void chat.sendMessage(content)}
                                    onStop={() => void chat.stopActiveRun()}
                                    placeholder={
                                        canvas.selectedId
                                            ? `Change this ${selectedLabel ?? "widget"}…`
                                            : "Ask to compose a desk, or change the selected widget."
                                    }
                                    rightActions={
                                        chat.availableMcpServers.length ? (
                                            <button
                                                aria-pressed={chat.useMcp}
                                                className={cn(
                                                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold uppercase",
                                                    chat.useMcp
                                                        ? "border-primary/40 bg-primary/10 text-primary"
                                                        : "border-border bg-background text-muted-foreground"
                                                )}
                                                onClick={() => chat.setUseMcp(!chat.useMcp)}
                                                type="button"
                                            >
                                                <IconPlugConnected className="size-3.5" stroke={1.8} />
                                                MCP
                                            </button>
                                        ) : null
                                    }
                                    status={chat.chatStatus}
                                    value={chat.message}
                                />
                                {chat.useMcp && chat.availableMcpServers.length > 1 ? (
                                    <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-3 py-2">
                                        {chat.availableMcpServers.map((server) => {
                                            const serverId = server.id as string;
                                            return (
                                                <Label
                                                    className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-semibold uppercase text-muted-foreground"
                                                    key={serverId}
                                                >
                                                    <Checkbox
                                                        checked={chat.selectedMcpServerIds.includes(serverId)}
                                                        onCheckedChange={(value) =>
                                                            chat.setSelectedMcpServerIds((current) => {
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
                        </div>
                    </CardFooter>
                </Card>
            ) : (
                <Button
                    className="h-full min-h-[160px] w-10 flex-col gap-2 px-0"
                    onClick={() => setChatOpen(true)}
                    type="button"
                    variant="outline"
                >
                    <IconChevronRight className="size-4 rotate-180" stroke={1.8} />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ writingMode: "vertical-rl" }}>
                        Chat
                    </span>
                </Button>
            )}
        </section>
    );
}

export function AdaptiveWorkspaceShell(props: Props) {
    return (
        <AdaptiveWorkspaceProvider>
            <AdaptiveWorkspaceShellInner {...props} />
        </AdaptiveWorkspaceProvider>
    );
}
