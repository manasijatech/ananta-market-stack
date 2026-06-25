import { Shell } from "@/components/brokers/shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function LlmUsageLoading() {
    return (
        <Shell>
            <div className="mb-8 border-b border-border pb-6">
                <Skeleton className="mb-3 h-4 w-28" />
                <Skeleton className="h-14 w-72 max-w-full" />
                <Skeleton className="mt-4 h-5 w-[620px] max-w-full" />
            </div>
            <div className="grid gap-5">
                <Skeleton className="h-36 w-full" />
                <div className="grid gap-3 min-[760px]:grid-cols-2 min-[1180px]:grid-cols-4">
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 w-full" />
                </div>
                <Skeleton className="h-72 w-full" />
                <div className="grid gap-5 min-[1180px]:grid-cols-2">
                    <Skeleton className="h-80 w-full" />
                    <Skeleton className="h-80 w-full" />
                </div>
            </div>
        </Shell>
    );
}
