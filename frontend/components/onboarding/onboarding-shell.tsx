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

function isStepReachable(
	slug: OnboardingStepSlug,
	readiness: WorkspaceSetupReadiness,
) {
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

	return (
		<main className="app-page-background grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
			<header className="app-page-background">
				<div className="mx-auto flex min-h-12 w-full max-w-5xl items-center px-5  min-[760px]:min-h-14">
					<BrandLogo imageClassName="text-[1.35rem]" />
				</div>
				<div className="mx-auto w-full max-w-5xl px-4 min-[760px]:px-5 xl:px-6 2xl:px-8">
					<div
						className="flex min-w-0 items-center gap-2 overflow-hidden py-1"
						data-onboarding-ledger
					>
						{steps.map((step, index) => {
							const complete = isStepComplete(step.slug, readiness);
							const current = index === currentIndex;
							const reachable = isStepReachable(step.slug, readiness);
							const lineComplete = index < currentIndex;
							const content = (
								<span
									className={cn(
										"inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full px-2.5 text-sm font-medium transition-colors",
										current
											? "border border-primary bg-primary/10 text-foreground"
											: complete
												? "text-foreground"
												: "text-muted-foreground",
										!reachable && "opacity-50",
									)}
								>
									<span
										className={cn(
											"grid size-5 shrink-0 place-items-center rounded-full border text-[11px] leading-none",
											current
												? "border-primary bg-primary text-primary-foreground"
												: complete
													? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
													: "border-border bg-background text-muted-foreground",
										)}
									>
										{complete ? (
											<IconCircleCheck className="size-3.5" stroke={2} />
										) : current ? (
											"●"
										) : (
											index + 1
										)}
									</span>
									<span
										className={cn(
											"truncate",
											!current && "hidden min-[760px]:inline",
										)}
									>
										{step.label}
									</span>
									{step.optional ? (
										<span
											className={cn(
												"hidden text-xs text-muted-foreground",
												current && "min-[900px]:inline",
											)}
										>
											Optional
										</span>
									) : null}
								</span>
							);

							return (
								<div
									className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
									key={step.slug}
								>
									{reachable ? (
										<Link
											className="min-w-0 shrink-0"
											href={onboardingStepPath(step.slug)}
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
											className="min-w-0 shrink-0"
											ref={(node) => registerStep(step.slug, node)}
										>
											{content}
										</span>
									)}
									{index < steps.length - 1 ? (
										<span
											aria-hidden="true"
											className={cn(
												"h-px min-w-4 flex-1 bg-border",
												lineComplete && "bg-[var(--success)]",
											)}
										/>
									) : null}
								</div>
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
