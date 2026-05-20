import { WatchlistsSkeleton } from "@/components/ui/loading-skeletons";
import { Shell } from "@/components/brokers/ui";

export default function WatchlistsLoading() {
    return (
        <Shell>
            <WatchlistsSkeleton />
        </Shell>
    );
}
