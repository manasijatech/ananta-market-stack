import { HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
    return (
        <LoadingShell
            header={<HeaderSkeleton eyebrowWidth="w-24" titleWidth="w-72" descriptionWidth="w-full max-w-3xl" />}
        >
            <section className="grid gap-4 min-[960px]:grid-cols-3">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div className="border border-border p-5" key={index}>
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="mt-4 h-4 w-full" />
                        <Skeleton className="mt-2 h-4 w-4/5" />
                    </div>
                ))}
            </section>
        </LoadingShell>
    );
}
