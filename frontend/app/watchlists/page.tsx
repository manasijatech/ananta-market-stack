import { WatchlistsManager } from "@/components/watchlists/watchlists-manager";
import { Shell } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getWatchlists } from "@/service/actions/watchlist";
import type { Watchlist } from "@/service/types/watchlist";

export default async function WatchlistsPage() {
 let watchlists: Watchlist[] = [];
 let error = "";

 try {
 watchlists = await getWatchlists();
 } catch (caught) {
 error = caught instanceof Error ? caught.message : "Could not load watchlists.";
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

 <WatchlistsManager initialWatchlists={watchlists} />
 </Shell>
 );
}
