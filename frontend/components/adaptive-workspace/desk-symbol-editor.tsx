"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashEquitySymbol, uniqueCashSymbols } from "@/hooks/use-desk-data";
import { searchDefaultBrokerInstruments } from "@/service/actions/broker";
import type { InstrumentSearchRow } from "@/service/types/broker";

function hasDerivativeField(value: unknown): boolean {
    if (value == null) return false;
    const text = String(value).trim();
    if (!text) return false;
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric === 0) return false;
    return true;
}

function isDeskSearchRow(row: InstrumentSearchRow): boolean {
    if (hasDerivativeField(row.expiry) || hasDerivativeField(row.strike) || hasDerivativeField(row.option_type)) {
        return false;
    }
    const exchange = (row.exchange || "").toUpperCase();
    if (["NFO", "BFO", "MCX", "CDS"].includes(exchange)) return false;
    const symbol = `${row.symbol} ${row.trading_symbol || ""}`.toUpperCase();
    if (/\b(FUT|CE|PE)\b/.test(symbol)) return false;
    return Boolean(cashEquitySymbol(row.symbol || row.trading_symbol || ""));
}

function DeskSymbolChips({ symbols }: { symbols: string[] }) {
    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {symbols.length ? (
                symbols.map((symbol) => (
                    <Badge key={symbol} size="sm" variant="outline">
                        {symbol}
                    </Badge>
                ))
            ) : (
                <span className="text-[11px] text-muted-foreground">Desk list empty</span>
            )}
        </div>
    );
}

export function DeskSymbolEditor({
    onChange,
    readOnly = false,
    symbols
}: {
    onChange: (symbols: string[]) => void;
    readOnly?: boolean;
    symbols: string[];
}) {
    if (readOnly) {
        return <DeskSymbolChips symbols={symbols} />;
    }
    return <DeskSymbolEditorInteractive onChange={onChange} symbols={symbols} />;
}

function DeskSymbolEditorInteractive({
    onChange,
    symbols
}: {
    onChange: (symbols: string[]) => void;
    symbols: string[];
}) {
    const listId = useId();
    const wrapRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState("");
    const [replacing, setReplacing] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [menuBox, setMenuBox] = useState<{ left: number; top: number; width: number } | null>(null);

    function syncMenuBox() {
        const node = wrapRef.current;
        if (!node) return;
        const box = node.getBoundingClientRect();
        setMenuBox({ left: box.left, top: box.bottom + 4, width: Math.max(box.width, 280) });
    }

    const symbolKey = symbols.join("|");

    useEffect(() => {
        const query = draft.trim();
        if (query.length < 1) {
            setSuggestions([]);
            setOpen(false);
            setSearchError(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        const handle = window.setTimeout(() => {
            void searchDefaultBrokerInstruments({ limit: 20, q: query })
                .then((rows) => {
                    if (cancelled) return;
                    const present = new Set(symbolKey.split("|").filter(Boolean));
                    const seen = new Set<string>();
                    const next: InstrumentSearchRow[] = [];
                    for (const row of rows) {
                        if (!isDeskSearchRow(row)) continue;
                        const symbol = cashEquitySymbol(row.symbol || row.trading_symbol || "");
                        if (!symbol || seen.has(symbol)) continue;
                        if (!replacing && present.has(symbol)) continue;
                        if (replacing && symbol === replacing) continue;
                        seen.add(symbol);
                        next.push({ ...row, symbol });
                    }
                    setSuggestions(next.slice(0, 8));
                    setActiveIndex(0);
                    setSearchError(null);
                    setOpen(true);
                    syncMenuBox();
                })
                .catch((caught) => {
                    if (cancelled) return;
                    setSuggestions([]);
                    setSearchError(caught instanceof Error ? caught.message : "Could not search symbols.");
                    setOpen(true);
                    syncMenuBox();
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }, 160);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [draft, replacing, symbolKey]);

    useEffect(() => {
        if (!open) return;
        syncMenuBox();
        const onReposition = () => syncMenuBox();
        window.addEventListener("resize", onReposition);
        window.addEventListener("scroll", onReposition, true);
        return () => {
            window.removeEventListener("resize", onReposition);
            window.removeEventListener("scroll", onReposition, true);
        };
    }, [open]);

    function commit(values: string[]) {
        const incoming = uniqueCashSymbols(values);
        if (!incoming.length) return;
        if (replacing) {
            const without = symbols.filter((item) => item !== replacing);
            onChange(uniqueCashSymbols([...without, ...incoming]).slice(0, 40));
        } else {
            onChange(uniqueCashSymbols([...symbols, ...incoming]).slice(0, 40));
        }
        setDraft("");
        setReplacing(null);
        setSuggestions([]);
        setOpen(false);
        setSearchError(null);
    }

    function remove(symbol: string) {
        onChange(symbols.filter((item) => item !== symbol));
        if (replacing === symbol) {
            setReplacing(null);
            setDraft("");
        }
    }

    function beginReplace(symbol: string) {
        setReplacing(symbol);
        setDraft(symbol);
        setOpen(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
    }

    const typed = cashEquitySymbol(draft);
    const canAddTyped = Boolean(typed) && (replacing ? typed !== replacing : !symbols.includes(typed));

    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-0 py-0">
            {symbols.map((symbol) => (
                <span className="inline-flex items-center" key={symbol}>
                    <Badge
                        className="h-6 gap-0 rounded-r-none pr-1"
                        onClick={() => beginReplace(symbol)}
                        size="sm"
                        variant={replacing === symbol ? "default" : "outline"}
                    >
                        {symbol}
                    </Badge>
                    <button
                        aria-label={`Remove ${symbol} from desk list`}
                        className="inline-flex h-6 items-center rounded-r-sm border border-l-0 border-input bg-background px-1 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remove(symbol)}
                        type="button"
                    >
                        ×
                    </button>
                </span>
            ))}
            <div className="relative min-w-[9.5rem] flex-1" ref={wrapRef}>
                <Input
                    aria-autocomplete="list"
                    aria-controls={listId}
                    aria-expanded={open}
                    aria-label={replacing ? `Replace ${replacing}` : "Search desk symbol"}
                    autoComplete="off"
                    className="h-7 font-mono uppercase"
                    onBlur={() => {
                        window.setTimeout(() => setOpen(false), 120);
                    }}
                    onChange={(event) => setDraft(event.target.value.toUpperCase())}
                    onFocus={() => {
                        if (draft.trim()) {
                            setOpen(true);
                            syncMenuBox();
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((value) => Math.min(value + 1, Math.max(suggestions.length - 1, 0)));
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((value) => Math.max(value - 1, 0));
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            if (suggestions[activeIndex]) {
                                commit([suggestions[activeIndex].symbol]);
                                return;
                            }
                            commit(draft.split(/[\s,]+/));
                        }
                        if (event.key === "Escape") {
                            setOpen(false);
                            setReplacing(null);
                        }
                    }}
                    placeholder={replacing ? `Replace ${replacing}` : "Search symbol"}
                    ref={inputRef}
                    role="combobox"
                    value={draft}
                />
                {open && menuBox && typeof document !== "undefined"
                    ? createPortal(
                          <ul
                              className="fixed z-[80] max-h-64 overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg"
                              id={listId}
                              role="listbox"
                              style={{ left: menuBox.left, top: menuBox.top, width: menuBox.width }}
                          >
                              {loading ? (
                                  <li className="px-2.5 py-2 text-xs text-muted-foreground">Searching…</li>
                              ) : null}
                              {suggestions.map((row, index) => (
                                  <li key={`${row.symbol}:${row.exchange ?? ""}:${row.account_id ?? ""}`}>
                                      <button
                                          aria-selected={index === activeIndex}
                                          className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs ${
                                              index === activeIndex ? "bg-secondary" : "hover:bg-secondary/70"
                                          }`}
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => commit([row.symbol])}
                                          onMouseEnter={() => setActiveIndex(index)}
                                          role="option"
                                          type="button"
                                      >
                                          <span className="min-w-0">
                                              <span className="block font-mono font-semibold">{row.symbol}</span>
                                              <span className="block truncate text-[11px] text-muted-foreground">
                                                  {[row.name, row.trading_symbol].filter(Boolean).join(" · ")}
                                              </span>
                                          </span>
                                          {row.exchange ? (
                                              <Badge size="sm" variant="outline">
                                                  {row.exchange}
                                              </Badge>
                                          ) : null}
                                      </button>
                                  </li>
                              ))}
                              {!loading && canAddTyped && !suggestions.some((row) => row.symbol === typed) ? (
                                  <li>
                                      <button
                                          className="flex w-full px-2.5 py-1.5 text-left text-xs hover:bg-secondary"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => commit([typed])}
                                          type="button"
                                      >
                                          Add {typed}
                                      </button>
                                  </li>
                              ) : null}
                              {!loading && !suggestions.length ? (
                                  <li className="px-2.5 py-2 text-xs text-muted-foreground">
                                      {searchError || "No matching instruments found."}
                                  </li>
                              ) : null}
                          </ul>,
                          document.body
                      )
                    : null}
            </div>
            <Button
                onClick={() => commit(draft.split(/[\s,]+/))}
                size="xs"
                type="button"
                variant="outline"
            >
                {replacing ? "Replace" : "Add"}
            </Button>
            <p className="text-[11px] text-muted-foreground">{symbols.length}/40</p>
        </div>
    );
}
