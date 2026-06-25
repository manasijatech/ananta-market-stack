import { WatchlistsManager } from "@/components/watchlists/watchlists-manager";
import { Shell } from "@/components/brokers/shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSystemConfig } from "@/service/actions/broker";
import { getWatchlists } from "@/service/actions/watchlist";
import type { Watchlist } from "@/service/types/watchlist";

export default async function WatchlistsPage() {
    let watchlists: Watchlist[] = [];
    let hasAlphaApiKey = false;
    let error = "";

    const [watchlistResult, systemConfigResult] = await Promise.allSettled([getWatchlists(), getSystemConfig()]);
    if (watchlistResult.status === "fulfilled") {
        watchlists = watchlistResult.value;
    } else {
        error = watchlistResult.reason instanceof Error ? watchlistResult.reason.message : "Could not load watchlists.";
    }
    if (systemConfigResult.status === "fulfilled") {
        hasAlphaApiKey = systemConfigResult.value.alpha_api.has_api_key;
    } else if (!error) {
        error =
            systemConfigResult.reason instanceof Error
                ? systemConfigResult.reason.message
                : "Could not load Settings.";
    }

    return (
        <Shell>
            {error ? (
                <div className="mb-6">
                    <Alert className="" variant="warning">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                </div>
            ) : null}

            <WatchlistsManager hasAlphaApiKey={hasAlphaApiKey} initialWatchlists={watchlists} />
        </Shell>
    );
}
