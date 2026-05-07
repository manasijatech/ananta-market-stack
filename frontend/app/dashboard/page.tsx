"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  LayoutDashboard,
  Plus,
  WalletCards
} from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "MS";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, active: true },
  { href: "/brokers", label: "Brokers", icon: WalletCards, active: false },
  { href: "/brokers/docs", label: "Docs", icon: BookOpen, active: false }
];

const quickAccessItems = [
  {
    href: "/brokers",
    icon: WalletCards,
    label: "Broker Connections",
    description: "Connect and verify broker accounts for quotes and portfolio sync.",
    action: "Manage"
  },
  {
    href: "/brokers/docs",
    icon: BookOpen,
    label: "Integration Guides",
    description: "Use broker-specific setup steps before saving production credentials.",
    action: "Docs"
  }
];

export default function DashboardPage() {
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
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <div
          className="flex aspect-square w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-black text-primary-foreground"
          aria-hidden="true"
        >
          MS
        </div>
        <p className="font-bold text-muted-foreground">Checking session...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <aside className="border-b bg-background min-[900px]:fixed min-[900px]:inset-y-0 min-[900px]:left-0 min-[900px]:w-[240px] min-[900px]:border-b-0 min-[900px]:border-r">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center gap-3 px-5 min-[900px]:h-20">
            <span className="font-mono text-[13px] font-bold text-foreground" aria-hidden="true">
              MS
            </span>
            <span className="text-sm font-bold leading-none text-foreground">Market Stack</span>
          </div>
          <nav className="flex gap-1 px-3 pb-3 min-[900px]:flex-col" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  className={[
                    "flex h-9 items-center gap-3 border-l-2 px-3 text-sm font-semibold transition-colors duration-100 ease-out",
                    item.active
                      ? "border-l-primary text-foreground"
                      : "border-l-transparent text-muted-foreground hover:text-foreground"
                  ].join(" ")}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="size-4" aria-hidden="true" strokeWidth={1.75} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="min-[900px]:pl-[240px]">
        <header className="border-b px-5 py-4 min-[720px]:px-8 min-[900px]:px-10">
          <div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
            <nav className="hidden items-center gap-6 min-[760px]:flex" aria-label="Workspace links">
              <Link
                className="text-sm font-semibold text-foreground transition-colors duration-100 ease-out"
                href="/dashboard"
              >
                Dashboard
              </Link>
              <Link
                className="text-sm font-semibold text-muted-foreground transition-colors duration-100 ease-out hover:text-foreground"
                href="/brokers"
              >
                Brokers
              </Link>
              <Link
                className="text-sm font-semibold text-muted-foreground transition-colors duration-100 ease-out hover:text-foreground"
                href="/brokers/docs"
              >
                Docs
              </Link>
            </nav>

            <div className="flex items-center gap-3 self-start min-[760px]:self-auto">
              <ThemeToggle />
              <span className="flex size-7 items-center justify-center rounded-full border bg-secondary text-[11px] font-bold text-secondary-foreground">
                {getInitials(user.name, user.email)}
              </span>
              <span className="max-w-[220px] truncate text-xs font-semibold text-muted-foreground">
                {user.email}
              </span>
              <span className="size-2 rounded-full bg-primary" aria-label="Active session" />
              <button
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-semibold text-foreground transition-colors duration-100 ease-out hover:bg-accent hover:text-accent-foreground"
                onClick={handleSignOut}
                type="button"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="px-5 pb-16 pt-10 min-[720px]:px-8 min-[900px]:px-10 min-[900px]:pt-20">
          <div className="mb-12 flex flex-col justify-between gap-6 min-[820px]:flex-row min-[820px]:items-end">
            <div>
              <p className="mb-3 text-[13px] font-extrabold uppercase tracking-[0.08em] text-primary">
                Workspace
              </p>
              <h1 className="text-[clamp(34px,5vw,52px)] font-bold leading-none text-foreground">Dashboard</h1>
              <p className="mt-4 max-w-2xl text-muted-foreground">
                Monitor broker connections, session readiness, and setup tasks from one place.
              </p>
            </div>

            <div className="flex items-center gap-5">
              <Link
                className="text-sm font-semibold text-muted-foreground transition-colors duration-100 ease-out hover:text-foreground"
                href="/brokers"
              >
                View brokers
              </Link>
              <Link
                className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-semibold transition-colors duration-100 ease-out hover:bg-accent hover:text-accent-foreground"
                href="/brokers/new"
              >
                <Plus className="size-4" aria-hidden="true" strokeWidth={1.75} />
                Add broker
              </Link>
            </div>
          </div>

          <section aria-labelledby="quick-access-title" className="mb-12">
            <h2
              className="mb-3 text-[13px] font-extrabold uppercase tracking-[0.08em] text-primary"
              id="quick-access-title"
            >
              Quick access
            </h2>
            <div className="border-y">
              {quickAccessItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Link
                    className={[
                      "grid min-h-16 grid-cols-[16px_1fr_auto] items-center gap-x-4 gap-y-1 py-4 text-foreground transition-colors duration-100 ease-out hover:bg-accent/50 min-[760px]:grid-cols-[16px_220px_1fr_auto]",
                      index > 0 ? "border-t" : ""
                    ].join(" ")}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                    <span className="text-sm font-bold">{item.label}</span>
                    <span className="col-start-2 text-sm text-muted-foreground min-[760px]:col-start-auto">
                      {item.description}
                    </span>
                    <span className="col-start-3 row-span-2 row-start-1 flex items-center gap-2 justify-self-end text-sm font-semibold text-muted-foreground min-[760px]:col-start-auto min-[760px]:row-span-1 min-[760px]:row-start-auto">
                      {item.action}
                      <ArrowRight className="size-4" aria-hidden="true" strokeWidth={1.75} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}
