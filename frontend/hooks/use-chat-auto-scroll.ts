"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ScrollMode = "pinned" | "detached";

type ScrollToBottomOptions = {
    behavior?: ScrollBehavior;
    force?: boolean;
};

type ContentChangeOptions = {
    unreadIncrement?: boolean;
};

type ChatAutoScrollState = {
    isAutoScrollEnabled: boolean;
    isNearBottom: boolean;
    hasUnreadContent: boolean;
    unreadCount: number;
    showScrollButton: boolean;
};

type UseChatAutoScrollOptions = {
    enabled?: boolean;
    nearBottomThreshold?: number;
    manualDetachThreshold?: number;
    initialMode?: ScrollMode;
};

const DEFAULT_NEAR_BOTTOM_THRESHOLD = 120;
const DEFAULT_MANUAL_DETACH_THRESHOLD = 8;
const USER_SCROLL_GRACE_MS = 350;

function distanceToBottom(element: HTMLElement) {
    return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

function prefersReducedMotion() {
    if (typeof window === "undefined" || !window.matchMedia) {
        return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useChatAutoScroll(options: UseChatAutoScrollOptions = {}) {
    const {
        enabled = true,
        initialMode = "pinned",
        manualDetachThreshold = DEFAULT_MANUAL_DETACH_THRESHOLD,
        nearBottomThreshold = DEFAULT_NEAR_BOTTOM_THRESHOLD
    } = options;

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const modeRef = useRef<ScrollMode>(initialMode);
    const lastScrollTopRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const userInputUntilRef = useRef(0);
    const touchStartYRef = useRef<number | null>(null);
    const reduceMotionRef = useRef(false);

    const initialState: ChatAutoScrollState = {
        isAutoScrollEnabled: initialMode === "pinned",
        isNearBottom: true,
        hasUnreadContent: false,
        unreadCount: 0,
        showScrollButton: false
    };
    const stateRef = useRef(initialState);
    const [state, setState] = useState<ChatAutoScrollState>(initialState);

    const syncState = useCallback((patch: Partial<ChatAutoScrollState>) => {
        setState((current) => {
            const next = { ...current, ...patch };
            stateRef.current = next;
            if (
                next.isAutoScrollEnabled === current.isAutoScrollEnabled &&
                next.isNearBottom === current.isNearBottom &&
                next.hasUnreadContent === current.hasUnreadContent &&
                next.unreadCount === current.unreadCount &&
                next.showScrollButton === current.showScrollButton
            ) {
                return current;
            }
            return next;
        });
    }, []);

    const setMode = useCallback(
        (mode: ScrollMode, isNearBottom?: boolean) => {
            modeRef.current = mode;
            const currentState = stateRef.current;
            const nearBottom = isNearBottom ?? currentState.isNearBottom;
            syncState({
                isAutoScrollEnabled: mode === "pinned",
                isNearBottom: nearBottom,
                hasUnreadContent: mode === "pinned" ? false : currentState.hasUnreadContent,
                unreadCount: mode === "pinned" ? 0 : currentState.unreadCount,
                showScrollButton: mode === "detached" && !nearBottom
            });
        },
        [syncState]
    );

    const markUserInput = useCallback(() => {
        userInputUntilRef.current = performance.now() + USER_SCROLL_GRACE_MS;
    }, []);

    const isUserDrivenScroll = useCallback(() => performance.now() <= userInputUntilRef.current, []);

    const updateNearBottom = useCallback(() => {
        const element = scrollRef.current;
        if (!element) {
            return true;
        }
        const isNearBottom = distanceToBottom(element) <= nearBottomThreshold;
        syncState({
            isNearBottom,
            showScrollButton: modeRef.current === "detached" && !isNearBottom
        });
        return isNearBottom;
    }, [nearBottomThreshold, syncState]);

    const scheduleScrollToBottom = useCallback(
        (behavior: ScrollBehavior = "auto") => {
            if (!enabled || modeRef.current !== "pinned") {
                return;
            }
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }

            // Coalesce token, markdown, image, and textarea growth into one write per frame.
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                const element = scrollRef.current;
                if (!element || modeRef.current !== "pinned") {
                    return;
                }
                const nextBehavior = reduceMotionRef.current ? "auto" : behavior;
                element.scrollTo({ top: element.scrollHeight, behavior: nextBehavior });
                lastScrollTopRef.current = element.scrollTop;
                syncState({
                    isAutoScrollEnabled: true,
                    isNearBottom: true,
                    hasUnreadContent: false,
                    unreadCount: 0,
                    showScrollButton: false
                });
            });
        },
        [enabled, syncState]
    );

    const scrollToBottom = useCallback(
        ({ behavior = "smooth", force = true }: ScrollToBottomOptions = {}) => {
            if (force) {
                modeRef.current = "pinned";
            }
            scheduleScrollToBottom(behavior);
        },
        [scheduleScrollToBottom]
    );

    const onContentChange = useCallback(
        ({ unreadIncrement = false }: ContentChangeOptions = {}) => {
            const element = scrollRef.current;
            if (!element || !enabled) {
                return;
            }

            const isNearBottom = distanceToBottom(element) <= nearBottomThreshold;
            if (modeRef.current === "pinned") {
                scheduleScrollToBottom("auto");
                return;
            }

            // Detached means the user is reading older content; surface activity without stealing focus.
            syncState({
                isAutoScrollEnabled: false,
                isNearBottom,
                hasUnreadContent: true,
                unreadCount: unreadIncrement ? stateRef.current.unreadCount + 1 : stateRef.current.unreadCount,
                showScrollButton: !isNearBottom
            });
        },
        [enabled, nearBottomThreshold, scheduleScrollToBottom, syncState]
    );

    const preserveScrollAnchor = useCallback((mutate: () => void) => {
        const element = scrollRef.current;
        if (!element) {
            mutate();
            return;
        }
        const distanceFromBottom = element.scrollHeight - element.scrollTop;
        mutate();
        requestAnimationFrame(() => {
            if (!scrollRef.current || modeRef.current === "pinned") {
                return;
            }
            scrollRef.current.scrollTop = Math.max(0, scrollRef.current.scrollHeight - distanceFromBottom);
        });
    }, []);

    useEffect(() => {
        reduceMotionRef.current = prefersReducedMotion();
        const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
        const update = () => {
            reduceMotionRef.current = Boolean(media?.matches);
        };
        media?.addEventListener("change", update);
        return () => media?.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        const element = scrollRef.current;
        if (!element) {
            return;
        }

        lastScrollTopRef.current = element.scrollTop;

        const handleScroll = () => {
            const currentScrollTop = element.scrollTop;
            const scrolledUp = currentScrollTop < lastScrollTopRef.current - 1;
            const scrolledDown = currentScrollTop > lastScrollTopRef.current + 1;
            const currentDistance = distanceToBottom(element);
            const isNearBottom = currentDistance <= nearBottomThreshold;
            const userDriven = isUserDrivenScroll();

            lastScrollTopRef.current = currentScrollTop;

            if (isNearBottom && (scrolledDown || currentDistance === 0 || modeRef.current === "pinned")) {
                setMode("pinned", true);
                return;
            }

            if (userDriven && scrolledUp && currentDistance > manualDetachThreshold) {
                setMode("detached", isNearBottom);
                return;
            }

            if (userDriven && !isNearBottom) {
                setMode("detached", false);
                return;
            }

            updateNearBottom();
        };

        const handleWheel = (event: WheelEvent) => {
            markUserInput();
            if (event.deltaY < 0 && distanceToBottom(element) > manualDetachThreshold) {
                setMode("detached", false);
            }
        };

        const handleTouchStart = (event: TouchEvent) => {
            touchStartYRef.current = event.touches[0]?.clientY ?? null;
            markUserInput();
        };

        const handleTouchMove = (event: TouchEvent) => {
            const startY = touchStartYRef.current;
            const nextY = event.touches[0]?.clientY ?? null;
            markUserInput();
            if (startY !== null && nextY !== null && nextY > startY && distanceToBottom(element) > manualDetachThreshold) {
                setMode("detached", false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (["ArrowUp", "PageUp", "Home", " "].includes(event.key)) {
                markUserInput();
            }
            if (["End", "PageDown", "ArrowDown"].includes(event.key)) {
                markUserInput();
            }
        };

        element.addEventListener("scroll", handleScroll, { passive: true });
        element.addEventListener("wheel", handleWheel, { passive: true });
        element.addEventListener("touchstart", handleTouchStart, { passive: true });
        element.addEventListener("touchmove", handleTouchMove, { passive: true });
        element.addEventListener("keydown", handleKeyDown);

        return () => {
            element.removeEventListener("scroll", handleScroll);
            element.removeEventListener("wheel", handleWheel);
            element.removeEventListener("touchstart", handleTouchStart);
            element.removeEventListener("touchmove", handleTouchMove);
            element.removeEventListener("keydown", handleKeyDown);
        };
    }, [isUserDrivenScroll, manualDetachThreshold, markUserInput, nearBottomThreshold, setMode, updateNearBottom]);

    useEffect(() => {
        const element = scrollRef.current;
        const content = contentRef.current;
        if (!element || typeof ResizeObserver === "undefined") {
            return;
        }

        // ResizeObserver catches markdown reflow, code block expansion, lazy media, viewport, and composer changes.
        const observer = new ResizeObserver(() => {
            onContentChange();
        });
        observer.observe(element);
        if (content) {
            observer.observe(content);
        }
        return () => observer.disconnect();
    }, [onContentChange]);

    useEffect(() => {
        const handleResize = () => {
            if (modeRef.current === "pinned") {
                scheduleScrollToBottom("auto");
            } else {
                updateNearBottom();
            }
        };
        window.addEventListener("resize", handleResize);
        window.visualViewport?.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
            window.visualViewport?.removeEventListener("resize", handleResize);
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [scheduleScrollToBottom, updateNearBottom]);

    return {
        scrollRef,
        contentRef,
        preserveScrollAnchor,
        onContentChange,
        scrollToBottom,
        ...state
    };
}
