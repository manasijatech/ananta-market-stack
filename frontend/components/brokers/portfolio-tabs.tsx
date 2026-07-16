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
import { Inbox, KeyRound, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardPanel
} from "@/components/ui/card";
import {
    Empty as EmptyState,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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
    return (
        <EmptyState className="border-y border-dashed border-border py-8">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Inbox />
                </EmptyMedia>
                <EmptyTitle className="text-base">Nothing to show</EmptyTitle>
                <EmptyDescription>{message}</EmptyDescription>
            </EmptyHeader>
        </EmptyState>
    );
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
    const fundMetrics = state.funds
        ? [
              ["Available", state.funds.available],
              ["Used", state.funds.used],
              ["Opening", state.funds.opening_balance],
              ["Total", state.funds.total]
          ].filter((item): item is [string, number] => typeof item[1] === "number")
        : [];

    if (!sessionActive) {
        return (
            <CardFrame>
                <CardFrameHeader>
                    <CardFrameTitle className="text-lg font-semibold">Broker data</CardFrameTitle>
                    <CardFrameDescription>
                        Funds, orders, trades, positions, and holdings appear after the broker session is active.
                    </CardFrameDescription>
                </CardFrameHeader>
                <Card>
                    <EmptyState className="py-12">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <KeyRound />
                            </EmptyMedia>
                            <EmptyTitle>Activate the broker session first</EmptyTitle>
                            <EmptyDescription>
                                Use the session setup above to connect this broker before loading portfolio data.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button
                                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                                type="button"
                                variant="outline"
                            >
                                Go to session setup
                            </Button>
                        </EmptyContent>
                    </EmptyState>
                </Card>
            </CardFrame>
        );
    }

    return (
        <CardFrame>
            <CardFrameHeader>
                <CardFrameTitle className="text-lg font-semibold">Broker data</CardFrameTitle>
                <CardFrameDescription>
                    Review funds, orders, trades, positions, and holdings from the active broker session.
                </CardFrameDescription>
                {active !== "funds" ? (
                    <CardFrameAction>
                        <InputGroup className="h-9 w-full min-[760px]:w-64">
                            <InputGroupAddon>
                                <Search className="size-4" aria-hidden="true" />
                            </InputGroupAddon>
                            <InputGroupInput
                                onChange={(event) => setFilter(event.target.value)}
                                placeholder="Filter symbol"
                                value={filter}
                            />
                        </InputGroup>
                    </CardFrameAction>
                ) : null}
            </CardFrameHeader>
            <Card>
                <Tabs value={active} onValueChange={(value) => load(value as Tab)}>
                    <div className="border-b border-border px-4 pt-2">
                        <TabsList className="max-w-full overflow-x-auto overflow-y-hidden" variant="underline">
                            {tabs.map((tab) => (
                                <TabsTrigger className="whitespace-nowrap font-semibold" key={tab.id} value={tab.id}>
                                    {tab.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>

                    <CardPanel>
                        {error ? (
                            <Alert className="mb-4" variant="warning">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        ) : null}
                        {isPending ? <Skeleton /> : null}

                        {active === "funds" && state.funds ? (
                            <div className="grid gap-5">
                                {fundMetrics.length ? (
                                    <div className="grid gap-3 min-[640px]:grid-cols-2 min-[1080px]:grid-cols-4">
                                        {fundMetrics.map(([label, value]) => (
                                            <div
                                                className="rounded-lg border border-border bg-muted/40 p-4"
                                                key={label}
                                            >
                                                <span className="text-xs font-semibold uppercase text-muted-foreground">
                                                    {label}
                                                </span>
                                                <strong className="mt-2 block text-2xl font-semibold">
                                                    {money(value)}
                                                </strong>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <Empty message="No fund balance details were returned by this broker." />
                                )}
                                {state.profile && hasProfileDetails ? (
                                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                                        <h3 className="text-sm font-semibold">Profile</h3>
                                        <div className="mt-3 grid gap-3 text-sm min-[720px]:grid-cols-3">
                                            {state.profile.name ? (
                                                <div>
                                                    <span className="block text-xs font-medium uppercase text-muted-foreground">
                                                        Name
                                                    </span>
                                                    <span className="mt-1 block font-medium">{state.profile.name}</span>
                                                </div>
                                            ) : null}
                                            {state.profile.email ? (
                                                <div>
                                                    <span className="block text-xs font-medium uppercase text-muted-foreground">
                                                        Email
                                                    </span>
                                                    <span className="mt-1 block truncate font-medium">
                                                        {state.profile.email}
                                                    </span>
                                                </div>
                                            ) : null}
                                            {state.profile.broker_user_id ? (
                                                <div>
                                                    <span className="block text-xs font-medium uppercase text-muted-foreground">
                                                        Broker user
                                                    </span>
                                                    <span className="mt-1 block font-medium">
                                                        {state.profile.broker_user_id}
                                                    </span>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {active === "orders" && state.orders ? (
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

                        {active === "trades" && state.trades ? (
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

                        {active === "positions" && state.positions ? (
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
                                                        className={
                                                            (row.pnl ?? 0) >= 0 ? "text-primary" : "text-destructive"
                                                        }
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

                        {active === "holdings" && state.holdings ? (
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
                                                    className={
                                                        (row.pnl ?? 0) >= 0 ? "text-primary" : "text-destructive"
                                                    }
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
                                            <TableCell
                                                className={holdingsTotal >= 0 ? "text-primary" : "text-destructive"}
                                            >
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
                    </CardPanel>
                </Tabs>
            </Card>
        </CardFrame>
    );
}
