"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
    IconBook,
    IconBellRinging,
    IconExternalLink,
    IconBrain,
    IconLayoutGrid,
    IconListCheck,
    IconLogout,
    IconMenu2,
    IconMessageCircle,
    IconNews,
    IconSettings2,
    IconShieldLock,
    IconWallet
} from "@tabler/icons-react";
import type { TablerIcon } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { AlertNotificationsTray } from "@/components/alerts/alert-notifications-tray";
import { BrandLogo } from "@/components/brand-logo";
import { GithubStarButton } from "@/components/github-star-button";
import {
    HEATMAP_FILTER_CHANGE_EVENT,
    HEATMAP_FILTER_STORAGE_KEY,
    isHeatmapScope,
    parseStoredHeatmapFilters
} from "@/components/heatmap/heatmap-filter-state";
import { useSession } from "@/components/session-provider";
import { UpdateAvailableBanner } from "@/components/system/update-available-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageContainer } from "@/components/ui/page-container";
import { hasRbacPermission } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import type { RbacPrincipal } from "@/service/types/rbac";

type NavItem = {
    href: string;
    label: string;
    icon: TablerIcon;
    external?: boolean;
    requiredPermission?: string;
    hideWhenUnauthorized?: boolean;
};

const navGroups: { label: string; items: NavItem[] }[] = [
    {
        label: "Main",
        items: [
            { href: "/broker-connections", label: "Broker Connections", icon: IconWallet },
            { href: "/watchlists", label: "Watchlists", icon: IconListCheck }
        ]
    },
    {
        label: "Intelligence",
        items: [
            { href: "/market-intelligence", label: "Market Intelligence", icon: IconNews },
            { href: "/heatmap", label: "Heatmap", icon: IconLayoutGrid },
            { href: "/broker-chat", label: "Broker Chat", icon: IconMessageCircle },
            { href: "/alerts-workspace", label: "Alerts Workspace", icon: IconBellRinging }
        ]
    },
    {
        label: "Settings",
        items: [
            { href: "/settings", label: "Settings", icon: IconSettings2 },
            {
                href: "/llm-usage",
                label: "LLM Usage",
                icon: IconBrain,
                requiredPermission: "settings.view_llm_usage",
                hideWhenUnauthorized: true
            },
            {
                href: "/settings/access",
                label: "Access",
                icon: IconShieldLock,
                requiredPermission: "workspace.manage_members",
                hideWhenUnauthorized: true
            },
            { href: "/docs", label: "Docs", icon: IconBook, external: true }
        ]
    }
];

function isNavItemActive(pathname: string, href: string) {
    if (href === "/settings") {
        return pathname === "/settings";
    }
    if (href === "/settings/access") {
        return pathname === "/settings/access" || pathname.startsWith("/settings/access/");
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

function visibleNavGroups(principal: RbacPrincipal | null | undefined) {
    return navGroups
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => {
                if (!item.requiredPermission) {
                    return true;
                }
                if (hasRbacPermission(principal, item.requiredPermission)) {
                    return true;
                }
                return !item.hideWhenUnauthorized;
            })
        }))
        .filter((group) => group.items.length > 0);
}

function storedHeatmapHref() {
    try {
        const stored = parseStoredHeatmapFilters(localStorage.getItem(HEATMAP_FILTER_STORAGE_KEY) ?? undefined);
        if (!isHeatmapScope(stored.scope)) return "/heatmap";

        const params = new URLSearchParams({ scope: stored.scope });
        if (stored.scope === "watchlist" && stored.watchlistId) {
            params.set("watchlist_id", stored.watchlistId);
        }
        if (stored.scope === "portfolio_holdings" && stored.accountId) {
            params.set("account_id", stored.accountId);
        }
        return `/heatmap?${params.toString()}`;
    } catch {
        return "/heatmap";
    }
}

function NavigationGroups({
    pathname,
    principal,
    closeOnSelect = false
}: {
    pathname: string;
    principal?: RbacPrincipal | null;
    closeOnSelect?: boolean;
}) {
    const groups = visibleNavGroups(principal);
    const [heatmapHref, setHeatmapHref] = useState("/heatmap");

    useEffect(() => {
        const syncHeatmapHref = () => setHeatmapHref(storedHeatmapHref());
        syncHeatmapHref();
        window.addEventListener(HEATMAP_FILTER_CHANGE_EVENT, syncHeatmapHref);
        return () => window.removeEventListener(HEATMAP_FILTER_CHANGE_EVENT, syncHeatmapHref);
    }, []);

    return (
        <nav className="flex flex-col gap-6 py-2" aria-label="Primary navigation">
            {groups.map((group) => (
                <div className="flex flex-col gap-0.5" key={group.label}>
                    <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                    {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isNavItemActive(pathname, item.href);
                        const href = item.href === "/heatmap" ? heatmapHref : item.href;
                        const link = (
                            <Link
                                className={cn(
                                    "flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors",
                                    active
                                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                                )}
                                href={href}
                                key={item.href}
                            >
                                <Icon className="size-4 shrink-0 opacity-80" stroke={1.75} />
                                <span className="truncate">{item.label}</span>
                                {item.external ? (
                                    <IconExternalLink className="ml-auto size-3.5 shrink-0 opacity-50" stroke={1.75} />
                                ) : null}
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

function isFullHeightPath(pathname: string) {
    return (
        pathname === "/watchlists" ||
        pathname === "/heatmap" ||
        pathname === "/settings" ||
        pathname.startsWith("/broker-chat")
    );
}

export function WorkspaceShell({
    children,
    principal = null
}: {
    children: React.ReactNode;
    principal?: RbacPrincipal | null;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, isLoading, signOut } = useSession();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const fullHeight = isFullHeightPath(pathname);

    useEffect(() => {
        if (!isLoading && !user) {
            router.replace("/auth/sign-in");
        }
    }, [isLoading, router, user]);

    useEffect(() => {
        if (!isLoading && user && principal && principal.status !== "active" && pathname !== "/pending-approval") {
            router.replace("/pending-approval");
        }
    }, [isLoading, pathname, principal, router, user]);

    async function handleSignOut() {
        await signOut();
        router.replace("/auth/sign-in");
    }

    if (isLoading || !user) {
        return (
            <main className="app-page-background flex min-h-screen items-center justify-center">
                <div className="border-l-2 border-primary px-4 py-2 text-sm font-medium text-muted-foreground">
                    Checking session...
                </div>
            </main>
        );
    }

    return (
        <main
            className={cn(
                "app-page-background min-h-screen overflow-x-hidden",
                fullHeight && "min-[980px]:h-dvh min-[980px]:overflow-hidden"
            )}
        >
            <header className="app-page-background fixed inset-x-0 top-0 z-[70] border-b border-border min-[980px]:hidden">
                <div className="flex min-h-16 items-center justify-between gap-3 px-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                            <DialogTrigger asChild>
                                <Button
                                    aria-label="Open navigation"
                                    className="size-9 shrink-0"
                                    size="icon"
                                    type="button"
                                    variant="outline"
                                >
                                    <IconMenu2 className="size-4" stroke={1.8} />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-[min(22rem,calc(100vw-1.5rem))] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-muted p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
                                <DialogHeader className="border-b border-border px-5 py-5 pr-16">
                                    <DialogTitle className="sr-only">Workspace navigation</DialogTitle>
                                    <BrandLogo imageClassName="max-w-full text-[1.5rem]" />
                                </DialogHeader>
                                <div className="min-h-0 overflow-y-auto px-3 py-4">
                                    <NavigationGroups closeOnSelect pathname={pathname} principal={principal} />
                                </div>
                                <div className="border-t border-border p-2">
                                    <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                                            {initials(user.name, user.email)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
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
                        <BrandLogo compact className="min-w-0 overflow-hidden" imageClassName="text-base sm:text-[1.35rem]" />
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <GithubStarButton />
                        <AlertNotificationsTray />
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <aside className="hidden border-border bg-muted min-[980px]:fixed min-[980px]:inset-y-0 min-[980px]:left-0 min-[980px]:flex min-[980px]:w-60 min-[980px]:overflow-hidden">
                <div className="flex h-full w-full flex-col border-r border-border">
                    <div className="flex h-16 items-center px-4">
                        <BrandLogo imageClassName="text-[1.35rem]" />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                        <NavigationGroups pathname={pathname} principal={principal} />
                    </div>
                    <div className="mt-auto border-t border-border p-2">
                        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                                {initials(user.name, user.email)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{user.email}</span>
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

            <div className="min-[980px]:pl-60">
                <header className="app-page-background fixed right-0 top-0 z-[70] hidden border-b border-border px-5 py-4 min-[760px]:px-8 min-[980px]:left-60 min-[980px]:flex min-[980px]:h-16 min-[980px]:items-center min-[980px]:px-8 min-[980px]:py-0">
                    <div className="flex w-full items-center justify-end">
                        <div className="flex flex-wrap items-center gap-2">
                            <GithubStarButton />
                            <AlertNotificationsTray />
                            <ThemeToggle />
                        </div>
                    </div>
                </header>
                <div
                    className={cn(
                        "min-w-0 px-3 pb-8 pt-[calc(3.75rem+0.75rem+env(safe-area-inset-top))] sm:px-4 sm:pb-10 sm:pt-[calc(4.5rem+0.75rem+env(safe-area-inset-top))] min-[760px]:px-8 min-[980px]:px-8 min-[980px]:pb-10 min-[980px]:pt-5",
                        fullHeight &&
                            "min-[980px]:flex min-[980px]:h-dvh min-[980px]:flex-col min-[980px]:overflow-hidden",
                        pathname === "/settings" &&
                            "min-[980px]:mt-16 min-[980px]:h-[calc(100vh-4rem)] min-[980px]:overflow-hidden min-[980px]:pb-0 min-[980px]:pt-0"
                    )}
                >
                    <UpdateAvailableBanner />
                    {pathname === "/settings" ? (
                        children
                    ) : (
                        <PageContainer
                            className={cn(fullHeight && "flex min-h-0 flex-1 flex-col")}
                        >
                            {children}
                        </PageContainer>
                    )}
                </div>
            </div>
        </main>
    );
}
