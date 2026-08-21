"use client";

import { IconChevronDown } from "@tabler/icons-react";
import { DeskSymbolEditor } from "@/components/adaptive-workspace/desk-symbol-editor";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SimpleSelect } from "@/components/ui/simple-select";
import {
    componentScope,
    explicitSymbols,
    stringListParam,
    stringParam,
    uniqueCashSymbols,
    uniqueWatchlistSymbols,
    universeSymbols
} from "@/hooks/use-desk-data";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";
import type { Watchlist } from "@/service/types/watchlist";

type Props = {
    allowDesk?: boolean;
    allowMultiSymbol?: boolean;
    allowWatchlist?: boolean;
    component: WorkspaceComponent;
    extraSymbols?: string[];
    onPatch: (props: Record<string, unknown>) => void;
    selectedWatchlist: Watchlist | null;
    symbol: string;
    watchlists: Watchlist[];
};

const MULTI_SYMBOL_CAP = 40;

export function readHiddenSymbols(component: WorkspaceComponent): string[] {
    return Array.from(
        new Set(
            stringListParam(component.props, ["hiddenSymbols"])
                .concat(stringListParam(component.data?.params, ["hiddenSymbols"]))
                .map((item) => item.trim().toUpperCase())
                .filter(Boolean)
        )
    );
}

export function toggleHiddenSymbol(hidden: string[], symbol: string): string[] {
    const needle = symbol.trim().toUpperCase();
    if (!needle) return hidden;
    return hidden.includes(needle) ? hidden.filter((item) => item !== needle) : [...hidden, needle];
}

export function withHiddenAtBottom<T>(
    items: T[],
    hidden: ReadonlySet<string>,
    symbolOf: (item: T) => string
): T[] {
    const visible: T[] = [];
    const buried: T[] = [];
    for (const item of items) {
        if (hidden.has(symbolOf(item).trim().toUpperCase())) buried.push(item);
        else visible.push(item);
    }
    return [...visible, ...buried];
}

export function WidgetScopeBar({
    allowDesk = true,
    allowMultiSymbol = false,
    allowWatchlist = true,
    component,
    extraSymbols = [],
    onPatch,
    selectedWatchlist,
    symbol,
    watchlists
}: Props) {
    const { patchUniverse, spec } = useAdaptiveWorkspace();
    const deskSymbols = uniqueCashSymbols(extraSymbols.length ? extraSymbols : universeSymbols(spec));
    const scope = componentScope(component);
    const effectiveScope = !allowWatchlist && scope === "watchlist" ? "symbol" : scope;
    const symbols = uniqueWatchlistSymbols(watchlists);
    for (const value of extraSymbols) {
        const next = value.trim().toUpperCase();
        if (next && !symbols.some((item) => item.value === next)) symbols.unshift({ label: next, value: next });
    }
    const current = symbol.toUpperCase();
    const selected = Array.from(
        new Set(explicitSymbols(component).map((item) => item.toUpperCase()).filter(Boolean))
    );
    if (current && !symbols.some((item) => item.value === current)) {
        symbols.unshift({ label: current, value: current });
    }
    for (const value of selected) {
        if (value && !symbols.some((item) => item.value === value)) {
            symbols.unshift({ label: value, value });
        }
    }
    const multiLabel = selected.length
        ? selected.length === 1
            ? selected[0]
            : `${selected[0]} +${selected.length - 1}`
        : "Symbols";

    function patchSymbols(next: string[]) {
        const unique = Array.from(new Set(next.map((item) => item.trim().toUpperCase()).filter(Boolean))).slice(
            0,
            MULTI_SYMBOL_CAP
        );
        onPatch({
            scope: "symbol",
            symbol: unique[0] ?? "",
            symbols: unique
        });
    }

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
            {allowWatchlist || allowDesk ? (
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
                        if (next === "desk") {
                            onPatch({ scope: "desk", symbol: "", symbols: [], watchlistId: "" });
                            return;
                        }
                        const initial = selected.length
                            ? selected
                            : current || symbols[0]?.value
                              ? [current || symbols[0].value]
                              : [];
                        onPatch({
                            scope: "symbol",
                            symbol: initial[0] ?? "",
                            symbols: initial
                        });
                    }}
                    options={[
                        ...(allowDesk ? [{ label: "Desk list", value: "desk" }] : []),
                        ...(allowWatchlist ? [{ label: "Watchlist", value: "watchlist" }] : []),
                        { label: "Symbol", value: "symbol" }
                    ]}
                    size="sm"
                    value={effectiveScope === "watchlist" && !allowWatchlist ? "symbol" : effectiveScope}
                />
            ) : null}
            {effectiveScope === "watchlist" && allowWatchlist ? (
                <SimpleSelect
                    aria-label="Watchlist"
                    className="h-7 min-w-0 flex-1"
                    onValueChange={(watchlistId) => onPatch({ scope: "watchlist", watchlistId, symbol: "", symbols: [] })}
                    options={watchlists.map((item) => ({ label: item.name, value: item.id }))}
                    placeholder="Watchlist"
                    size="sm"
                    value={selectedWatchlist?.id ?? ""}
                />
            ) : effectiveScope === "desk" ? (
                <DeskSymbolEditor onChange={patchUniverse} symbols={deskSymbols} />
            ) : allowMultiSymbol ? (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        aria-label="Symbols"
                        className="inline-flex h-7 min-w-0 flex-1 items-center justify-between gap-1 rounded-lg border border-input bg-background px-2 text-left text-xs"
                        type="button"
                    >
                        <span className="min-w-0 truncate">{multiLabel}</span>
                        <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
                        {symbols.map((item) => {
                            const checked = selected.includes(item.value);
                            return (
                                <DropdownMenuCheckboxItem
                                    checked={checked}
                                    disabled={!checked && selected.length >= MULTI_SYMBOL_CAP}
                                    key={item.value}
                                    onCheckedChange={(next) => {
                                        patchSymbols(next ? [...selected, item.value] : selected.filter((value) => value !== item.value));
                                    }}
                                    onSelect={(event) => event.preventDefault()}
                                >
                                    {item.label}
                                </DropdownMenuCheckboxItem>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
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
        </div>
    );
}

export function scopeHint(component: WorkspaceComponent, watchlistName?: string | null, deskCount = 0) {
    const symbols = explicitSymbols(component);
    const scope = componentScope(component);
    if (scope === "symbol") {
        const primary = stringParam(component.props, ["symbol"]) || symbols[0] || "Symbol";
        return symbols.length > 1 ? `${primary} +${symbols.length - 1}` : primary;
    }
    if (scope === "desk") {
        return deskCount ? `Desk list · ${deskCount}` : "Desk list";
    }
    return watchlistName || (symbols.length ? `${symbols.length} symbols` : "Watchlist");
}
