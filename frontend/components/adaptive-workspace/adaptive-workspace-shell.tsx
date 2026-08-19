"use client";

import { useCallback, useEffect, useRef } from "react";
import {
    IconAlertTriangle,
    IconChevronRight,
    IconLayoutDashboard,
    IconLoader2,
    IconPlugConnected
} from "@tabler/icons-react";
import { AdaptiveCanvasBoard } from "@/components/adaptive-workspace/canvas-board";
import { AdaptiveDeskPrefsProvider } from "@/components/adaptive-workspace/desk-prefs";
import { adaptiveBrokerToolRenderers } from "@/components/adaptive-workspace/broker-tool-renderers";
import { AdaptiveDeskSwitcher } from "@/components/adaptive-workspace/desk-switcher";
import { AdaptiveWorkspaceProvider, useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { InputBar } from "@/components/agent-elements/input-bar";
import { MessageList } from "@/components/agent-elements/message-list";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardPanel } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useAdaptiveWorkspaceChat } from "@/hooks/use-adaptive-workspace-chat";
import { useAdaptiveWorkspaceLayout } from "@/hooks/use-adaptive-workspace-layout";
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
    "Compose a desk with my last watchlist, its news, live price movements, and alerts",
    "Apply the investor template",
    "Compose a morning brief desk",
    "Compose a desk with my holdings and broker health"
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
    const { applySpec, bindSession, ingestMessageOutputs } = canvas;
    const layout = useAdaptiveWorkspaceLayout();
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
            ingestMessageOutputs(chat.messages);
            return;
        }
        if (latest && !seenSurfaceKeysRef.current.has(latest.key)) {
            seenSurfaceKeysRef.current.add(latest.key);
            applySpec(latest.spec, "agent");
        }
        ingestMessageOutputs(chat.messages);
    }, [applySpec, chat.activeSessionId, chat.messages, ingestMessageOutputs]);

    useEffect(() => {
        ingestMessageOutputs(chat.messages);
    }, [canvas.spec, chat.messages, ingestMessageOutputs]);

    const selectedLabel = canvas.spec.components.find((item) => item.id === canvas.selectedId)?.type;
    const deskTitle = chat.activeSession?.title ?? canvas.spec.title ?? "Adaptive workspace";

    return (
        <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden min-[980px]:flex-row">
            <Card className="grid min-h-0 min-w-0 flex-1 overflow-hidden grid-rows-[minmax(0,1fr)]">
                <AdaptiveCanvasBoard
                    onPrompt={(prompt) => {
                        layout.setInspectorOpen(true);
                        void chat.sendMessage(prompt);
                    }}
                    starterPrompts={STARTER_PROMPTS}
                />
            </Card>

            {layout.inspectorOpen ? (
                <>
                    <button
                        aria-label="Resize inspector"
                        className="hidden h-full w-1.5 shrink-0 cursor-col-resize bg-border/70 hover:bg-primary min-[980px]:block"
                        onPointerDown={layout.onResizePointerDown}
                        type="button"
                    />
                    <Card
                        className="grid min-h-0 h-[min(42vh,28rem)] w-full shrink-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto] min-[980px]:h-auto min-[980px]:w-[var(--adaptive-inspector-width)] [--an-border-radius:10px] [--an-input-background:var(--background)] [--an-input-border-radius:10px] [--an-max-width:760px] [--an-tool-border-radius:8px]"
                        style={{ ["--adaptive-inspector-width" as string]: `${layout.inspectorWidth}px` }}
                    >
                        <CardHeader className="border-b border-border p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                                        Inspector
                                    </p>
                                    <div className="mt-2 min-w-0">
                                        <AdaptiveDeskSwitcher
                                            creating={chat.isCreatingSession}
                                            onCreate={() => void chat.createNewChat()}
                                            onDelete={(sessionId) => void chat.deleteSession(sessionId)}
                                            onSelect={chat.setActiveSessionId}
                                            sessions={chat.sessions}
                                            title={deskTitle}
                                        />
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Chat authors the canvas. History lives in this desk switcher.
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    {chat.isCreatingSession ? (
                                        <IconLoader2 className="size-4 animate-spin text-muted-foreground" stroke={1.8} />
                                    ) : (
                                        <IconLayoutDashboard className="size-5 text-muted-foreground" stroke={1.8} />
                                    )}
                                    <Button onClick={() => layout.setInspectorOpen(false)} size="xs" type="button" variant="ghost">
                                        Hide
                                    </Button>
                                </div>
                            </div>
                            {!chat.configuredProviders.length ? (
                                <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)]">
                                    <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                                    Configure and enable at least one LLM provider in Settings before using this preview.
                                </div>
                            ) : null}
                            {chat.error ? (
                                <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
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
                                    Scoped to <span className="font-semibold">{selectedLabel}</span> ({canvas.selectedId}).
                                    Follow-ups can change this widget.
                                </p>
                            ) : null}
                        </CardHeader>
                        <CardPanel className="relative min-h-0 overflow-hidden p-0">
                            {!chat.messages.length ? (
                                <div className="flex h-full min-h-0 items-center justify-center px-4 py-10 text-center">
                                    <div className="w-full max-w-sm">
                                        <h3 className="text-lg font-heading font-semibold tracking-tight">Ask, then compose</h3>
                                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                            Watchlists, quotes, market intelligence, and alerts can all land on the canvas.
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
                        <CardFooter className="border-t border-border bg-secondary/20 px-3 pb-3 pt-3">
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
                </>
            ) : (
                <Button
                    className="h-full min-h-[160px] w-10 shrink-0 flex-col gap-2 px-0"
                    onClick={() => layout.setInspectorOpen(true)}
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
            <AdaptiveDeskPrefsProvider>
                <AdaptiveWorkspaceShellInner {...props} />
            </AdaptiveDeskPrefsProvider>
        </AdaptiveWorkspaceProvider>
    );
}
