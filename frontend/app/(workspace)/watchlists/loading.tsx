import { HeaderSkeleton, LoadingShell, WatchlistsSkeleton } from "@/components/ui/loading-skeletons";

export default function WatchlistsLoading() {
    return (
        <LoadingShell
            header={
                <HeaderSkeleton
                    descriptionWidth="w-full max-w-xl"
                    eyebrowWidth="w-36"
                    titleWidth="w-48"
                />
            }
        >
            <WatchlistsSkeleton />
        </LoadingShell>
    );
}
