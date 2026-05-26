import { HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
    return (
        <LoadingShell
            header={<HeaderSkeleton eyebrowWidth="w-24" titleWidth="w-72" descriptionWidth="w-full max-w-3xl" />}
        >
            <section className="grid gap-3 border border-border p-4 min-[820px]:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div className="flex items-center gap-3" key={index}>
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                ))}
            </section>
            <section className="mt-5 grid gap-4 min-[1180px]:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div className="grid gap-4 border border-border p-5" key={index}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="w-full max-w-md">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="mt-3 h-7 w-56" />
                                <Skeleton className="mt-3 h-4 w-full" />
                                <Skeleton className="mt-2 h-4 w-4/5" />
                            </div>
                            <Skeleton className="size-10" />
                        </div>
                        <div className="grid gap-3 min-[560px]:grid-cols-3">
                            {Array.from({ length: 6 }).map((_, statIndex) => (
                                <div className="border border-border px-3 py-3" key={statIndex}>
                                    <Skeleton className="h-3 w-20" />
                                    <Skeleton className="mt-3 h-7 w-16" />
                                </div>
                            ))}
                        </div>
                        <Skeleton className="h-10 w-full" />
                    </div>
                ))}
            </section>
        </LoadingShell>
    );
}
