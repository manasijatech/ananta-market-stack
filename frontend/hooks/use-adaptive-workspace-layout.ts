"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const STORAGE_KEY = "ananta.adaptive-workspace.layout";
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 420;

type AdaptiveWorkspaceLayout = {
    inspectorOpen: boolean;
    inspectorWidth: number;
};

function clampWidth(value: number) {
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

function readLayout(): AdaptiveWorkspaceLayout {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { inspectorOpen: true, inspectorWidth: DEFAULT_WIDTH };
        const parsed = JSON.parse(raw) as Partial<AdaptiveWorkspaceLayout>;
        return {
            inspectorOpen: parsed.inspectorOpen !== false,
            inspectorWidth: clampWidth(typeof parsed.inspectorWidth === "number" ? parsed.inspectorWidth : DEFAULT_WIDTH)
        };
    } catch {
        return { inspectorOpen: true, inspectorWidth: DEFAULT_WIDTH };
    }
}

export function useAdaptiveWorkspaceLayout() {
    const [layout, setLayout] = useState<AdaptiveWorkspaceLayout>({
        inspectorOpen: true,
        inspectorWidth: DEFAULT_WIDTH
    });
    const layoutRef = useRef(layout);

    useEffect(() => {
        layoutRef.current = layout;
    }, [layout]);

    useEffect(() => {
        setLayout(readLayout());
    }, []);

    const persist = useCallback((patch: Partial<AdaptiveWorkspaceLayout>) => {
        setLayout((current) => {
            const next = { ...current, ...patch };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    const setInspectorOpen = useCallback(
        (inspectorOpen: boolean) => {
            persist({ inspectorOpen });
        },
        [persist]
    );

    const onResizePointerDown = useCallback(
        (event: ReactPointerEvent<HTMLButtonElement>) => {
            event.preventDefault();
            const originX = event.clientX;
            const originWidth = layoutRef.current.inspectorWidth;

            function onMove(moveEvent: PointerEvent) {
                persist({
                    inspectorOpen: true,
                    inspectorWidth: clampWidth(originWidth - (moveEvent.clientX - originX))
                });
            }

            function onUp() {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            }

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [persist]
    );

    return {
        inspectorOpen: layout.inspectorOpen,
        inspectorWidth: layout.inspectorWidth,
        onResizePointerDown,
        setInspectorOpen
    };
}
