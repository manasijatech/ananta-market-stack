"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AguiEvent } from "@/lib/adaptive-workspace/ag-ui";

type AdaptiveInteropValue = {
    aguiEvents: AguiEvent[];
    runId: string | null;
    threadId: string | null;
};

const AdaptiveInteropContext = createContext<AdaptiveInteropValue>({
    aguiEvents: [],
    runId: null,
    threadId: null
});

export function AdaptiveInteropProvider({
    aguiEvents,
    children,
    runId,
    threadId
}: AdaptiveInteropValue & { children: ReactNode }) {
    return (
        <AdaptiveInteropContext.Provider value={{ aguiEvents, runId, threadId }}>
            {children}
        </AdaptiveInteropContext.Provider>
    );
}

export function useAdaptiveInterop() {
    return useContext(AdaptiveInteropContext);
}
