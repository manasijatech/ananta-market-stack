import { HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function BrokerChatLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton />}>
            <div className="grid min-h-[620px] gap-4 min-[1080px]:grid-cols-[300px_minmax(0,1fr)]">
                <div className="border border-border p-4">
                    <div className="h-9 w-28 animate-pulse bg-secondary" />
                    <div className="mt-5 grid gap-3">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <div className="h-16 animate-pulse border border-border bg-secondary/60" key={index} />
                        ))}
                    </div>
                </div>
                <div className="border border-border p-4">
                    <div className="h-12 animate-pulse bg-secondary/60" />
                    <div className="mt-5 h-[420px] animate-pulse bg-secondary/40" />
                    <div className="mt-5 h-24 animate-pulse bg-secondary/60" />
                </div>
            </div>
        </LoadingShell>
    );
}
