"use client";

import gsap from "gsap";
import { useRouter } from "next/navigation";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject
} from "react";
import type { OnboardingStepSlug } from "@/lib/setup-readiness";

type OnboardingMotionContextValue = {
    contentRef: RefObject<HTMLDivElement | null>;
    navigateTo: (path: string) => void;
    registerStep: (slug: OnboardingStepSlug, node: HTMLElement | null) => void;
};

type OnboardingMotionProviderProps = {
    children: React.ReactNode;
    completeCount: number;
    currentIndex: number;
    steps: OnboardingStepSlug[];
};

const OnboardingMotionContext = createContext<OnboardingMotionContextValue | null>(null);

function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setReduced(query.matches);

        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    return reduced;
}

function stepFromPath(path: string): OnboardingStepSlug | null {
    const segment = path.split("?")[0]?.split("/").filter(Boolean).at(-1);
    if (
        segment === "welcome" ||
        segment === "broker" ||
        segment === "drishti" ||
        segment === "llm-provider" ||
        segment === "mcp"
    ) {
        return segment;
    }
    return null;
}

export function OnboardingMotionProvider({
    children,
    completeCount,
    currentIndex,
    steps
}: OnboardingMotionProviderProps) {
    const router = useRouter();
    const reducedMotion = usePrefersReducedMotion();
    const contentRef = useRef<HTMLDivElement | null>(null);
    const stepRefs = useRef(new Map<OnboardingStepSlug, HTMLElement>());
    const timelineRef = useRef<gsap.core.Timeline | null>(null);
    const previousIndexRef = useRef(currentIndex);
    const previousCountRef = useRef(completeCount);
    const mountedRef = useRef(false);

    const killTimeline = useCallback(() => {
        timelineRef.current?.kill();
        timelineRef.current = null;
    }, []);

    const animateIn = useCallback(
        (direction: 1 | -1) => {
            const content = contentRef.current;

            if (!content || reducedMotion) {
                gsap.set(content, { autoAlpha: 1, x: 0 });
                return;
            }

            const items = content.querySelectorAll<HTMLElement>("[data-onboarding-motion-item]");
            killTimeline();
            const timeline = gsap.timeline();
            timelineRef.current = timeline;
            timeline.set(content, { autoAlpha: 1, x: 0 });
            timeline.fromTo(
                items.length ? items : content.children,
                { autoAlpha: 0, y: 10 * direction },
                { autoAlpha: 1, y: 0, duration: 0.2, ease: "power1.out", stagger: 0.025 }
            );
        },
        [killTimeline, reducedMotion]
    );

    const navigateTo = useCallback(
        (path: string) => {
            const targetSegment = stepFromPath(path);
            const targetIndex = targetSegment ? steps.indexOf(targetSegment) : currentIndex;
            const direction: 1 | -1 = targetIndex >= currentIndex ? 1 : -1;
            const content = contentRef.current;

            killTimeline();

            if (!content || reducedMotion || !targetSegment) {
                router.push(path);
                return;
            }

            const timeline = gsap.timeline({
                onComplete: () => {
                    router.push(path);
                }
            });
            timelineRef.current = timeline;
            timeline.to(content, { autoAlpha: 0, x: direction === 1 ? -10 : 10, duration: 0.15, ease: "power1.in" }, 0);

        },
        [currentIndex, killTimeline, reducedMotion, router, steps]
    );

    const registerStep = useCallback((slug: OnboardingStepSlug, node: HTMLElement | null) => {
        if (node) {
            stepRefs.current.set(slug, node);
        } else {
            stepRefs.current.delete(slug);
        }
    }, []);

    useEffect(() => {
        const previousIndex = previousIndexRef.current;
        const direction: 1 | -1 = currentIndex >= previousIndex ? 1 : -1;

        previousCountRef.current = completeCount;

        if (mountedRef.current) {
            animateIn(direction);
        } else {
            mountedRef.current = true;
        }

        previousIndexRef.current = currentIndex;
    }, [animateIn, completeCount, currentIndex]);

    const value = useMemo(
        () => ({ contentRef, navigateTo, registerStep }),
        [navigateTo, registerStep]
    );

    return <OnboardingMotionContext.Provider value={value}>{children}</OnboardingMotionContext.Provider>;
}

export function useOnboardingMotion() {
    const context = useContext(OnboardingMotionContext);

    if (!context) {
        throw new Error("useOnboardingMotion must be used inside OnboardingMotionProvider");
    }

    return context;
}
