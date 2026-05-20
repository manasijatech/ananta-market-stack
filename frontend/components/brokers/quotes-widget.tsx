"use client";

import { FormEvent, useState, useTransition } from "react";
import { getQuotes } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrokerAccount, InstrumentRef, JsonObject, JsonValue, QuoteResponse } from "@/service/types/broker";

const quoteIdentifierLabels: Record<string, string> = {
    angel: "Angel token",
    dhan: "Dhan security ID",
    groww: "Groww trading symbol",
    indmoney: "INDmoney scrip code",
    kotak: "Kotak query",
    upstox: "Upstox instrument key",
    zerodha: "Zerodha instrument token"
};

function objectValue(source: JsonObject, key: string): JsonValue | undefined {
    return source[key];
}

function displayRaw(raw: JsonObject, keys: string[]): string {
    for (const key of keys) {
        const value = objectValue(raw, key);
        if (typeof value === "string" || typeof value === "number") {
            return String(value);
        }
    }
    const ohlc = objectValue(raw, "ohlc");
    if (typeof ohlc === "object" && ohlc !== null && !Array.isArray(ohlc)) {
        for (const key of keys) {
            const value = (ohlc as JsonObject)[key];
            if (typeof value === "string" || typeof value === "number") {
                return String(value);
            }
        }
    }
    return "-";
}

export function QuotesWidget({ account }: { account: BrokerAccount }) {
    const [rows, setRows] = useState<QuoteResponse[]>([]);
    const [message, setMessage] = useState("");
    const [hasSearched, setHasSearched] = useState(false);
    const [isPending, startTransition] = useTransition();

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const symbol = String(data.get("symbol") ?? "").trim();
        const exchange = String(data.get("exchange") ?? "").trim();
        const instrument: InstrumentRef = { symbol, exchange };
        const broker = account.broker_code;
        const token = String(data.get("token") ?? "").trim();
        if (!symbol && !token) {
            setRows([]);
            setHasSearched(false);
            setMessage(`Enter a symbol or ${quoteIdentifierLabels[broker] ?? "broker identifier"} to fetch a quote.`);
            return;
        }
        if (broker === "zerodha" && !token) {
            setRows([]);
            setHasSearched(false);
            setMessage("Zerodha quotes currently require the instrument token. Symbol lookup is not wired yet.");
            return;
        }
        if (broker === "zerodha" && Number.isNaN(Number(token))) {
            setRows([]);
            setHasSearched(false);
            setMessage("Zerodha instrument token must be a number.");
            return;
        }
        if (broker === "zerodha" && token) instrument.zerodha_instrument_token = Number(token);
        if (broker === "upstox" && token) instrument.upstox_instrument_key = token;
        if (broker === "angel" && token) instrument.angel_token = Number(token);
        if (broker === "angel" && exchange) instrument.angel_exchange = exchange;
        if (broker === "dhan" && token) instrument.dhan_security_id = token;
        if (broker === "dhan" && exchange) instrument.dhan_exchange_segment = exchange;
        if (broker === "groww" && token) instrument.groww_trading_symbol = token;
        if (broker === "indmoney" && token) instrument.indmoney_scrip_code = token;
        if (broker === "kotak" && token) instrument.kotak_query = token;

        setRows([]);
        setHasSearched(true);
        setMessage("");
        startTransition(async () => {
            try {
                const result = await getQuotes(account.id, { instruments: [instrument] });
                setRows(result);
                if (!result.length) {
                    setMessage(
                        `No quote returned. Check the ${quoteIdentifierLabels[broker] ?? "broker identifier"} and try again.`
                    );
                }
            } catch (error) {
                setRows([]);
                setMessage(parseActionError(error).message);
            }
        });
    }

    return (
        <section className="border-t border-border py-8">
            <h2 className="text-xl font-bold">Quotes</h2>
            <form className="mt-5 grid gap-3 min-[720px]:grid-cols-4" onSubmit={submit}>
                <Input name="symbol" placeholder="Symbol" />
                <Input name="exchange" placeholder="Exchange/segment" />
                <Input
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-form-type="other"
                    data-lpignore="true"
                    name="token"
                    placeholder={quoteIdentifierLabels[account.broker_code] ?? `${account.broker_code} identifier`}
                />
                <Button disabled={isPending} type="submit">
                    {isPending ? "Fetching..." : "Fetch quote"}
                </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
                {account.broker_code === "zerodha"
                    ? "For now, Zerodha quotes need the numeric instrument token. Symbol-only lookup will come with the instrument master."
                    : "Use the broker-native identifier when symbol lookup is not available."}
            </p>
            {message ? (
                <Alert className="mt-4" variant="warning">
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            ) : null}
            <div className="mt-4 grid gap-3 min-[720px]:grid-cols-2">
                {isPending ? (
                    <>
                        <div className="border-t border-border py-4">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="mt-2 h-9 w-32" />
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <Skeleton className="h-4 w-24" key={index} />
                                ))}
                            </div>
                        </div>
                        <div className="border-t border-border py-4">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="mt-2 h-9 w-32" />
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <Skeleton className="h-4 w-24" key={index} />
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}
                {rows.map((row) => {
                    const raw =
                        typeof row.detail.raw === "object" && row.detail.raw !== null && !Array.isArray(row.detail.raw)
                            ? (row.detail.raw as JsonObject)
                            : row.detail;
                    return (
                        <div className="border-t border-border py-4" key={`${row.account_id}-${row.symbol}`}>
                            <p className="text-sm font-bold text-muted-foreground">{row.symbol ?? "Quote"}</p>
                            <strong className="mt-1 block text-3xl">{row.ltp}</strong>
                            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                                <div>Open: {displayRaw(raw, ["open", "open_price"])}</div>
                                <div>High: {displayRaw(raw, ["high", "high_price"])}</div>
                                <div>Low: {displayRaw(raw, ["low", "low_price"])}</div>
                                <div>Close: {displayRaw(raw, ["close", "close_price"])}</div>
                                <div>Volume: {displayRaw(raw, ["volume", "volume_traded"])}</div>
                                <div>Time: {displayRaw(raw, ["timestamp", "last_trade_time"])}</div>
                            </dl>
                        </div>
                    );
                })}
            </div>
            {hasSearched && !isPending && !rows.length && !message ? (
                <p className="mt-4 border-t border-border py-4 text-sm text-muted-foreground">
                    No quote data returned.
                </p>
            ) : null}
        </section>
    );
}
