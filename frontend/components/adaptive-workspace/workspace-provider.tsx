"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { componentTypeForTool, pinTitleForTool } from "@/lib/adaptive-workspace/catalog";
import type { PinnedWorkspaceItem } from "@/service/types/adaptive-workspace";

type PinInput = {
    input: Record<string, unknown>;
    output: unknown;
    toolName: string;
};

type AdaptiveWorkspaceContextValue = {
    pin: (item: PinInput) => void;
    pins: PinnedWorkspaceItem[];
    unpin: (id: string) => void;
};

const AdaptiveWorkspaceContext = createContext<AdaptiveWorkspaceContextValue | null>(null);

export function AdaptiveWorkspaceProvider({ children }: { children: ReactNode }) {
    const [pins, setPins] = useState<PinnedWorkspaceItem[]>([]);

    const pin = useCallback((item: PinInput) => {
        const type = componentTypeForTool(item.toolName);
        if (!type) return;
        setPins((current) => {
            const already = current.some((entry) => entry.toolName === item.toolName && JSON.stringify(entry.output) === JSON.stringify(item.output));
            if (already) return current;
            return [
                {
                    id: `pin-${Date.now()}-${current.length}`,
                    input: item.input,
                    output: item.output,
                    pinnedAt: new Date().toISOString(),
                    title: pinTitleForTool(item.toolName),
                    toolName: item.toolName,
                    type
                },
                ...current
            ];
        });
    }, []);

    const unpin = useCallback((id: string) => {
        setPins((current) => current.filter((item) => item.id !== id));
    }, []);

    const value = useMemo(() => ({ pin, pins, unpin }), [pin, pins, unpin]);
    return <AdaptiveWorkspaceContext.Provider value={value}>{children}</AdaptiveWorkspaceContext.Provider>;
}

export function useAdaptiveWorkspacePins() {
    const value = useContext(AdaptiveWorkspaceContext);
    if (!value) {
        throw new Error("useAdaptiveWorkspacePins must be used inside AdaptiveWorkspaceProvider");
    }
    return value;
}
