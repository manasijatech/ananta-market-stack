import { Skeleton } from "@/components/ui/skeleton";

/**
 * Standalone (non-workspace-shell) skeleton for the pending-approval page, so
 * navigating here never falls through to the full-screen root brand splash.
 */
export default function PendingApprovalLoading() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
            <section className="w-full max-w-xl rounded-lg border border-border bg-card p-8">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="mt-8 h-4 w-32" />
                <Skeleton className="mt-3 h-9 w-3/4" />
                <Skeleton className="mt-4 h-16 w-full" />
                <div className="mt-8 flex gap-3">
                    <Skeleton className="h-10 w-28" />
                    <Skeleton className="h-10 w-24" />
                </div>
            </section>
        </main>
    );
}
