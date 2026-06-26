import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type AuthSplitLayoutProps = {
    children: React.ReactNode;
    className?: string;
    panel?: "default" | "approval";
};

export function ApprovalNoticeCard({ className }: { className?: string }) {
    return (
        <div className={cn("rounded-lg border border-border bg-muted/40 px-4 py-3", className)}>
            <p className="text-sm font-medium text-foreground">Administrator approval required</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Your account will be available after an administrator approves your request.
            </p>
        </div>
    );
}

export function AuthSplitLayout({ children, className, panel = "default" }: AuthSplitLayoutProps) {
    return (
        <main className="relative flex min-h-svh items-center justify-center bg-background p-4 sm:p-6 md:p-10">
            <div className="absolute right-5 top-5 z-10">
                <ThemeToggle />
            </div>

            <div className={cn("flex w-full max-w-[420px] flex-col gap-6", className)}>
                <Link href="/" className="inline-flex self-start font-medium">
                    <BrandLogo imageClassName="text-base" />
                </Link>

                {panel === "approval" ? <ApprovalNoticeCard className="hidden lg:block" /> : null}

                <div className="rounded-lg border border-border bg-card p-6 sm:p-8">{children}</div>
            </div>
        </main>
    );
}
