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
    const activeSection = useMemo(() => navItems.find((item) => isNavItemActive(pathname, item.href)), [pathname]);

    useEffect(() => {
        if (!isLoading && !user) {
            router.replace("/auth/sign-in");
        }
    }, [isLoading, router, user]);

    async function handleSignOut() {
        await signOut();
        router.replace("/auth/sign-in");
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
