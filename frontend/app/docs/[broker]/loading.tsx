import { Shell } from "@/components/brokers/shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function BrokerGuideLoading() {
    return (
        <Shell>
            <article className="mx-auto max-w-4xl">
                <header className="mb-10 flex flex-col gap-6 border-b pb-8 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between">
                    <div className="flex gap-4">
                        <Skeleton className="mt-1 h-12 w-20" />
                        <div className="min-w-0 flex-1">
                            <Skeleton className="mb-3 h-4 w-28" />
                            <Skeleton className="h-10 w-full max-w-xl" />
                            <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
                            <Skeleton className="mt-2 h-4 w-full max-w-lg" />
                        </div>
                    </div>
                    <Skeleton className="h-10 w-36 shrink-0" />
                </header>
                <div>
                    <Skeleton className="mb-4 h-7 w-64" />
                    <Skeleton className="mb-3 h-4 w-full" />
                    <Skeleton className="mb-3 h-4 w-5/6" />
                    <Skeleton className="mb-8 mt-5 h-56 w-full" />
                    <Skeleton className="mb-4 h-6 w-52" />
                    <Skeleton className="mb-3 h-4 w-full" />
                    <Skeleton className="mb-3 h-4 w-4/5" />
                </div>
            </article>
        </Shell>
    );
}
