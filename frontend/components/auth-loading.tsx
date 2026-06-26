import { Skeleton } from "@/components/ui/skeleton";

export function AuthLoading({ mode = "sign-in" }: { mode?: "sign-in" | "sign-up" }) {
    return (
        <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
            <div className="flex w-full max-w-sm flex-col gap-6">
                <div className="flex items-center justify-center gap-2">
                    <Skeleton className="size-6 rounded-md" />
                    <Skeleton className="h-5 w-28" />
                </div>

                <div className="rounded-lg border border-border bg-card p-6">
                    <div className="space-y-2 text-center">
                        <Skeleton className="mx-auto h-6 w-36" />
                        <Skeleton className="mx-auto h-4 w-56" />
                    </div>

                    <div className="mt-6 grid gap-4">
                        {mode === "sign-up" ? (
                            <div>
                                <Skeleton className="mb-2 h-4 w-16" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                        ) : null}
                        <div>
                            <Skeleton className="mb-2 h-4 w-16" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                        <div>
                            <Skeleton className="mb-2 h-4 w-20" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="mx-auto h-4 w-48" />
                    </div>
                </div>

                <Skeleton className="mx-auto h-4 w-72" />
            </div>
        </main>
    );
}
