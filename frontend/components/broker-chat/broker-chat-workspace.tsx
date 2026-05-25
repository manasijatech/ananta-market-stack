"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    IconAlertTriangle,
    IconArrowDown,
    IconArrowRight,
    IconChevronDown,
    IconCircleCheck,
    IconPlayerStop,
    IconLoader2,
    IconMessagePlus,
    IconSearch,
    IconTerminal2,
    IconTrash
} from "@tabler/icons-react";
import { formatDate } from "@/components/brokers/ui";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { Textarea } from "@/components/ui/textarea";
import { useChatAutoScroll } from "@/hooks/use-chat-auto-scroll";
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
    mcpServers: McpServerConfig[];
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

type ReasoningStep = {
    key: string;
    event: BrokerChatEvent;
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

function formatPayload(value: unknown) {
    if (value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    return JSON.stringify(value, null, 2);
}

function textFromNode(node: ReactNode): string {
    if (typeof node === "string" || typeof node === "number") {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(textFromNode).join("");
    }
    if (node && typeof node === "object" && "props" in node) {
        const props = node.props as { children?: ReactNode };
        return textFromNode(props.children);
    }
    return "";
}

function splitTableLine(line: string) {
    return line
        .trim()
        .split(/\s{2,}/)
        .map((cell) => cell.trim())
        .filter(Boolean);
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

function normalizeHeaderCells(cells: string[], targetCount: number) {
    const normalized = cells.flatMap((cell) => {
        if (/^Day ChangeDay Change \(%\)$/i.test(cell)) {
            return ["Day Change", "Day Change (%)"];
        }
        if (/^Day ChangeDay Change/i.test(cell)) {
            return ["Day Change", cell.replace(/^Day Change/i, "").trim() || "Day Change (%)"];
        }
        return [cell];
    });
    while (normalized.length < targetCount) {
        normalized.push(`Value ${normalized.length + 1}`);
    }
    return normalized.slice(0, targetCount);
}

function parseMarketQuoteRow(line: string) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    const symbol = tokens[0] ?? "";
    if (!symbol) {
        return [];
    }
    const rest = tokens.slice(1);
    const numericTokens = rest.filter(isNumericText);
    if (numericTokens.length >= 3) {
        const [ltp, dayChange, dayChangePercent] = numericTokens.slice(-3);
        return [symbol, ltp, dayChange, dayChangePercent];
    }
    return [symbol, rest.join(" "), "", ""];
}

function parsePlainTextTable(value: string) {
    const lines = value
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim());
    if (lines.length < 3) {
        return null;
    }

    const headerCells = splitTableLine(lines[0]);
    const knownMarketTable = isMarketQuoteHeader(lines[0]);
    const bodyRows = knownMarketTable ? lines.slice(1).map(parseMarketQuoteRow) : lines.slice(1).map(splitTableLine);
    const maxColumns = Math.max(headerCells.length, ...bodyRows.map((row) => row.length));
    const tableLikeRows = bodyRows.filter((row) => row.length >= 2).length;

    if (maxColumns < 2 || (!knownMarketTable && tableLikeRows < 2)) {
        return null;
    }

    return {
        headers: knownMarketTable
            ? ["Symbol", "Last Traded Price (LTP)", "Day Change", "Day Change (%)"]
            : normalizeHeaderCells(headerCells, maxColumns),
        rows: bodyRows.filter((row) => row.length)
    };
}

function isNumericTableCell(value: ReactNode) {
    return isNumericText(textFromNode(value));
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

function tableColumnWidth(index: number, total: number) {
    if (index === 0) {
        return "16%";
    }
    if (total === 2) {
        return "84%";
    }
    if (index === 1) {
        return "30%";
    }
    return `${54 / Math.max(total - 2, 1)}%`;
}

function detailModeLabel(visibility: BrokerChatVisibility) {
    if (visibility === "tool_calls") {
        return "Tool calls";
    }
    if (visibility === "full") {
        return "Full";
    }
    return "Minimal";
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

function groupReasoningSteps(events: BrokerChatEvent[]): ReasoningStep[] {
    return events
        .filter((event) => event.event_type === "reasoning")
        .map((event) => ({
            key: `${event.run_id}:reasoning:${event.sequence}`,
            event
        }));
}

function ToolDetailBlock({ label, value }: { label: string; value: unknown }) {
    if (value === undefined) {
        return null;
    }
    const formatted = formatPayload(value);
    if (!formatted) {
        return null;
    }
    return (
        <div className="grid gap-1">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {label}
            </div>
            <pre className="max-h-72 overflow-auto border border-border bg-secondary/50 p-3 font-mono text-[11px] leading-5 text-foreground">
                {formatted}
            </pre>
        </div>
    );
}

function ToolStepDetails({ step, visibility }: { step: ToolStep; visibility: BrokerChatVisibility }) {
    const startPayload = step.start?.payload;
    const outputPayload = step.output?.payload;
    const argumentsPayload = payloadValue(startPayload, "arguments");
    const output = payloadValue(outputPayload, "output");
    const outputMetadata = payloadValue(outputPayload, "output_metadata");
    const startRawItem = payloadValue(startPayload, "raw_item");
    const outputRawItem = payloadValue(outputPayload, "raw_item");
    const outputFallback = output === undefined ? outputMetadata : output;

    return (
        <div className="ml-5 mt-1 grid max-w-5xl gap-3 border-l border-border px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span>{detailModeLabel(visibility)} backend payload</span>
                {step.callId ? <span>Call {step.callId}</span> : null}
            </div>
            <ToolDetailBlock label="Arguments" value={argumentsPayload} />
            <ToolDetailBlock label={output === undefined ? "Output metadata" : "Output"} value={outputFallback} />
            <ToolDetailBlock label="Started event payload" value={startPayload} />
            <ToolDetailBlock label="Completed event payload" value={outputPayload} />
            <ToolDetailBlock label="Started raw item" value={startRawItem} />
            <ToolDetailBlock label="Completed raw item" value={outputRawItem} />
        </div>
    );
}

function ToolStepRow({
    isRunActive,
    step,
    visibility
}: {
    isRunActive: boolean;
    step: ToolStep;
    visibility: BrokerChatVisibility;
}) {
    const [open, setOpen] = useState(false);
    const action = step.output ? "Checked" : "Calling";
    const toolName = step.toolName.replace(/^broker_/, "").replace(/_/g, " ");
    const text = `${action} ${toolName}`;
    const showShimmer = isRunActive && !step.output;

    return (
        <div className="grid gap-1 px-1 py-1.5 text-sm">
            <div className="flex min-w-0 items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
                {showShimmer ? (
                    <ShimmeringText
                        className="min-w-0 font-medium"
                        color="var(--text-muted)"
                        shimmerColor="var(--accent)"
                        text={text}
                    />
                ) : (
                    <span className="min-w-0 font-medium text-muted-foreground">{text}</span>
                )}
                <button
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} ${toolName} tool details`}
                    className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition hover:bg-[var(--accent-glow)] hover:text-primary"
                    onClick={() => setOpen((current) => !current)}
                    title={`${open ? "Hide" : "Show"} tool details`}
                    type="button"
                >
                    <IconChevronDown
                        className={cn("size-4 transition-transform", open ? "rotate-180" : null)}
                        stroke={1.8}
                    />
                </button>
            </div>
            {open ? <ToolStepDetails step={step} visibility={visibility} /> : null}
        </div>
    );
}

function ReasoningStepDetails({ step, visibility }: { step: ReasoningStep; visibility: BrokerChatVisibility }) {
    const payload = step.event.payload;
    const rawType = payloadValue(payload, "raw_type");
    const raw = payloadValue(payload, "raw");
    const message = payloadValue(payload, "message");

    return (
        <div className="ml-5 mt-1 grid max-w-5xl gap-3 border-l border-border px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span>{detailModeLabel(visibility)} backend payload</span>
                {typeof rawType === "string" ? <span>{rawType}</span> : null}
            </div>
            <ToolDetailBlock label="Reasoning raw" value={raw} />
            <ToolDetailBlock label="Reasoning message" value={message} />
            <ToolDetailBlock label="Reasoning event payload" value={payload} />
        </div>
    );
}

function ReasoningStepRow({
    includeReasoning,
    isRunActive,
    step,
    visibility
}: {
    includeReasoning: boolean;
    isRunActive: boolean;
    step: ReasoningStep;
    visibility: BrokerChatVisibility;
}) {
    const [open, setOpen] = useState(false);
    const rawType = textPayload(step.event.payload, "raw_type");
    const label = rawType ? `Reasoning ${rawType}` : "Reasoning event received";

    return (
        <div className="grid gap-1 px-1 py-1.5 text-sm">
            <div className="flex min-w-0 items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
                {isRunActive ? (
                    <ShimmeringText
                        className="min-w-0 font-medium"
                        color="var(--text-muted)"
                        shimmerColor="var(--accent)"
                        text={label}
                    />
                ) : (
                    <span className="min-w-0 font-medium text-muted-foreground">{label}</span>
                )}
                <button
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} reasoning details`}
                    className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition hover:bg-[var(--accent-glow)] hover:text-primary"
                    onClick={() => setOpen((current) => !current)}
                    title={`${open ? "Hide" : "Show"} reasoning details`}
                    type="button"
                >
                    <IconChevronDown
                        className={cn("size-4 transition-transform", open ? "rotate-180" : null)}
                        stroke={1.8}
                    />
                </button>
                {!includeReasoning ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        Hidden
                    </span>
                ) : null}
            </div>
            {open ? <ReasoningStepDetails step={step} visibility={visibility} /> : null}
        </div>
    );
}

function MarkdownTable({ children }: { children: ReactNode }) {
    return (
        <div className="my-4 max-w-full overflow-x-auto border border-border bg-card shadow-sm last:mb-0">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px] leading-5">
                {children}
            </table>
        </div>
    );
}

function MarkdownTableHead({ children }: { children: ReactNode }) {
    return (
        <th className="border-b border-border bg-secondary px-3 py-2.5 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:pl-4 first:text-left last:pr-4">
            {children}
        </th>
    );
}

function MarkdownTableCell({ children }: { children: ReactNode }) {
    return (
        <td
            className={cn(
                "border-b border-border/70 px-3 py-2.5 align-top text-foreground first:pl-4 last:pr-4",
                isNumericTableCell(children) ? "whitespace-nowrap text-center font-mono tabular-nums" : null
            )}
        >
            {children}
        </td>
    );
}

function PlainTextTable({ source }: { source: string }) {
    const table = parsePlainTextTable(source);
    if (!table) {
        return (
            <pre className="mb-3 max-w-full overflow-auto border border-border bg-secondary/60 p-3 text-xs leading-5 last:mb-0">
                {source}
            </pre>
        );
    }

    return (
        <div className="my-4 max-w-full overflow-x-auto border border-border bg-card shadow-sm last:mb-0">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px] leading-5">
                <colgroup>
                    {table.headers.map((header, index) => (
                        <col
                            key={`${header}-${index}-width`}
                            style={{ width: tableColumnWidth(index, table.headers.length) }}
                        />
                    ))}
                </colgroup>
                <thead>
                    <tr>
                        {table.headers.map((header, index) => (
                            <th
                                className={cn(
                                    "border-b border-border bg-secondary px-3 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:pl-4 last:pr-4",
                                    index === 0 ? "text-left" : "text-center"
                                )}
                                key={`${header}-${index}`}
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, rowIndex) => {
                        const hasStatusMessage =
                            table.headers.length === 4 &&
                            row.length === 4 &&
                            Boolean(row[1]) &&
                            !row[2] &&
                            !row[3] &&
                            !isNumericTableCell(row[1]);
                        return (
                            <tr className="odd:bg-background even:bg-secondary/25" key={`${row.join(":")}-${rowIndex}`}>
                                {hasStatusMessage ? (
                                    <>
                                        <td className="border-b border-border/70 px-4 py-2.5 align-top font-mono text-xs font-semibold text-foreground">
                                            {row[0]}
                                        </td>
                                        <td
                                            className="break-words border-b border-border/70 px-3 py-2.5 align-top text-muted-foreground"
                                            colSpan={table.headers.length - 1}
                                        >
                                            {row[1]}
                                        </td>
                                    </>
                                ) : (
                                    table.headers.map((_, cellIndex) => (
                                        <td
                                            className={cn(
                                                "border-b border-border/70 px-3 py-2.5 align-top text-foreground first:pl-4 last:pr-4",
                                                cellIndex === 0 ? "font-mono text-xs font-semibold" : null,
                                                isNumericTableCell(row[cellIndex] ?? "")
                                                    ? "whitespace-nowrap text-center font-mono tabular-nums"
                                                    : null
                                            )}
                                            key={`${rowIndex}-${cellIndex}`}
                                        >
                                            {row[cellIndex] ?? "-"}
                                        </td>
                                    ))
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function AssistantMessage({ text, running }: { text: string; running: boolean }) {
    return (
        <div className="max-w-6xl px-1 text-sm leading-6 text-foreground">
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
                            <PlainTextTable source={textFromNode(children)} />
                        ),
                        table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
                        thead: ({ children }) => <thead>{children}</thead>,
                        tbody: ({ children }) => <tbody>{children}</tbody>,
                        tr: ({ children }) => <tr className="odd:bg-background even:bg-secondary/25">{children}</tr>,
                        th: ({ children }) => <MarkdownTableHead>{children}</MarkdownTableHead>,
                        td: ({ children }) => <MarkdownTableCell>{children}</MarkdownTableCell>
                    }}
                >
                    {normalizeAssistantMarkdown(text)}
                </ReactMarkdown>
            ) : running ? (
                <ShimmeringText
                    className="text-sm font-medium"
                    color="var(--text-muted)"
                    shimmerColor="var(--accent)"
                    text="Thinking..."
                />
            ) : (
                <p className="text-sm text-muted-foreground">No assistant response was stored for this run.</p>
            )}
        </div>
    );
}

function UserMessage({ text }: { text: string }) {
    return (
        <div className="flex justify-end">
            <div className="max-w-[min(720px,82%)] border border-border bg-secondary px-4 py-3">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{text}</p>
            </div>
        </div>
    );
}

export function BrokerChatWorkspace({ initialConfig, initialRuns, initialSessions, llmProviders, mcpServer, mcpServers }: Props) {
    const { user } = useSession();
    const [sessions, setSessions] = useState(() => sortSessions(initialSessions));
    const [runs, setRuns] = useState(() => mergeRuns([], initialRuns));
    const [eventsByRun, setEventsByRun] = useState<Record<string, BrokerChatEvent[]>>({});
    const [activeSessionId, setActiveSessionId] = useState(initialSessions[0]?.id ?? initialRuns[0]?.session_id ?? "");
    const [message, setMessage] = useState("");
    const [sessionSearch, setSessionSearch] = useState("");
    const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
    const previousRunCountRef = useRef(0);
    const previousActiveSessionIdRef = useRef<string | null>(null);
    const [provider, setProvider] = useState<LlmProvider | "">(initialConfig.default_provider ?? "");
    const [model, setModel] = useState(initialConfig.default_model ?? "");
    const [visibility, setVisibility] = useState<BrokerChatVisibility>(initialConfig.event_visibility);
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
    const configSaveRequestRef = useRef(0);
    const savedConfigKeyRef = useRef(
        brokerChatConfigKey({
            default_provider: initialConfig.default_provider ?? "",
            default_model: initialConfig.default_model ?? "",
            event_visibility: initialConfig.event_visibility,
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
        const hasModel = selectedModels.some((item) => item.model_id === model);
        if (!hasModel) {
            setModel(selectedModels[0]?.model_id ?? "");
        }
    }, [model, selectedModels, selectedProvider]);

    const runsForActiveSession = useMemo(
        () => sortRuns(runs.filter((run) => run.session_id === activeSessionId)),
        [activeSessionId, runs]
    );
    const activeRunCount = runsForActiveSession.length;
    const {
        contentRef: chatContentRef,
        hasUnreadContent,
        isAutoScrollEnabled,
        isNearBottom,
        onContentChange,
        scrollRef: chatScrollRef,
        scrollToBottom,
        showScrollButton,
        unreadCount
    } = useChatAutoScroll({
        enabled: true,
        nearBottomThreshold: 120
    });
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
            use_mcp: useMcp,
            mcp_server_ids: selectedMcpServerIds
        };
    }, [includeReasoning, includeToolOutputs, model, provider, selectedMcpServerIds, useMcp, visibility]);

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

    useEffect(() => {
        const input = messageInputRef.current;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
        onContentChange();
    }, [message, onContentChange]);

    useEffect(() => {
        const nextRunCount = activeRunCount;
        onContentChange({
            unreadIncrement: nextRunCount > previousRunCountRef.current
        });
        previousRunCountRef.current = nextRunCount;
    }, [activeRunCount, eventsByRun, onContentChange, runsForActiveSession, streamingIds]);

    useEffect(() => {
        if (previousActiveSessionIdRef.current === activeSessionId) {
            return;
        }
        previousActiveSessionIdRef.current = activeSessionId;
        previousRunCountRef.current = activeRunCount;
        scrollToBottom({ behavior: "auto", force: true });
    }, [activeRunCount, activeSessionId, scrollToBottom]);

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
                event_visibility: visibility,
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
            scrollToBottom({ behavior: "auto", force: true });
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
    const starterPrompts = [
        "Summarize today's portfolio risk",
        "Show my available funds and margin",
        "Check broker connection health",
        "Get latest quotes for my watchlist"
    ];

    return (
        <section className="grid min-h-0 flex-1 gap-4 min-[1080px]:grid-cols-[284px_minmax(0,1fr)]">
            <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-border bg-background">
                <div className="border-b border-border p-3">
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
                </div>

                <div className="min-h-0 overflow-y-auto p-2">
                    <div className="px-2 pb-2 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Recents
                    </div>
                    {emptyState ? (
                        <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
                            Start a chat to create the first broker data session.
                        </div>
                    ) : null}
                    {!emptyState && !filteredSessions.length ? (
                        <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
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
                                        "group relative flex min-w-0 items-center gap-1 overflow-hidden border border-transparent transition",
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
                </div>
            </aside>

            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border border-border bg-background">
                <div className="border-b border-border p-3">
                    <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-end min-[900px]:justify-between">
                        <div className="min-w-0">
                            <h2 className="truncate text-xl font-semibold">
                                {activeSession?.title ?? "New broker chat"}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {runsForActiveSession.length} message run
                                {runsForActiveSession.length === 1 ? "" : "s"} in this chat
                            </p>
                        </div>
                    </div>

                    {!configuredProviders.length ? (
                        <div className="mt-4 flex items-start gap-2 border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)] dark:text-[var(--accent)]">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            Configure and enable at least one LLM provider in Settings before sending broker chat messages.
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
                    {queueHealth && !queueHealth.has_processing_path ? (
                        <div className="mt-3 flex items-start gap-2 border border-[var(--accent)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--accent-dim)] dark:text-[var(--accent)]">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
                            Broker chat jobs are queued, but no RQ worker or in-process worker is currently available.
                        </div>
                    ) : null}
                </div>

                <div className="relative min-h-0 overflow-hidden">
                    <div
                        aria-label="Broker chat messages"
                        className="h-full min-h-0 overflow-y-auto px-8 py-5 pb-20 [overflow-anchor:none] min-[900px]:px-10 min-[1400px]:px-14"
                        ref={chatScrollRef}
                        tabIndex={0}
                    >
                        <div className="min-h-full" ref={chatContentRef}>
                            {!runsForActiveSession.length ? (
                                <div className="flex min-h-full items-center justify-center px-4 py-10 text-center">
                                    <div className="w-full max-w-2xl">
                                        <span className="mx-auto flex size-11 items-center justify-center border border-border bg-secondary text-muted-foreground">
                                            <IconTerminal2 className="size-5" stroke={1.8} />
                                        </span>
                                        <p className="mt-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                                            Broker data assistant
                                        </p>
                                        <h3 className="mt-2 text-2xl font-semibold tracking-normal">
                                            Start with a portfolio or market question
                                        </h3>
                                        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                                            Ask about connected accounts, funds, positions, holdings, quotes, option
                                            chains, instruments, or stream health. Tool calls stay scoped to your saved
                                            broker setup.
                                        </p>
                                        <div className="mx-auto mt-6 grid max-w-xl gap-2 min-[640px]:grid-cols-2">
                                            {starterPrompts.map((prompt) => (
                                                <button
                                                    className="border border-border bg-background px-3 py-2.5 text-left text-sm font-semibold text-foreground transition hover:border-primary hover:bg-[var(--accent-glow)] hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
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
                                <div className="grid gap-6">
                                    {runsForActiveSession.map((run) => {
                                        const events = eventsByRun[run.id] ?? [];
                                        const running = liveStatuses.has(run.status) || streamingIds.includes(run.id);
                                        const toolSteps = groupToolSteps(events);
                                        const reasoningSteps = groupReasoningSteps(events);
                                        const text = assistantText(events, run);
                                        const showToolSteps = toolSteps.length > 0;
                                        const showReasoningSteps = reasoningSteps.length > 0;
                                        const showThinking = running && !text && !showToolSteps && !showReasoningSteps;
                                        const showAssistant = Boolean(text) || showThinking || !running;
                                        const eventStepRows = showToolSteps || showReasoningSteps ? (
                                            <div className="grid gap-2">
                                                {toolSteps.map((step) => (
                                                    <ToolStepRow
                                                        isRunActive={running}
                                                        step={step}
                                                        key={step.key}
                                                        visibility={visibility}
                                                    />
                                                ))}
                                                {reasoningSteps.map((step) => (
                                                    <ReasoningStepRow
                                                        includeReasoning={includeReasoning}
                                                        isRunActive={running}
                                                        step={step}
                                                        key={step.key}
                                                        visibility={visibility}
                                                    />
                                                ))}
                                            </div>
                                        ) : null;
                                        return (
                                            <article className="grid gap-3" key={run.id}>
                                                <UserMessage text={run.message} />
                                                {eventStepRows}
                                                {showAssistant ? (
                                                    <AssistantMessage running={showThinking} text={text} />
                                                ) : null}
                                                {run.error ? (
                                                    <div className="ml-11 flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                                                        <IconAlertTriangle
                                                            className="mt-0.5 size-4 shrink-0"
                                                            stroke={1.8}
                                                        />
                                                        {run.error}
                                                    </div>
                                                ) : null}
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    <button
                        aria-label={
                            hasUnreadContent
                                ? "Scroll to latest unread broker chat activity"
                                : "Scroll to latest broker chat message"
                        }
                        className={cn(
                            "absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground shadow-lg transition duration-150 hover:border-primary hover:text-primary motion-reduce:transition-none",
                            showScrollButton
                                ? "translate-y-0 opacity-100"
                                : "pointer-events-none translate-y-2 opacity-0"
                        )}
                        onClick={() => scrollToBottom({ behavior: "smooth", force: true })}
                        type="button"
                    >
                        <IconArrowDown className="size-4" stroke={1.8} />
                        <span>{unreadCount > 0 ? `${unreadCount} new` : "Latest"}</span>
                    </button>
                    <span aria-live="polite" className="sr-only">
                        {!isAutoScrollEnabled && !isNearBottom && hasUnreadContent
                            ? "New broker chat activity is available below."
                            : ""}
                    </span>
                </div>

                <form
                    className="border-t border-border bg-secondary/20 px-3 py-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void sendMessage();
                    }}
                >
                    <div className="border border-border bg-background focus-within:border-primary focus-within:bg-card">
                        <div className="flex min-w-0 items-center gap-3 p-2">
                            <Textarea
                                className="max-h-[260px] min-h-16 resize-none overflow-hidden border-0 bg-transparent px-2 py-5 shadow-none focus-visible:border-transparent disabled:bg-transparent"
                                disabled={!hasConfiguredLlm || isSubmitting || Boolean(activeRun)}
                                onChange={(event) => setMessage(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault();
                                        void sendMessage();
                                    }
                                }}
                                placeholder="Ask for connected broker status, holdings, positions, latest quotes, option chain data, or stream health."
                                ref={messageInputRef}
                                value={message}
                            />
                            <Button
                                aria-label={activeRun ? "Stop active run" : "Send message"}
                                className="size-11 px-0"
                                disabled={activeRun ? false : sendDisabled}
                                onClick={
                                    activeRun
                                        ? (event) => {
                                              event.preventDefault();
                                              void stopActiveRun();
                                          }
                                        : undefined
                                }
                                size="icon"
                                type={activeRun ? "button" : "submit"}
                                variant={activeRun ? "destructive" : "default"}
                            >
                                {activeRun ? (
                                    <IconPlayerStop className="size-4" stroke={1.8} />
                                ) : isSubmitting ? (
                                    <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                                ) : (
                                    <IconArrowRight className="size-4" stroke={1.8} />
                                )}
                            </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/25 px-3 py-2">
                            <Label className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                                Provider
                                <Select
                                    className="h-8 w-36 bg-background px-2 text-sm normal-case"
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
                            <Label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold uppercase text-muted-foreground min-[820px]:max-w-sm">
                                Model
                                <Select
                                    className="h-8 min-w-0 bg-background px-2 text-sm normal-case"
                                    disabled={!selectedModels.length}
                                    onChange={(event) => setModel(event.target.value)}
                                    value={model}
                                >
                                    <option value="">Select model</option>
                                    {selectedModels.map((item) => (
                                        <option key={item.id} value={item.model_id}>
                                            {item.label || item.model_id}
                                        </option>
                                    ))}
                                </Select>
                            </Label>
                            <Label className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                                Detail
                                <Select
                                    className="h-8 w-32 bg-background px-2 text-sm normal-case"
                                    onChange={(event) => setVisibility(event.target.value as BrokerChatVisibility)}
                                    value={visibility}
                                >
                                    <option value="minimal">Minimal</option>
                                    <option value="tool_calls">Tool calls</option>
                                    <option value="full">Full</option>
                                </Select>
                            </Label>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-[1120px]:ml-auto">
                                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                                    <Checkbox
                                        checked={includeToolOutputs}
                                        onCheckedChange={(value) => setIncludeToolOutputs(Boolean(value))}
                                    />
                                    Tool output
                                </Label>
                                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                                    <Checkbox
                                        checked={includeReasoning}
                                        onCheckedChange={(value) => setIncludeReasoning(Boolean(value))}
                                    />
                                    Reasoning
                                </Label>
                                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                                    <Checkbox
                                        checked={useMcp}
                                        disabled={!availableMcpServers.length}
                                        onCheckedChange={(value) => setUseMcp(Boolean(value))}
                                    />
                                    MCP
                                </Label>
                            </div>
                        </div>
                        {useMcp && availableMcpServers.length > 1 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {availableMcpServers.map((server) => {
                                    const serverId = server.id as string;
                                    return (
                                        <Label
                                            className="flex items-center gap-1.5 border border-border px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground"
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
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <IconCircleCheck className="size-3.5" stroke={1.8} />
                            Uses saved broker and LLM credentials
                        </span>
                        <span>Enter sends · Shift + Enter adds a line</span>
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
                    </div>
                </form>
            </div>
        </section>
    );
}
