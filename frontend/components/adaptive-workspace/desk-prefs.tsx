"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listAdaptiveWorkspacePreferences, putAdaptiveWorkspacePreference } from "@/service/actions/adaptive-workspace";
import type { AdaptiveWorkspacePreference } from "@/service/types/adaptive-workspace";

type DeskPrefsContextValue = {
    canvasLocked: boolean;
    defaultAccountId: string;
    defaultWatchlistId: string;
    defaultWorkflowId: string;
    density: "comfortable" | "compact";
    intelProduct: string;
    items: AdaptiveWorkspacePreference[];
    reload: () => Promise<void>;
    setCanvasLocked: (locked: boolean) => Promise<void>;
};

const DeskPrefsContext = createContext<DeskPrefsContextValue | null>(null);

function stringPref(items: AdaptiveWorkspacePreference[], key: string): string {
    const match = items.find((item) => item.key === key);
    return typeof match?.value === "string" ? match.value : "";
}

export function AdaptiveDeskPrefsProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<AdaptiveWorkspacePreference[]>([]);

    const reload = useCallback(async () => {
        try {
            setItems(await listAdaptiveWorkspacePreferences());
        } catch {
            setItems([]);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const setCanvasLocked = useCallback(async (locked: boolean) => {
        const value = locked ? "locked" : "unlocked";
        setItems((current) => {
            const rest = current.filter((item) => item.key !== "canvas_locked");
            return [...rest, { deletable: true, key: "canvas_locked", updated_at: "", value }];
        });
        try {
            await putAdaptiveWorkspacePreference("canvas_locked", value);
        } catch {
            await reload();
        }
    }, [reload]);

    const value = useMemo<DeskPrefsContextValue>(() => {
        const density = stringPref(items, "density") === "compact" ? "compact" : "comfortable";
        return {
            canvasLocked: stringPref(items, "canvas_locked") !== "unlocked",
            defaultAccountId: stringPref(items, "default_account_id"),
            defaultWatchlistId: stringPref(items, "default_watchlist_id"),
            defaultWorkflowId: stringPref(items, "default_workflow_id"),
            density,
            intelProduct: stringPref(items, "intel_product"),
            items: items.filter((item) => item.key !== "request_intent_counts"),
            reload,
            setCanvasLocked
        };
    }, [items, reload, setCanvasLocked]);

    return <DeskPrefsContext.Provider value={value}>{children}</DeskPrefsContext.Provider>;
}

export function useAdaptiveDeskPrefs() {
    const value = useContext(DeskPrefsContext);
    if (!value) {
        throw new Error("useAdaptiveDeskPrefs must be used inside AdaptiveDeskPrefsProvider");
    }
    return value;
}

export function useOptionalAdaptiveDeskPrefs() {
    return useContext(DeskPrefsContext);
}
