"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashEquitySymbol, uniqueCashSymbols } from "@/hooks/use-desk-data";
import { searchDefaultBrokerInstruments } from "@/service/actions/broker";
import type { InstrumentSearchRow } from "@/service/types/broker";

function isCashSearchRow(row: InstrumentSearchRow): boolean {
    const symbol = cashEquitySymbol(row.symbol || row.trading_symbol || "");
    if (!symbol) return false;
    if (row.expiry || row.strike || row.option_type) return false;
    const exchange = (row.exchange || "").toUpperCase();
    if (["NFO", "BFO", "MCX", "CDS"].includes(exchange)) return false;
    return true;
}

export function DeskSymbolEditor({
    onChange,
    symbols
}: {
    onChange: (symbols: string[]) => void;
    symbols: string[];
}) {
    const [draft, setDraft] = useState("");
    const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [open, setOpen] = useState(false);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const query = draft.trim();
        if (query.length < 1) {
            setSuggestions([]);
            return;
        }
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            void searchDefaultBrokerInstruments({ limit: 12, q: query })
                .then((rows) => {
                    const seen = new Set<string>();
                    const next: InstrumentSearchRow[] = [];
                    for (const row of rows) {
                        if (!isCashSearchRow(row)) continue;
                        const symbol = cashEquitySymbol(row.symbol || row.trading_symbol || "");
                        if (!symbol || seen.has(symbol) || symbols.includes(symbol)) continue;
                        seen.add(symbol);
                        next.push({ ...row, symbol });
                    }
                    setSuggestions(next.slice(0, 8));
                    setOpen(true);
                })
                .catch(() => {
                    setSuggestions([]);
                });
        }, 180);
        return () => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, [draft, symbols]);

    function add(values: string[]) {
        const next = uniqueCashSymbols([...symbols, ...values]).slice(0, 40);
        onChange(next);
        setDraft("");
        setSuggestions([]);
        setOpen(false);
    }

    return (
        <div className="relative flex flex-wrap items-center gap-1.5 px-2 py-1.5">
            <Input
                aria-label="Search or add desk symbol"
                autoComplete="off"
                className="h-7 w-44"
                onChange={(event) => setDraft(event.target.value)}
                onFocus={() => {
                    if (suggestions.length) setOpen(true);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        if (suggestions[0]) {
                            add([suggestions[0].symbol]);
                            return;
                        }
                        add(draft.split(/[\s,]+/));
                    }
                    if (event.key === "Escape") setOpen(false);
                }}
                placeholder="Search symbol"
                value={draft}
            />
            <Button onClick={() => add(draft.split(/[\s,]+/))} size="xs" type="button" variant="outline">
                Add
            </Button>
            <p className="text-[11px] text-muted-foreground">{symbols.length}/40 desk</p>
            {open && suggestions.length ? (
                <ul className="absolute left-2 top-9 z-20 w-64 overflow-hidden rounded-md border border-border/60 bg-popover py-1 shadow-md">
                    {suggestions.map((row) => (
                        <li key={`${row.symbol}:${row.exchange ?? ""}`}>
                            <button
                                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-secondary"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => add([row.symbol])}
                                type="button"
                            >
                                <span className="font-semibold">{row.symbol}</span>
                                <span className="truncate text-muted-foreground">
                                    {[row.exchange, row.name || row.trading_symbol].filter(Boolean).join(" · ")}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
