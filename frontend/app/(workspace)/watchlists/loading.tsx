import { HeaderSkeleton, LoadingShell, WatchlistsSkeleton } from "@/components/ui/loading-skeletons";

export default function WatchlistsLoading() {
    return (
        <LoadingShell
            header={
                <HeaderSkeleton
                    descriptionWidth="w-full max-w-xl"
                    titleWidth="w-48"
                />
            }
        >
            <WatchlistsSkeleton />
        </LoadingShell>
    );
}
