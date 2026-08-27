"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from "react";
import { outputsForSpec, toolOutputsFromMessages } from "@/lib/adaptive-workspace/bind-outputs";
import { clampPosition, placeWithoutOverlap } from "@/lib/adaptive-workspace/layout";
import {
    cloneWorkspaceSpec,
    emptyWorkspaceSpec,
    nextComponentId,
    nextGridPosition,
    parseWorkspaceSpec,
    workspaceSpecsEqual
} from "@/lib/adaptive-workspace/spec";
import { createAdaptiveWorkspaceSnapshot, getAdaptiveWorkspaceCurrent } from "@/service/actions/adaptive-workspace";
import { uniqueCashSymbols } from "@/hooks/use-desk-data";
import type {
    WorkspacePosition,
    WorkspaceSpec,
    WorkspaceWidgetOutput
} from "@/service/types/adaptive-workspace";

type ApplySource = "agent" | "restore" | "user";

type AdaptiveWorkspaceContextValue = {
    applySpec: (spec: WorkspaceSpec, source?: ApplySource, forSessionId?: string | null) => void;
    bindSession: (sessionId: string | null) => void;
    canUndo: boolean;
    duplicate: (id: string) => void;
    ingestMessageOutputs: (messages: Array<{ parts?: unknown[]; role?: string }>) => void;
    loading: boolean;
    outputs: Record<string, WorkspaceWidgetOutput>;
    patchComponent: (
        id: string,
        patch: { position?: WorkspacePosition; props?: Record<string, unknown> },
        options?: { history?: boolean }
    ) => void;
    patchUniverse: (symbols: string[]) => void;
    remove: (id: string) => void;
    select: (id: string | null) => void;
    selectedId: string | null;
    sessionId: string | null;
    spec: WorkspaceSpec;
    undo: () => void;
    updatePosition: (id: string, position: WorkspacePosition) => void;
};

const AdaptiveWorkspaceContext = createContext<AdaptiveWorkspaceContextValue | null>(null);
const HISTORY_LIMIT = 20;
const PERSIST_MS = 700;

export function AdaptiveWorkspaceProvider({ children }: { children: ReactNode }) {
    const [spec, setSpec] = useState<WorkspaceSpec>(emptyWorkspaceSpec());
    const [outputs, setOutputs] = useState<Record<string, WorkspaceWidgetOutput>>({});
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [history, setHistory] = useState<WorkspaceSpec[]>([]);
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const persistTimerRef = useRef<number | null>(null);
    const specRef = useRef(spec);

    useEffect(() => {
        specRef.current = spec;
    }, [spec]);

    const persist = useCallback((next: WorkspaceSpec, label: string) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = window.setTimeout(() => {
            void createAdaptiveWorkspaceSnapshot(sessionId, next, label).catch(() => undefined);
        }, PERSIST_MS);
    }, []);

    const pushAndSet = useCallback(
        (next: WorkspaceSpec, source: ApplySource) => {
            const parsed = parseWorkspaceSpec(next);
            if (!parsed) return;
            setSpec((current) => {
                if (workspaceSpecsEqual(current, parsed)) return current;
                if (source !== "restore") {
                    setHistory((historyItems) => [cloneWorkspaceSpec(current), ...historyItems].slice(0, HISTORY_LIMIT));
                }
                if (source === "user") persist(parsed, "Canvas edit");
                return parsed;
            });
        },
        [persist]
    );

    const applySpec = useCallback(
        (next: WorkspaceSpec, source: ApplySource = "agent", forSessionId?: string | null) => {
            if (forSessionId !== undefined && forSessionId !== sessionIdRef.current) return;
            pushAndSet(next, source);
        },
        [pushAndSet]
    );

    const ingestMessageOutputs = useCallback((messages: Array<{ parts?: unknown[]; role?: string }>) => {
        const bound = outputsForSpec(specRef.current, toolOutputsFromMessages(messages));
        if (!Object.keys(bound).length) return;
        setOutputs((current) => {
            let changed = false;
            const next = { ...current };
            for (const [id, value] of Object.entries(bound)) {
                const previous = current[id];
                if (
                    !previous ||
                    previous.toolName !== value.toolName ||
                    JSON.stringify(previous.output) !== JSON.stringify(value.output)
                ) {
                    next[id] = value;
                    changed = true;
                }
            }
            return changed ? next : current;
        });
    }, []);

    const bindSession = useCallback(
        (sessionId: string | null) => {
            const previous = sessionIdRef.current;
            if (previous === sessionId) return;
            if (persistTimerRef.current) {
                window.clearTimeout(persistTimerRef.current);
                persistTimerRef.current = null;
            }
            sessionIdRef.current = sessionId;
            setSessionId(sessionId);
            setSelectedId(null);
            setHistory([]);
            setOutputs({});
            if (!sessionId) {
                setSpec(emptyWorkspaceSpec());
                return;
            }
            setLoading(true);
            void getAdaptiveWorkspaceCurrent(sessionId)
                .then((current) => {
                    if (sessionIdRef.current !== sessionId) return;
                    const parsed = parseWorkspaceSpec(current.spec) ?? emptyWorkspaceSpec();
                    setSpec(parsed);
                })
                .catch(() => {
                    if (sessionIdRef.current !== sessionId) return;
                    setSpec(emptyWorkspaceSpec());
                })
                .finally(() => {
                    if (sessionIdRef.current === sessionId) setLoading(false);
                });
        },
        []
    );

    const remove = useCallback(
        (id: string) => {
            setSpec((current) => {
                if (!current.components.some((item) => item.id === id)) return current;
                const next = cloneWorkspaceSpec(current);
                next.components = next.components.filter((item) => item.id !== id);
                setHistory((historyItems) => [cloneWorkspaceSpec(current), ...historyItems].slice(0, HISTORY_LIMIT));
                setOutputs((currentOutputs) => {
                    const copy = { ...currentOutputs };
                    delete copy[id];
                    return copy;
                });
                setSelectedId((selected) => (selected === id ? null : selected));
                persist(next, "Remove widget");
                return next;
            });
        },
        [persist]
    );

    const duplicate = useCallback(
        (id: string) => {
            setSpec((current) => {
                const source = current.components.find((item) => item.id === id);
                if (!source) return current;
                const clone = cloneWorkspaceSpec({ ...current, components: [source] }).components[0];
                clone.id = nextComponentId(
                    current.components.map((item) => item.id),
                    source.id
                );
                clone.position = nextGridPosition(current, source.position.w, source.position.h);
                const next = cloneWorkspaceSpec(current);
                next.components = [...next.components, clone];
                setHistory((historyItems) => [cloneWorkspaceSpec(current), ...historyItems].slice(0, HISTORY_LIMIT));
                setOutputs((currentOutputs) => {
                    const cached = currentOutputs[id];
                    return cached ? { ...currentOutputs, [clone.id]: cached } : currentOutputs;
                });
                setSelectedId(clone.id);
                persist(next, "Duplicate widget");
                return next;
            });
        },
        [persist]
    );

    const updatePosition = useCallback(
        (id: string, position: WorkspacePosition) => {
            const clamped = clampPosition(position);
            setSpec((current) => {
                const index = current.components.findIndex((item) => item.id === id);
                if (index < 0) return current;
                const packed = placeWithoutOverlap(current.components, id, clamped);
                const next = cloneWorkspaceSpec(current);
                next.components = next.components.map((item) => {
                    const match = packed.find((entry) => entry.id === item.id);
                    return match ? { ...item, position: match.position } : item;
                });
                if (workspaceSpecsEqual(current, next)) return current;
                setHistory((historyItems) => [cloneWorkspaceSpec(current), ...historyItems].slice(0, HISTORY_LIMIT));
                persist(next, "Move widget");
                return next;
            });
        },
        [persist]
    );

    const patchComponent = useCallback(
        (id: string, patch: { position?: WorkspacePosition; props?: Record<string, unknown> }, options?: { history?: boolean }) => {
            setSpec((current) => {
                const index = current.components.findIndex((item) => item.id === id);
                if (index < 0) return current;
                const existing = current.components[index];
                const nextPosition = patch.position ? clampPosition(patch.position) : existing.position;
                const nextProps = patch.props ? { ...(existing.props ?? {}), ...patch.props } : existing.props;
                const next = cloneWorkspaceSpec(current);
                next.components[index] = { ...existing, position: nextPosition, props: nextProps };
                if (patch.position) {
                    const packed = placeWithoutOverlap(next.components, id, nextPosition);
                    next.components = next.components.map((item) => {
                        const match = packed.find((entry) => entry.id === item.id);
                        return match ? { ...item, position: match.position } : item;
                    });
                }
                if (workspaceSpecsEqual(current, next)) return current;
                if (options?.history !== false) {
                    setHistory((historyItems) => [cloneWorkspaceSpec(current), ...historyItems].slice(0, HISTORY_LIMIT));
                }
                persist(next, "Update widget");
                return next;
            });
        },
        [persist]
    );

    const patchUniverse = useCallback(
        (symbols: string[]) => {
            setSpec((current) => {
                const nextSymbols = uniqueCashSymbols(symbols).slice(0, 40);
                const next = cloneWorkspaceSpec(current);
                next.universe = { symbols: nextSymbols };
                if (workspaceSpecsEqual(current, next)) return current;
                setHistory((historyItems) => [cloneWorkspaceSpec(current), ...historyItems].slice(0, HISTORY_LIMIT));
                persist(next, "Update desk symbols");
                return next;
            });
        },
        [persist]
    );

    const undo = useCallback(() => {
        setHistory((currentHistory) => {
            const [previous, ...rest] = currentHistory;
            if (!previous) return currentHistory;
            const parsed = parseWorkspaceSpec(previous) ?? previous;
            setSpec(parsed);
            persist(parsed, "Undo canvas");
            return rest;
        });
    }, [persist]);

    const select = useCallback((id: string | null) => {
        setSelectedId(id);
    }, []);

    const value = useMemo(
        () => ({
            applySpec,
            bindSession,
            canUndo: history.length > 0,
            duplicate,
            ingestMessageOutputs,
            loading,
            outputs,
            patchComponent,
            patchUniverse,
            remove,
            select,
            selectedId,
            sessionId,
            spec,
            undo,
            updatePosition
        }),
        [
            applySpec,
            bindSession,
            duplicate,
            history.length,
            ingestMessageOutputs,
            loading,
            outputs,
            patchComponent,
            patchUniverse,
            remove,
            select,
            selectedId,
            sessionId,
            spec,
            undo,
            updatePosition
        ]
    );

    return <AdaptiveWorkspaceContext.Provider value={value}>{children}</AdaptiveWorkspaceContext.Provider>;
}

export function useAdaptiveWorkspace() {
    const value = useContext(AdaptiveWorkspaceContext);
    if (!value) {
        throw new Error("useAdaptiveWorkspace must be used inside AdaptiveWorkspaceProvider");
    }
    return value;
}
