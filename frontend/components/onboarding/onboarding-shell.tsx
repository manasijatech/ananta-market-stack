"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { IconCircleCheck } from "@tabler/icons-react";
import { BrandLogo } from "@/components/brand-logo";
import { OnboardingMotionProvider, useOnboardingMotion } from "@/components/onboarding/onboarding-motion";
import {
    onboardingStepPath,
    type OnboardingStepSlug,
    type WorkspaceSetupReadiness
} from "@/lib/setup-readiness";
import { cn } from "@/lib/utils";

type StepMeta = {
    slug: OnboardingStepSlug;
    label: string;
    optional?: boolean;
};

const steps: StepMeta[] = [
    { slug: "welcome", label: "Welcome" },
    { slug: "broker", label: "Broker" },
    { slug: "drishti", label: "Drishti" },
    { slug: "llm-provider", label: "LLM" },
    { slug: "mcp", label: "MCP", optional: true }
];
const stepSlugs = steps.map((step) => step.slug);

function isStepComplete(slug: OnboardingStepSlug, readiness: WorkspaceSetupReadiness) {
    switch (slug) {
        case "welcome":
            return true;
        case "broker":
            return readiness.hasBroker;
        case "drishti":
            return readiness.alphaReady;
        case "llm-provider":
            return readiness.llmReady;
        case "mcp":
            return readiness.mcpReady;
    }
}

function isStepReachable(slug: OnboardingStepSlug, readiness: WorkspaceSetupReadiness) {
    switch (slug) {
        case "welcome":
        case "broker":
            return true;
        case "drishti":
            return readiness.hasBroker;
        case "llm-provider":
            return readiness.hasBroker && readiness.alphaReady;
        case "mcp":
            return readiness.requiredReady;
    }
}

export function OnboardingShell({
    children,
    readiness
}: {
    children: React.ReactNode;
    readiness: WorkspaceSetupReadiness;
}) {
    const segment = (useSelectedLayoutSegment() ?? "welcome") as OnboardingStepSlug;
    const currentIndex = Math.max(
        steps.findIndex((step) => step.slug === segment),
        0
    );

    const completeCount = steps.filter((step) => isStepComplete(step.slug, readiness)).length;

    return (
        <OnboardingMotionProvider
            completeCount={completeCount}
            currentIndex={currentIndex}
            steps={stepSlugs}
        >
            <OnboardingShellContent currentIndex={currentIndex} readiness={readiness}>
                {children}
            </OnboardingShellContent>
        </OnboardingMotionProvider>
    );
}

function OnboardingShellContent({
    children,
    currentIndex,
    readiness
}: {
    children: React.ReactNode;
    currentIndex: number;
    readiness: WorkspaceSetupReadiness;
}) {
    const { contentRef, navigateTo, registerStep } = useOnboardingMotion();

    return (
        <main className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border bg-background">
                <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center px-4">
                    <BrandLogo imageClassName="text-[1.35rem]" />
                </div>
                <div className="mx-auto w-full max-w-5xl px-4 pb-4">
                    <div className="grid gap-3 min-[720px]:grid-cols-5" data-onboarding-ledger>
                        {steps.map((step, index) => {
                            const complete = isStepComplete(step.slug, readiness);
                            const current = index === currentIndex;
                            const reachable = isStepReachable(step.slug, readiness);
                            const content = (
                                <span
                                    className={cn(
                                        "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                                        current
                                            ? "border-primary bg-primary/10 text-foreground"
                                            : complete
                                              ? "border-[var(--success)] bg-[var(--success-subtle)] text-foreground"
                                              : "border-border bg-background text-muted-foreground",
                                        !reachable && "opacity-50"
                                    )}
                                >
                                    <span className="truncate">
                                        {index + 1}. {step.label}
                                    </span>
                                    {step.optional ? (
                                        <span className="text-xs text-muted-foreground">Optional</span>
                                    ) : null}
                                    {complete ? <IconCircleCheck className="size-4 text-[var(--success)]" stroke={1.8} /> : null}
                                </span>
                            );

                            return reachable ? (
                                <Link
                                    href={onboardingStepPath(step.slug)}
                                    key={step.slug}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        navigateTo(onboardingStepPath(step.slug));
                                    }}
                                    ref={(node) => registerStep(step.slug, node)}
                                >
                                    {content}
                                </Link>
                            ) : (
                                <span
                                    aria-disabled="true"
                                    key={step.slug}
                                    ref={(node) => registerStep(step.slug, node)}
                                >
                                    {content}
                                </span>
                            );
                        })}
                    </div>
                </div>
            </header>
            <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8" ref={contentRef}>
                {children}
            </div>
        </main>
    );
}
