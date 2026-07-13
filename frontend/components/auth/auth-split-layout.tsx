import Link from "next/link";
import { IconChartLine, IconLock, IconPlugConnected } from "@tabler/icons-react";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type AuthSplitLayoutProps = {
    children: React.ReactNode;
    className?: string;
    panel?: "default" | "approval";
};

const highlights = [
    { icon: IconPlugConnected, label: "Multi-broker connections" },
    { icon: IconChartLine, label: "Live market data & alerts" },
    { icon: IconLock, label: "Encrypted credentials" }
] as const;

export function ApprovalNoticeCard({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "rounded-xl border border-border bg-card p-6 shadow-inner",
                className
            )}
        >
            <p className="text-base font-semibold text-foreground">Administrator approval required</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Your account will be available after an administrator approves your request.
            </p>
        </div>
    );
}

function AuthVisualPanel({ variant }: { variant: "default" | "approval" }) {
    return (
        <div className="relative hidden flex-col justify-between border-l border-border bg-sidebar p-6 lg:flex lg:p-8">
            <div className="relative flex flex-1 flex-col items-center justify-center">
                {variant === "approval" ? (
                    <ApprovalNoticeCard className="w-full max-w-sm" />
                ) : (
                    <div className="flex w-full max-w-xs flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center shadow-inner">
                        <BrandLogo imageClassName="text-lg" />
                        <p className="mt-3 max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
                            Your workspace for broker APIs, portfolio data, and trading alerts.
                        </p>
                    </div>
                )}
            </div>

            <ul className="relative space-y-2.5">
                {highlights.map(({ icon: Icon, label }) => (
                    <li key={label} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
                            <Icon className="size-3.5" stroke={1.75} />
                        </div>
                        {label}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function AuthSplitLayout({ children, className, panel = "default" }: AuthSplitLayoutProps) {
    return (
        <main className="relative flex min-h-svh items-center justify-center bg-background p-4 text-foreground sm:p-6 md:p-10">
            <div className="absolute right-5 top-5 z-10">
                <ThemeToggle />
            </div>

            <div
                className={cn(
                    "grid w-full max-w-[800px] overflow-hidden rounded-xl border border-border bg-card lg:min-h-[500px] lg:grid-cols-2",
                    className
                )}
            >
                <div className="flex flex-col p-6 sm:p-8">
                    <Link href="/" className="mb-6 inline-flex self-start font-medium">
                        <BrandLogo imageClassName="text-sm" />
                    </Link>

                    <div className="flex flex-1 flex-col justify-center">{children}</div>
                </div>

                <AuthVisualPanel variant={panel} />
            </div>
        </main>
    );
}
