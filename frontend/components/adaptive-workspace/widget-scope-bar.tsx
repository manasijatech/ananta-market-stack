"use client";

import { SimpleSelect } from "@/components/ui/simple-select";
import {
    componentScope,
    explicitSymbols,
    stringParam,
    uniqueWatchlistSymbols
} from "@/hooks/use-desk-data";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { Watchlist } from "@/service/types/watchlist";

type Props = {
    allowWatchlist?: boolean;
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
    selectedWatchlist: Watchlist | null;
    symbol: string;
    watchlists: Watchlist[];
};

export function WidgetScopeBar({
    allowWatchlist = true,
    component,
    onPatch,
    selectedWatchlist,
    symbol,
    watchlists
}: Props) {
    const scope = allowWatchlist ? componentScope(component) : "symbol";
    const symbols = uniqueWatchlistSymbols(watchlists);
    const current = symbol.toUpperCase();
    if (current && !symbols.some((item) => item.value === current)) {
        symbols.unshift({ label: current, value: current });
    }

    return (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {allowWatchlist ? (
                <SimpleSelect
                    aria-label="Widget scope"
                    className="h-7 w-[7.25rem]"
                    onValueChange={(next) => {
                        if (next === "watchlist") {
                            onPatch({
                                scope: "watchlist",
                                symbol: "",
                                symbols: [],
                                watchlistId: selectedWatchlist?.id ?? ""
                            });
                            return;
                        }
                        onPatch({
                            scope: "symbol",
                            symbol: current || symbols[0]?.value || "",
                            symbols: current || symbols[0]?.value ? [current || symbols[0].value] : []
                        });
                    }}
                    options={[
                        { label: "Watchlist", value: "watchlist" },
                        { label: "Symbol", value: "symbol" }
                    ]}
                    size="sm"
                    value={scope}
                />
            ) : null}
            {scope === "watchlist" && allowWatchlist ? (
                <SimpleSelect
                    aria-label="Watchlist"
                    className="h-7 min-w-0 flex-1"
                    onValueChange={(watchlistId) => onPatch({ scope: "watchlist", watchlistId, symbol: "", symbols: [] })}
                    options={watchlists.map((item) => ({ label: item.name, value: item.id }))}
                    placeholder="Watchlist"
                    size="sm"
                    value={selectedWatchlist?.id ?? ""}
                />
            ) : (
                <SimpleSelect
                    aria-label="Symbol"
                    className="h-7 min-w-0 flex-1"
                    onValueChange={(next) => onPatch({ scope: "symbol", symbol: next, symbols: [next] })}
                    options={symbols}
                    placeholder="Symbol"
                    size="sm"
                    value={current}
                />
            )}
        </div>
    );
}

export function scopeHint(component: WorkspaceComponent, watchlistName?: string | null) {
    const symbols = explicitSymbols(component);
    if (componentScope(component) === "symbol") {
        return stringParam(component.props, ["symbol"]) || symbols[0] || "Symbol";
    }
    return watchlistName || (symbols.length ? `${symbols.length} symbols` : "Watchlist");
}
