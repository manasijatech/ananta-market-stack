import { WatchlistsSkeleton } from "@/components/ui/loading-skeletons";
import { Shell } from "@/components/brokers/shell";

export default function WatchlistsLoading() {
    return (
        <Shell>
            <WatchlistsSkeleton />
        </Shell>
    );
}
