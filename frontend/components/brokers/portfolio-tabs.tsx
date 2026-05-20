"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
    getQuotes,
    getHoldings,
    getOrders,
    getPortfolioFunds,
    getPositions,
    getProfile,
    getTrades
} from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import {
    normalizeFunds,
    normalizeHoldings,
    normalizeOrders,
    normalizePositions,
    normalizeProfile,
    normalizeTrades
} from "@/components/brokers/normalizers";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton as UISkeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FundsResponse, Holding, Order, Position, Profile, Trade } from "@/service/types/broker";

type Tab = "funds" | "orders" | "trades" | "positions" | "holdings";
type TabState = {
    funds?: FundsResponse;
    profile?: Profile;
    orders?: Order[];
    trades?: Trade[];
    positions?: Position[];
    holdings?: Holding[];
};

const tabs: { id: Tab; label: string }[] = [
    { id: "funds", label: "Funds" },
    { id: "orders", label: "Orders" },
    { id: "trades", label: "Trades" },
    { id: "positions", label: "Positions" },
    { id: "holdings", label: "Holdings" }
];

function money(value?: number | null): string {
    if (value === null || value === undefined) {
        return "-";
    }
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function containsSymbol(row: { symbol: string }, filter: string): boolean {
    return row.symbol.toLowerCase().includes(filter.trim().toLowerCase());
}

function Empty({ message }: { message: string }) {
    return <div className="border-y border-dashed border-border py-8 text-center text-muted-foreground">{message}</div>;
}

function Skeleton() {
    return (
        <div className="grid gap-3">
            {[0, 1, 2].map((item) => (
                <UISkeleton className="h-14" key={item} />
            ))}
        </div>
    );
}

export function PortfolioTabs({ accountId, sessionActive }: { accountId: string; sessionActive: boolean }) {
    const [active, setActive] = useState<Tab>("funds");
    const [filter, setFilter] = useState("");
    const [state, setState] = useState<TabState>({});
    const [error, setError] = useState("");
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        if (!sessionActive) {
            return;
        }
        startTransition(async () => {
            try {
                const [fundsRaw, profileRaw] = await Promise.all([getPortfolioFunds(accountId), getProfile(accountId)]);
                setState((current) => ({
                    ...current,
                    funds: normalizeFunds(fundsRaw),
                    profile: normalizeProfile(profileRaw)
                }));
            } catch (caught) {
                setError(parseActionError(caught).message);
            }
        });
    }, [accountId, sessionActive]);

    function load(tab: Tab) {
        setActive(tab);
        setError("");
        if (!sessionActive) {
            return;
        }
        const alreadyLoaded =
            (tab === "funds" && state.funds) ||
            (tab === "orders" && state.orders) ||
            (tab === "trades" && state.trades) ||
            (tab === "positions" && state.positions) ||
            (tab === "holdings" && state.holdings);
        if (alreadyLoaded) {
            return;
        }

        startTransition(async () => {
            try {
                if (tab === "funds") {
                    const [fundsRaw, profileRaw] = await Promise.all([
                        getPortfolioFunds(accountId),
                        getProfile(accountId)
                    ]);
                    setState((current) => ({
                        ...current,
                        funds: normalizeFunds(fundsRaw),
                        profile: normalizeProfile(profileRaw)
                    }));
                } else if (tab === "orders") {
                    const raw = await getOrders(accountId);
                    setState((current) => ({ ...current, orders: normalizeOrders(raw) }));
                } else if (tab === "trades") {
                    const raw = await getTrades(accountId);
                    setState((current) => ({ ...current, trades: normalizeTrades(raw) }));
                } else if (tab === "positions") {
                    const raw = await getPositions(accountId);
                    setState((current) => ({ ...current, positions: normalizePositions(raw) }));
                } else if (tab === "holdings") {
                    const raw = await getHoldings(accountId);
                    const holdings = normalizeHoldings(raw);
                    const quoteResponse = holdings.length
                        ? await getQuotes(accountId, {
                              instruments: holdings.map((holding) => ({
                                  symbol: holding.symbol,
                                  exchange: "NSE",
                                  groww_trading_symbol: holding.symbol
                              }))
                          })
                        : [];
                    const ltpBySymbol = new Map(
                        quoteResponse.map((row) => [String(row.symbol ?? "").toUpperCase(), row.ltp])
                    );
                    const enrichedHoldings = holdings.map((holding) => {
                        const lastPrice = ltpBySymbol.get(holding.symbol.toUpperCase());
                        const averagePrice = holding.average_price;
                        if (lastPrice === undefined || averagePrice === null || averagePrice === undefined) {
                            return {
                                ...holding,
                                last_price: lastPrice ?? holding.last_price
                            };
                        }
                        const pnl = (lastPrice - averagePrice) * holding.quantity;
                        const pnlPercent = averagePrice
                            ? ((lastPrice - averagePrice) / averagePrice) * 100
                            : holding.pnl_percent;
                        return {
                            ...holding,
                            last_price: lastPrice,
                            pnl,
                            pnl_percent: pnlPercent
                        };
                    });
                    setState((current) => ({ ...current, holdings: enrichedHoldings }));
                }
            } catch (caught) {
                setError(parseActionError(caught).message);
            }
        });
    }

    const filteredOrders = useMemo(
        () => (state.orders ?? []).filter((row) => containsSymbol(row, filter)),
        [state.orders, filter]
    );
    const filteredTrades = useMemo(
        () => (state.trades ?? []).filter((row) => containsSymbol(row, filter)),
        [state.trades, filter]
    );
    const filteredPositions = useMemo(
        () => (state.positions ?? []).filter((row) => containsSymbol(row, filter)),
        [state.positions, filter]
    );
    const filteredHoldings = useMemo(
        () => (state.holdings ?? []).filter((row) => containsSymbol(row, filter)),
        [state.holdings, filter]
    );
    const holdingsTotal = filteredHoldings.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
    const hasProfileDetails = Boolean(state.profile?.name || state.profile?.email || state.profile?.broker_user_id);

    return (
        <section className="border-t border-border py-8">
            <div className="sticky top-0 z-10 border-b border-border bg-background/95 py-4 backdrop-blur">
                <div className="flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
                    <Tabs value={active} onValueChange={(value) => load(value as Tab)}>
                        <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
                            {tabs.map((tab) => (
                                <TabsTrigger className="whitespace-nowrap font-extrabold" key={tab.id} value={tab.id}>
                                    {tab.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    {active !== "funds" ? (
                        <Input
                            className="min-[760px]:w-[220px]"
                            onChange={(event) => setFilter(event.target.value)}
                            placeholder="Filter symbol"
                            value={filter}
                        />
                    ) : null}
                </div>
            </div>

            <div className="pt-5">
                {!sessionActive ? (
                    <div className="border-y border-dashed border-border py-8 text-center text-muted-foreground">
                        Connect the broker session first. Portfolio, profile, orders, trades, positions, and holdings
                        load after the access token is active.
                    </div>
                ) : null}

                {error ? (
                    <Alert className="mb-4" variant="warning">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                {sessionActive && isPending ? <Skeleton /> : null}

                {sessionActive && active === "funds" && state.funds ? (
                    <div>
                        <div className="grid gap-3 min-[720px]:grid-cols-4">
                            {[
                                ["Available", state.funds.available],
                                ["Used", state.funds.used],
                                ["Opening", state.funds.opening_balance],
                                ["Total", state.funds.total]
                            ].map(([label, value]) => (
                                <div className="border-t border-border py-4" key={String(label)}>
                                    <span className="text-xs font-extrabold uppercase text-muted-foreground">
                                        {label}
                                    </span>
                                    <strong className="mt-2 block text-2xl">
                                        {money(typeof value === "number" ? value : null)}
                                    </strong>
                                </div>
                            ))}
                        </div>
                        {state.profile && hasProfileDetails ? (
                            <details className="mt-4 border-t border-border pt-4">
                                <summary className="cursor-pointer font-bold">Profile</summary>
                                <dl className="mt-3 grid gap-2 text-sm text-muted-foreground">
                                    <div>Name: {state.profile.name ?? "-"}</div>
                                    <div>Email: {state.profile.email ?? "-"}</div>
                                    <div>Broker user ID: {state.profile.broker_user_id ?? "-"}</div>
                                </dl>
                            </details>
                        ) : null}
                    </div>
                ) : null}

                {sessionActive && active === "orders" && state.orders ? (
                    filteredOrders.length ? (
                        <Table className="min-w-[720px] text-left text-sm">
                            <TableHeader className="text-xs uppercase text-muted-foreground">
                                <TableRow className="border-b-0">
                                    <TableHead className="py-2">Symbol</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Price</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Time</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredOrders.map((row) => (
                                    <TableRow className="border-t border-border" key={row.id}>
                                        <TableCell className="py-3 font-bold">{row.symbol}</TableCell>
                                        <TableCell>{row.action}</TableCell>
                                        <TableCell>{row.quantity}</TableCell>
                                        <TableCell>{money(row.price)}</TableCell>
                                        <TableCell>{row.status}</TableCell>
                                        <TableCell>{row.time ?? "-"}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <Empty message="No orders found." />
                    )
                ) : null}

                {sessionActive && active === "trades" && state.trades ? (
                    filteredTrades.length ? (
                        <Table className="min-w-[680px] text-left text-sm">
                            <TableHeader className="text-xs uppercase text-muted-foreground">
                                <TableRow className="border-b-0">
                                    <TableHead className="py-2">Symbol</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Avg price</TableHead>
                                    <TableHead>Time</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredTrades.map((row) => (
                                    <TableRow className="border-t border-border" key={row.id}>
                                        <TableCell className="py-3 font-bold">{row.symbol}</TableCell>
                                        <TableCell>{row.action}</TableCell>
                                        <TableCell>{row.quantity}</TableCell>
                                        <TableCell>{money(row.avg_price)}</TableCell>
                                        <TableCell>{row.time ?? "-"}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <Empty message="No trades found." />
                    )
                ) : null}

                {sessionActive && active === "positions" && state.positions ? (
                    <div>
                        <Button className="mb-3" disabled type="button" variant="outline">
                            Close all positions
                        </Button>
                        {filteredPositions.length ? (
                            <Table className="min-w-[680px] text-left text-sm">
                                <TableHeader className="text-xs uppercase text-muted-foreground">
                                    <TableRow className="border-b-0">
                                        <TableHead className="py-2">Symbol</TableHead>
                                        <TableHead>Product</TableHead>
                                        <TableHead>Qty</TableHead>
                                        <TableHead>PNL</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredPositions.map((row) => (
                                        <TableRow className="border-t border-border" key={row.id}>
                                            <TableCell className="py-3 font-bold">{row.symbol}</TableCell>
                                            <TableCell>{row.product ?? "-"}</TableCell>
                                            <TableCell>{row.quantity}</TableCell>
                                            <TableCell
                                                className={(row.pnl ?? 0) >= 0 ? "text-primary" : "text-destructive"}
                                            >
                                                {money(row.pnl)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <Empty message="No positions found." />
                        )}
                    </div>
                ) : null}

                {sessionActive && active === "holdings" && state.holdings ? (
                    filteredHoldings.length ? (
                        <Table className="min-w-[760px] text-left text-sm">
                            <TableHeader className="text-xs uppercase text-muted-foreground">
                                <TableRow className="border-b-0">
                                    <TableHead className="py-2">Symbol</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Avg</TableHead>
                                    <TableHead>LTP</TableHead>
                                    <TableHead>PNL</TableHead>
                                    <TableHead>PNL %</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredHoldings.map((row) => (
                                    <TableRow className="border-t border-border" key={row.id}>
                                        <TableCell className="py-3 font-bold">{row.symbol}</TableCell>
                                        <TableCell>{row.quantity}</TableCell>
                                        <TableCell>{money(row.average_price)}</TableCell>
                                        <TableCell>{money(row.last_price)}</TableCell>
                                        <TableCell
                                            className={(row.pnl ?? 0) >= 0 ? "text-primary" : "text-destructive"}
                                        >
                                            {money(row.pnl)}
                                        </TableCell>
                                        <TableCell>{row.pnl_percent ?? "-"}</TableCell>
                                    </TableRow>
                                ))}
                                <TableRow className="border-t-2 border-border font-bold">
                                    <TableCell className="py-3" colSpan={4}>
                                        Total PNL
                                    </TableCell>
                                    <TableCell className={holdingsTotal >= 0 ? "text-primary" : "text-destructive"}>
                                        {money(holdingsTotal)}
                                    </TableCell>
                                    <TableCell />
                                </TableRow>
                            </TableBody>
                        </Table>
                    ) : (
                        <Empty message="No holdings found." />
                    )
                ) : null}
            </div>
        </section>
    );
}
