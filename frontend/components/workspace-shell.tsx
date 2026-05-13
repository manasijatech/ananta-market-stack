"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BookOpen, LayoutDashboard, ListChecks, Siren, WalletCards, Waypoints } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { AlertNotificationsTray } from "@/components/alerts/alert-notifications-tray";
import { useSession } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
 { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
 { href: "/brokers", label: "Brokers", icon: WalletCards },
 { href: "/watchlists", label: "Watchlists", icon: ListChecks },
 { href: "/alerts", label: "Alerts", icon: Siren },
 { href: "/alert-channels", label: "Alert Channels", icon: Waypoints },
 { href: "/brokers/docs", label: "Docs", icon: BookOpen }
];

function isNavItemActive(pathname: string, href: string) {
 if (href === "/brokers") {
 return pathname === "/brokers" || (pathname.startsWith("/brokers/") && !pathname.startsWith("/brokers/docs"));
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

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
 const pathname = usePathname();
 const router = useRouter();
 const { user, isLoading, signOut } = useSession();

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
 <div className="border-l-2 border-primary px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Checking session...</div>
 </main>
 );
 }

 return (
 <main className="min-h-screen bg-background text-foreground">
 <div className="fixed inset-x-0 top-0 z-50 h-[3px] bg-primary" />
 <aside className="border-b border-border bg-background min-[980px]:fixed min-[980px]:inset-y-0 min-[980px]:left-0 min-[980px]:w-[252px] min-[980px]:border-b-0 min-[980px]:border-r">
 <div className="flex h-full flex-col">
 <div className="flex h-18 items-center gap-3 border-b border-border px-5 min-[980px]:h-20">
 <span className="font-mono text-[13px] font-bold text-primary">MS</span>
 <span className="text-sm font-semibold uppercase tracking-[0.08em]">Market Stack</span>
 </div>
 <nav className="flex gap-1 px-3 pb-4 min-[980px]:flex-col" aria-label="Primary navigation">
 {navItems.map((item) => {
 const Icon = item.icon;
 const active = isNavItemActive(pathname, item.href);
 return (
 <Link
 className={[
 "flex h-10 items-center gap-3 border-l-2 px-3 text-sm font-semibold uppercase tracking-[0.04em] transition-colors duration-100 ease-out",
 active
 ? "border-l-primary text-foreground"
 : "border-l-transparent text-muted-foreground hover:border-l-primary/50 hover:text-foreground"
 ].join(" ")}
 href={item.href}
 key={item.href}
 >
 <Icon className="size-4" strokeWidth={1.8} />
 {item.label}
 </Link>
 );
 })}
 </nav>
 </div>
 </aside>

 <div className="min-[980px]:pl-[252px]">
 <header className="border-b border-border px-5 py-4 min-[760px]:px-8 min-[980px]:px-10">
 <div className="flex flex-col gap-4 min-[860px]:flex-row min-[860px]:items-center min-[860px]:justify-between">
 <nav className="hidden items-center gap-6 min-[860px]:flex">
 {navItems.map((item) => {
 const active = isNavItemActive(pathname, item.href);
 return (
 <Link
 className={active ? "text-sm font-semibold uppercase tracking-[0.06em] text-primary" : "text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"}
 href={item.href}
 key={item.href}
 >
 {item.label}
 </Link>
 );
 })}
 </nav>
 <div className="flex flex-wrap items-center gap-3 self-start min-[860px]:self-auto">
 <AlertNotificationsTray />
 <ThemeToggle />
 <span className="flex size-8 items-center justify-center border border-border bg-secondary font-mono text-[11px] font-bold text-secondary-foreground">
 {initials(user.name, user.email)}
 </span>
 <span className="max-w-[220px] truncate text-xs font-semibold text-muted-foreground">
 {user.email}
 </span>
 <button
 className="inline-flex h-9 cursor-pointer items-center justify-center border border-input bg-transparent px-3 text-xs font-semibold uppercase tracking-[0.08em] transition-colors duration-100 ease-out hover:border-primary hover:text-primary"
 onClick={handleSignOut}
 type="button"
 >
 Sign out
 </button>
 </div>
 </div>
 </header>
 <div className="px-5 py-8 min-[760px]:px-8 min-[980px]:px-10 min-[980px]:py-10">{children}</div>
 </div>
 </main>
 );
}
