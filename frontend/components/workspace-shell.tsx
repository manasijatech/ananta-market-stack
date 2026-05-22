"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
    IconBook,
    IconBellRinging,
    IconExternalLink,
    IconBrain,
    IconLayoutDashboard,
    IconListCheck,
    IconLogout,
    IconMenu2,
    IconMessageCircle,
    IconNews,
    IconRoute,
    IconSettings2,
    IconWallet
} from "@tabler/icons-react";
import type { TablerIcon } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { EVENTS, Joyride, STATUS, type EventData, type Step, type TooltipRenderProps } from "react-joyride";
import { AlertNotificationsTray } from "@/components/alerts/alert-notifications-tray";
import { BrandLogo } from "@/components/brand-logo";
import { useSession } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

type NavItem = {
    href: string;
    label: string;
    icon: TablerIcon;
    external?: boolean;
};

const navGroups: { label: string; items: NavItem[] }[] = [
    {
        label: "MAIN",
        items: [
            { href: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard },
            { href: "/broker-connections", label: "Broker Connections", icon: IconWallet },
            { href: "/watchlists", label: "Watchlists", icon: IconListCheck }
        ]
    },
    {
        label: "INTELLIGENCE",
        items: [
            { href: "/market-intelligence", label: "Market Intelligence", icon: IconNews },
            { href: "/broker-chat", label: "Broker Chat", icon: IconMessageCircle },
            { href: "/llm-usage", label: "LLM Usage", icon: IconBrain },
            { href: "/alerts-workspace", label: "Alerts Workspace", icon: IconBellRinging },
            { href: "/alert-channels", label: "Alert Channels", icon: IconRoute }
        ]
    },
    {
        label: "SETTINGS",
        items: [
            { href: "/system-config", label: "System Config", icon: IconSettings2 },
            { href: "/docs", label: "Docs", icon: IconBook, external: true }
        ]
    }
];

const navItems = navGroups.flatMap((group) => group.items);
const ONBOARDING_STORAGE_KEY = "market-stack-joyride-broker-system-config-alpha-guide-v2-complete";
const ONBOARDING_PHASE_STORAGE_KEY = "market-stack-joyride-broker-system-config-alpha-guide-v2-phase";
const ONBOARDING_PHASE_BROKER_SELECTOR = "broker-selector";
const ONBOARDING_PHASE_WAITING_FOR_ACTIVE_BROKER = "waiting-for-active-broker";
const ONBOARDING_PHASE_ALPHA_API = "alpha-api";
const ACTIVE_BROKER_TARGET = '[data-onboarding="active-broker-ready"]';
const BROKER_SELECTOR_TARGET = '[data-onboarding="broker-selector"]';
const ALPHA_API_TARGET = '[data-onboarding="manasija-alpha-api-input-section"]';

type OnboardingStep = Step & {
    route?: string;
    waitForTarget?: boolean;
};

const onboardingSteps: OnboardingStep[] = [
    {
        target: '[data-onboarding="broker-connections-nav"]',
        title: "Broker Connections",
        content: (
            <div className="grid gap-3 text-left">
                <p>Start here to connect and manage broker accounts for portfolio and live data access.</p>
                <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm">
                    Add your first broker connection before enabling broker chat, alerts, or live data workflows.
                </p>
            </div>
        ),
        placement: "right",
        skipBeacon: true,
        spotlightPadding: 6
    },
    {
        target: '[data-onboarding="add-broker-action"]',
        route: "/broker-connections",
        title: "Add Broker",
        content: (
            <div className="grid gap-3 text-left">
                <p>Use this action to start connecting your broker account.</p>
                <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm">
                    The next screen asks for the broker and the required credentials.
                </p>
            </div>
        ),
        placement: "bottom",
        skipBeacon: true,
        spotlightPadding: 8
    },
    {
        target: BROKER_SELECTOR_TARGET,
        route: "/broker-connections/new",
        title: "Choose Broker",
        content: (
            <div className="grid gap-3 text-left">
                <p>Select the broker you want to connect from this list.</p>
                <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm">
                    The credential form on the right changes based on the broker selected here.
                </p>
            </div>
        ),
        placement: "right",
        skipBeacon: true,
        spotlightPadding: 8
    },
    {
        target: ACTIVE_BROKER_TARGET,
        title: "Broker Active",
        content: (
            <div className="grid gap-3 text-left">
                <p>This broker is verified and has an active session, so the workspace can use broker-backed data.</p>
                <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm">
                    Next, open System Config from the Settings section.
                </p>
            </div>
        ),
        placement: "bottom",
        skipBeacon: true,
        spotlightPadding: 8,
        waitForTarget: true
    },
    {
        target: '[data-onboarding="system-config-nav"]',
        title: "System Config",
        content: (
            <div className="grid gap-3 text-left">
                <p>Use this Settings navigation item after your broker connection is active.</p>
                <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm">
                    The next step will take you to the Alpha API credential section.
                </p>
            </div>
        ),
        placement: "right",
        skipBeacon: true,
        spotlightPadding: 6
    },
    {
        target: ALPHA_API_TARGET,
        route: "/system-config",
        title: "Manasija Alpha API",
        content: (
            <div className="grid gap-3 text-left">
                <p>Add or replace the Manasija Alpha API key here.</p>
                <p className="border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm">
                    This enables Alpha-backed market intelligence, metadata, announcements, concalls, and summaries.
                </p>
            </div>
        ),
        placement: "bottom",
        skipBeacon: true,
        spotlightPadding: 6
    }
];

function isNavItemActive(pathname: string, href: string) {
    if (href === "/dashboard") {
        return pathname === "/dashboard";
    }
    if (href === "/market-intelligence") {
        return pathname.startsWith("/market-intelligence");
    }
    if (href === "/broker-connections") {
        return pathname === "/broker-connections" || pathname.startsWith("/broker-connections/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name?: string | null, email?: string | null) {
    const source = name?.trim() || email?.split("@")[0] || "MS";
    return source
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
}

function NavigationGroups({ pathname, closeOnSelect = false }: { pathname: string; closeOnSelect?: boolean }) {
    return (
        <nav className="grid gap-1" aria-label="Primary navigation">
            {navGroups.map((group, groupIndex) => (
                <div className="grid gap-1" key={group.label}>
                    {groupIndex > 0 ? <Separator className="my-2" /> : null}
                    <div className="px-3 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {group.label}
                    </div>
                    {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isNavItemActive(pathname, item.href);
                        const link = (
                            <Link
                                className={[
                                    "flex h-10 min-w-0 items-center gap-3 border-l-2 px-3 text-sm font-semibold uppercase tracking-[0.04em] transition-colors duration-100 ease-out",
                                    active
                                        ? "border-l-primary text-primary"
                                        : "border-l-transparent text-muted-foreground hover:border-l-primary/50 hover:text-foreground"
                                ].join(" ")}
                                data-onboarding={
                                    item.href === "/broker-connections"
                                        ? "broker-connections-nav"
                                        : item.href === "/system-config"
                                          ? "system-config-nav"
                                          : undefined
                                }
                                href={item.href}
                                key={item.href}
                            >
                                <Icon className="size-4 shrink-0" stroke={1.8} />
                                <span className="truncate">{item.label}</span>
                                {item.external ? <IconExternalLink className="size-3 shrink-0" stroke={1.8} /> : null}
                            </Link>
                        );

                        return closeOnSelect ? (
                            <DialogClose asChild key={item.href}>
                                {link}
                            </DialogClose>
                        ) : (
                            link
                        );
                    })}
                </div>
            ))}
        </nav>
    );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, isLoading, signOut } = useSession();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [onboardingActive, setOnboardingActive] = useState(false);
    const [onboardingRun, setOnboardingRun] = useState(false);
    const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
    const [onboardingTargetCheck, setOnboardingTargetCheck] = useState(0);
    const activeSection = useMemo(() => navItems.find((item) => isNavItemActive(pathname, item.href)), [pathname]);

    useEffect(() => {
        if (!isLoading && !user) {
            router.replace("/auth/sign-in");
        }
    }, [isLoading, router, user]);

    useEffect(() => {
        if (isLoading || !user) {
            return;
        }

        if (localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true") {
            const onboardingPhase = localStorage.getItem(ONBOARDING_PHASE_STORAGE_KEY);
            const activeBrokerStepIndex = onboardingSteps.findIndex((step) => step.target === ACTIVE_BROKER_TARGET);
            const brokerSelectorStepIndex = onboardingSteps.findIndex((step) => step.target === BROKER_SELECTOR_TARGET);
            const alphaApiStepIndex = onboardingSteps.findIndex((step) => step.target === ALPHA_API_TARGET);

            setOnboardingActive(true);
            if (
                onboardingPhase === ONBOARDING_PHASE_BROKER_SELECTOR &&
                pathname === "/broker-connections/new" &&
                brokerSelectorStepIndex >= 0
            ) {
                setOnboardingStepIndex(brokerSelectorStepIndex);
                return;
            }
            if (onboardingPhase === ONBOARDING_PHASE_ALPHA_API && alphaApiStepIndex >= 0) {
                setOnboardingStepIndex(alphaApiStepIndex);
                return;
            }
            setOnboardingStepIndex(
                onboardingPhase === ONBOARDING_PHASE_WAITING_FOR_ACTIVE_BROKER && activeBrokerStepIndex >= 0
                    ? activeBrokerStepIndex
                    : 0
            );
        }
    }, [isLoading, pathname, user]);

    useEffect(() => {
        if (!onboardingActive) {
            setOnboardingRun(false);
            return;
        }

        const step = onboardingSteps[onboardingStepIndex];
        if (!step) {
            return;
        }

        if (step.route && pathname !== step.route) {
            setOnboardingRun(false);
            router.push(step.route);
            return;
        }

        const target = document.querySelector(String(step.target));
        if (target) {
            setOnboardingRun(true);
            return;
        }

        setOnboardingRun(false);
        if (step.waitForTarget || onboardingTargetCheck < 12) {
            const timeout = window.setTimeout(
                () => setOnboardingTargetCheck((value) => value + 1),
                step.waitForTarget ? 1200 : 150
            );
            return () => window.clearTimeout(timeout);
        }
    }, [onboardingActive, onboardingStepIndex, onboardingTargetCheck, pathname, router]);

    useEffect(() => {
        setOnboardingTargetCheck(0);
    }, [onboardingStepIndex, pathname]);

    async function handleSignOut() {
        await signOut();
        router.replace("/auth/sign-in");
    }

    function finishOnboarding(nextHref?: string) {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
        localStorage.removeItem(ONBOARDING_PHASE_STORAGE_KEY);
        setOnboardingActive(false);
        setOnboardingRun(false);

        if (nextHref) {
            router.push(nextHref);
        }
    }

    function goToOnboardingStep(nextStepIndex: number) {
        const target = onboardingSteps[nextStepIndex]?.target;
        if (target === BROKER_SELECTOR_TARGET) {
            localStorage.setItem(ONBOARDING_PHASE_STORAGE_KEY, ONBOARDING_PHASE_BROKER_SELECTOR);
        }
        if (target === ACTIVE_BROKER_TARGET) {
            localStorage.setItem(ONBOARDING_PHASE_STORAGE_KEY, ONBOARDING_PHASE_WAITING_FOR_ACTIVE_BROKER);
        }
        if (target === ALPHA_API_TARGET) {
            localStorage.setItem(ONBOARDING_PHASE_STORAGE_KEY, ONBOARDING_PHASE_ALPHA_API);
        }
        setOnboardingRun(false);
        setOnboardingStepIndex(nextStepIndex);

        const route = onboardingSteps[nextStepIndex]?.route;
        if (route && pathname !== route) {
            router.push(route);
        }
    }

    function handleOnboardingEvent(data: EventData) {
        if (data.status === STATUS.SKIPPED) {
            finishOnboarding();
            return;
        }

        if (data.status === STATUS.FINISHED) {
            finishOnboarding();
            return;
        }

        if (data.type === EVENTS.TARGET_NOT_FOUND) {
            setOnboardingRun(false);
        }
    }

    function handleOnboardingPrimary(index: number) {
        let nextStepIndex = index + 1;

        if (onboardingSteps[index]?.target === '[data-onboarding="add-broker-action"]') {
            const readyBroker = document.querySelector(ACTIVE_BROKER_TARGET);
            if (readyBroker) {
                nextStepIndex = onboardingSteps.findIndex((step) => step.target === ACTIVE_BROKER_TARGET);
            }
        }

        if (nextStepIndex < onboardingSteps.length) {
            goToOnboardingStep(nextStepIndex);
            return;
        }

        finishOnboarding();
    }

    function OnboardingTooltip({ index, isLastStep, step, tooltipProps }: TooltipRenderProps) {
        return (
            <div
                {...tooltipProps}
                aria-labelledby="onboarding-tooltip-title"
                className="react-joyride__tooltip"
                style={step.styles.tooltip}
            >
                <div style={step.styles.tooltipContainer}>
                    {step.title ? (
                        <h4 id="onboarding-tooltip-title" style={step.styles.tooltipTitle}>
                            {step.title}
                        </h4>
                    ) : null}
                    <div style={step.styles.tooltipContent}>{step.content}</div>
                </div>
                <div style={step.styles.tooltipFooter}>
                    <div style={step.styles.tooltipFooterSpacer}>
                        {!isLastStep ? (
                            <button
                                onClick={() => finishOnboarding()}
                                style={step.styles.buttonSkip}
                                type="button"
                            >
                                Skip
                            </button>
                        ) : null}
                    </div>
                    <button
                        data-action="primary"
                        onClick={() => handleOnboardingPrimary(index)}
                        style={step.styles.buttonPrimary}
                        type="button"
                    >
                        {isLastStep ? "Done" : "Next"}
                    </button>
                </div>
            </div>
        );
    }

    if (isLoading || !user) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="border-l-2 border-primary px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Checking session...
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
            <Joyride
                key={`onboarding-${onboardingStepIndex}`}
                continuous
                onEvent={handleOnboardingEvent}
                options={{
                    arrowColor: "var(--popover)",
                    backgroundColor: "var(--popover)",
                    buttons: ["skip", "primary"],
                    overlayColor: "rgb(0 0 0 / 0.48)",
                    overlayClickAction: false,
                    primaryColor: "var(--primary)",
                    scrollDuration: 180,
                    scrollOffset: 130,
                    showProgress: true,
                    spotlightRadius: 0,
                    textColor: "var(--popover-foreground)",
                    zIndex: 120
                }}
                run={onboardingRun}
                scrollToFirstStep
                stepIndex={onboardingStepIndex}
                steps={onboardingSteps}
                styles={{
                    tooltip: {
                        border: "1px solid var(--border)",
                        borderRadius: 0,
                        boxShadow: "0 18px 48px rgb(0 0 0 / 0.24)"
                    },
                    tooltipContent: {
                        fontSize: 14,
                        lineHeight: 1.55,
                        padding: "10px 0 14px"
                    },
                    tooltipTitle: {
                        fontSize: 18,
                        fontWeight: 800
                    }
                }}
                tooltipComponent={OnboardingTooltip}
            />
            <div className="fixed inset-x-0 top-0 z-[80] h-[3px] bg-primary" />
            <header className="fixed inset-x-0 top-0 z-[70] border-b border-border bg-background pt-[3px] min-[980px]:hidden">
                <div className="flex min-h-16 items-center justify-between gap-3 px-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                            <DialogTrigger asChild>
                                <Button
                                    aria-label="Open navigation"
                                    className="size-9"
                                    size="icon"
                                    type="button"
                                    variant="outline"
                                >
                                    <IconMenu2 className="size-4" stroke={1.8} />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-[min(22rem,calc(100vw-1.5rem))] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
                                <DialogHeader className="border-b border-border px-5 py-5 pr-16">
                                    <DialogTitle className="sr-only">Workspace navigation</DialogTitle>
                                    <BrandLogo imageClassName="h-10 w-48 max-w-full" />
                                </DialogHeader>
                                <div className="min-h-0 overflow-y-auto px-3 py-4">
                                    <NavigationGroups closeOnSelect pathname={pathname} />
                                </div>
                                <div className="border-t border-border p-3">
                                    <div className="flex items-center gap-3 px-2 py-2">
                                        <span className="flex size-8 shrink-0 items-center justify-center !rounded-full border border-border bg-secondary font-mono text-[11px] font-bold text-secondary-foreground">
                                            {initials(user.name, user.email)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
                                            {user.email}
                                        </span>
                                        <Button
                                            aria-label="Sign out"
                                            className="size-8 shrink-0 text-muted-foreground hover:text-primary"
                                            onClick={handleSignOut}
                                            size="icon"
                                            type="button"
                                            variant="outline"
                                        >
                                            <IconLogout className="size-4" stroke={1.8} />
                                        </Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                        <div className="min-w-0">
                            <BrandLogo imageClassName="h-9 w-40" />
                            <div className="mt-0.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                {activeSection?.label ?? "Workspace"}
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <AlertNotificationsTray />
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <aside className="hidden border-border bg-background min-[980px]:fixed min-[980px]:inset-y-0 min-[980px]:left-0 min-[980px]:flex min-[980px]:w-[252px] min-[980px]:overflow-hidden">
                <div className="flex h-full w-full flex-col border-r border-border">
                    <div className="flex h-18 items-center border-b border-border px-5 min-[980px]:h-20">
                        <BrandLogo imageClassName="h-10 w-48" />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                        <NavigationGroups pathname={pathname} />
                    </div>
                    <div className="mt-auto border-t border-border p-3">
                        <div className="flex items-center gap-3 px-2 py-2">
                            <span className="flex size-8 shrink-0 items-center justify-center !rounded-full border border-border bg-secondary font-mono text-[11px] font-bold text-secondary-foreground">
                                {initials(user.name, user.email)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
                                {user.email}
                            </span>
                            <Button
                                aria-label="Sign out"
                                className="size-8 shrink-0 text-muted-foreground hover:text-primary"
                                onClick={handleSignOut}
                                size="icon"
                                type="button"
                                variant="outline"
                            >
                                <IconLogout className="size-4" stroke={1.8} />
                            </Button>
                        </div>
                    </div>
                </div>
            </aside>

            <div className="min-[980px]:pl-[252px]">
                <header className="fixed right-0 top-0 z-[70] hidden border-b border-border bg-background px-5 py-4 min-[760px]:px-8 min-[980px]:left-[252px] min-[980px]:flex min-[980px]:h-20 min-[980px]:items-center min-[980px]:px-10 min-[980px]:py-0">
                    <div className="flex w-full flex-col gap-4 min-[860px]:flex-row min-[860px]:items-center min-[860px]:justify-between">
                        <nav className="hidden flex-wrap items-center gap-x-5 gap-y-2 min-[860px]:flex">
                            {navItems.map((item) => {
                                const active = isNavItemActive(pathname, item.href);
                                return (
                                    <Link
                                        className={
                                            active
                                                ? "text-sm font-semibold uppercase tracking-[0.06em] text-primary"
                                                : "text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"
                                        }
                                        href={item.href}
                                        key={item.href}
                                    >
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                        <div className="flex flex-wrap items-center gap-3 self-start min-[860px]:ml-auto min-[860px]:self-auto">
                            <AlertNotificationsTray />
                            <ThemeToggle />
                        </div>
                    </div>
                </header>
                <div className="min-w-0 px-4 pb-6 pt-[calc(4rem+1.5rem+3px)] min-[760px]:px-8 min-[980px]:px-10 min-[980px]:pb-10 min-[980px]:pt-[7.5rem]">
                    {children}
                </div>
            </div>
        </main>
    );
}
