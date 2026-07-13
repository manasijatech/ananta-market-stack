import { Skeleton } from "@/components/ui/skeleton";

export default function LlmUsageLoading() {
    return (
        <>
            <div className="mb-6 border-b border-border pb-5">
                <Skeleton className="mb-3 h-3 w-24" />
                <Skeleton className="h-7 w-48 max-w-full" />
                <Skeleton className="mt-2 h-4 w-[520px] max-w-full" />
            </div>
            <div className="grid gap-5">
                <Skeleton className="h-28 w-full rounded-md" />
                <div className="grid gap-3 min-[900px]:grid-cols-2 min-[1180px]:grid-cols-4">
                    <Skeleton className="h-28 w-full rounded-md" />
                    <Skeleton className="h-28 w-full rounded-md" />
                    <Skeleton className="h-28 w-full rounded-md" />
                    <Skeleton className="h-28 w-full rounded-md" />
                </div>
                <div className="grid gap-3 min-[900px]:grid-cols-3">
                    <Skeleton className="h-24 w-full rounded-md" />
                    <Skeleton className="h-24 w-full rounded-md" />
                    <Skeleton className="h-24 w-full rounded-md" />
                </div>
                <Skeleton className="h-52 w-full rounded-md" />
                <Skeleton className="h-64 w-full rounded-md" />
            </div>
        </>
    );
}
