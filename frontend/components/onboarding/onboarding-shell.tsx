"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { IconCircleCheck } from "@tabler/icons-react";
import { BrandLogo } from "@/components/brand-logo";
import {
	OnboardingMotionProvider,
	useOnboardingMotion,
} from "@/components/onboarding/onboarding-motion";
import {
	Progress,
	ProgressIndicator,
	ProgressLabel,
	ProgressTrack,
} from "@/components/ui/progress";
import {
	isOnboardingStepReachable,
	onboardingStepPath,
	type OnboardingStepSlug,
	type WorkspaceSetupReadiness,
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
	{ slug: "mcp", label: "MCP", optional: true },
];
const stepSlugs = steps.map((step) => step.slug);
const requiredStepCount = steps.filter((step) => !step.optional).length;

function isStepComplete(
	slug: OnboardingStepSlug,
	readiness: WorkspaceSetupReadiness,
) {
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

export function OnboardingShell({
	children,
	readiness,
}: {
	children: React.ReactNode;
	readiness: WorkspaceSetupReadiness;
}) {
	const segment = (useSelectedLayoutSegment() ??
		"welcome") as OnboardingStepSlug;
	const currentIndex = Math.max(
		steps.findIndex((step) => step.slug === segment),
		0,
	);

	const completeCount = steps.filter((step) =>
		isStepComplete(step.slug, readiness),
	).length;

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
	readiness,
}: {
	children: React.ReactNode;
	currentIndex: number;
	readiness: WorkspaceSetupReadiness;
}) {
	const { contentRef, navigateTo, registerStep } = useOnboardingMotion();
	const completedRequiredCount = steps.filter(
		(step) => !step.optional && isStepComplete(step.slug, readiness),
	).length;
	const progressValue = Math.round(
		(completedRequiredCount / requiredStepCount) * 100,
	);

	return (
		<main className="app-page-background grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
			<header className="bg-transparent">
				<div className="mx-auto flex min-h-16 w-full max-w-5xl items-center px-4">
					<BrandLogo imageClassName="text-[1.35rem]" />
				</div>
				<div className="mx-auto w-full max-w-5xl px-4 pb-4">
					<Progress
						aria-valuetext={`${completedRequiredCount} of ${requiredStepCount} required steps complete`}
						className="mb-3 gap-1.5"
						value={progressValue}
					>
						<div className="flex items-center justify-between gap-3">
							<ProgressLabel className="text-xs text-muted-foreground">
								Setup progress
							</ProgressLabel>
							<span className="text-xs tabular-nums text-muted-foreground">
								{completedRequiredCount} of {requiredStepCount} required steps
								complete
							</span>
						</div>
						<ProgressTrack className="h-1 bg-border/70">
							<ProgressIndicator className="bg-[var(--success)]" />
						</ProgressTrack>
					</Progress>
					<div
						className="grid gap-3 min-[720px]:grid-cols-5"
						data-onboarding-ledger
					>
						{steps.map((step, index) => {
							const complete = isStepComplete(step.slug, readiness);
							const current = index === currentIndex;
							const reachable = isOnboardingStepReachable(
								step.slug,
								readiness,
							);
							const content = (
								<span
									className={cn(
										"flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
										current
											? "border-primary bg-primary/10 text-foreground"
											: complete
												? "border-[var(--success)] bg-[var(--success-subtle)] text-foreground"
												: "border-border bg-background text-muted-foreground",
										!reachable && "opacity-50",
									)}
								>
									<span className="truncate">
										{index + 1}. {step.label}
									</span>
									{step.optional ? (
										<span className="text-xs text-muted-foreground">
											Optional
										</span>
									) : null}
									{complete ? (
										<IconCircleCheck
											className="size-4 text-[var(--success)]"
											stroke={1.8}
										/>
									) : null}
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
			<div
				className="onboarding-content-scroll mx-auto grid min-h-0 w-full max-w-5xl place-items-start overflow-y-auto px-3 py-3 pb-6 sm:px-4 sm:py-4 sm:pb-8 min-[760px]:px-5 min-[760px]:py-5 min-[760px]:pb-10 xl:px-6 2xl:px-8 2xl:py-5"
				ref={contentRef}
			>
				{children}
			</div>
		</main>
	);
}
