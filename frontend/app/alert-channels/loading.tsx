import { HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function AlertChannelsLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton titleWidth="w-80" />}>
            <div className="grid gap-6">
                <section className="border border-border p-4">
                    <Skeleton className="mb-3 h-5 w-44" />
                    <div className="grid gap-3 min-[960px]:grid-cols-[1fr_auto]">
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10 w-36" />
                    </div>
                </section>
                {Array.from({ length: 2 }).map((_, index) => (
                    <section className="border border-border p-4" key={index}>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <Skeleton className="h-5 w-24" />
                            <div className="flex gap-3">
                                <Skeleton className="h-5 w-20" />
                                <Skeleton className="h-5 w-20" />
                            </div>
                        </div>
                        <div className="grid gap-3">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                            {index === 1 ? <Skeleton className="h-10 w-full" /> : null}
                        </div>
                        <div className="mt-4 flex gap-3">
                            <Skeleton className="h-10 w-20" />
                            <Skeleton className="h-10 w-20" />
                        </div>
                    </section>
                ))}
            </div>
        </LoadingShell>
    );
}
