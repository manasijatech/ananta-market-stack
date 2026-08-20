"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listAdaptiveWorkspacePreferences } from "@/service/actions/adaptive-workspace";
import type { AdaptiveWorkspacePreference } from "@/service/types/adaptive-workspace";

type DeskPrefsContextValue = {
    defaultAccountId: string;
    defaultWatchlistId: string;
    defaultWorkflowId: string;
    density: "comfortable" | "compact";
    intelProduct: string;
    items: AdaptiveWorkspacePreference[];
    reload: () => Promise<void>;
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

    const value = useMemo<DeskPrefsContextValue>(() => {
        const density = stringPref(items, "density") === "compact" ? "compact" : "comfortable";
        return {
            defaultAccountId: stringPref(items, "default_account_id"),
            defaultWatchlistId: stringPref(items, "default_watchlist_id"),
            defaultWorkflowId: stringPref(items, "default_workflow_id"),
            density,
            intelProduct: stringPref(items, "intel_product"),
            items,
            reload
        };
    }, [items, reload]);

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
