"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteInstrumentStorage,
  getDataCapabilities,
  getDataOhlc,
  getDataQuotes,
  getGreeksData,
  getHistoricalData,
  getHoldings,
  getOptionChainData,
  getOrders,
  getPortfolioFunds,
  getPositions,
  getProfile,
  getStreamStatus,
  getTrades,
  searchBrokerInstruments,
  syncInstrumentData,
  syncInstrumentCsv
} from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { brokerNames, formatDate, StatusBadge, statusTone } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type {
  BrokerAccountDetail,
  DataCapabilities,
  InstrumentSearchRow,
  InstrumentSyncResult,
  JsonObject,
  StreamStatus
} from "@/service/types/broker";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isoLocal(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integerOrUndefined(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const SAMPLE_SYMBOL = "RELIANCE26APR1000CE";
const SAMPLE_EXCHANGE = "NSE";
const SAMPLE_STRIKE = "1000";
const SAMPLE_OPTION_TYPE = "CE";
const SAMPLE_OPTION_PRICE = "395.95";

function Section({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border py-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function BrokerDataTest({
  account,
  sessionActive,
  initialCapabilities,
  initialStreamStatus,
  apiBaseUrl
}: {
  account: BrokerAccountDetail;
  sessionActive: boolean;
  initialCapabilities: DataCapabilities;
  initialStreamStatus: StreamStatus;
  apiBaseUrl: string;
}) {
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [streamStatus, setStreamStatus] = useState(initialStreamStatus);
  const [syncResult, setSyncResult] = useState<InstrumentSyncResult | null>(null);
  const [searchQuery, setSearchQuery] = useState(SAMPLE_SYMBOL);
  const [searchExchange, setSearchExchange] = useState(SAMPLE_EXCHANGE);
  const [searchRows, setSearchRows] = useState<InstrumentSearchRow[]>([]);
  const [responseTitle, setResponseTitle] = useState("");
  const [responseBody, setResponseBody] = useState("");
  const [error, setError] = useState("");
  const [marketSymbol, setMarketSymbol] = useState(SAMPLE_SYMBOL);
  const [marketExchange, setMarketExchange] = useState(SAMPLE_EXCHANGE);
  const [marketInterval, setMarketInterval] = useState("day");
  const [marketExpiry, setMarketExpiry] = useState(new Date().toISOString().slice(0, 10));
  const [marketFromDate, setMarketFromDate] = useState(isoLocal(new Date(new Date().setHours(9, 15, 0, 0))));
  const [marketToDate, setMarketToDate] = useState(isoLocal(new Date(new Date().setHours(15, 30, 0, 0))));
  const [marketStrike, setMarketStrike] = useState(SAMPLE_STRIKE);
  const [marketOptionType, setMarketOptionType] = useState(SAMPLE_OPTION_TYPE);
  const [marketPrice, setMarketPrice] = useState(SAMPLE_OPTION_PRICE);
  const [marketUnderlyingPrice, setMarketUnderlyingPrice] = useState("");
  const [marketVolatility, setMarketVolatility] = useState("");
  const [marketInterestRate, setMarketInterestRate] = useState("");
  const [marketDaysToExpiry, setMarketDaysToExpiry] = useState("");
  const [wsSymbol, setWsSymbol] = useState(SAMPLE_SYMBOL);
  const [wsExchange, setWsExchange] = useState(SAMPLE_EXCHANGE);
  const [wsMessages, setWsMessages] = useState<JsonObject[]>([]);
  const [wsKeepHistory, setWsKeepHistory] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const wsRef = useRef<WebSocket | null>(null);
  const wsKeepHistoryRef = useRef(false);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    wsKeepHistoryRef.current = wsKeepHistory;
  }, [wsKeepHistory]);

  useEffect(() => {
    if (!wsKeepHistory && wsMessages.length > 1) {
      setWsMessages((current) => current.slice(0, 1));
    }
  }, [wsKeepHistory, wsMessages.length]);

  function setPayload(title: string, body: unknown) {
    setResponseTitle(title);
    setResponseBody(pretty(body));
  }

  function refreshMeta() {
    startTransition(async () => {
      try {
        const [nextCapabilities, nextStream] = await Promise.all([
          getDataCapabilities(account.id),
          getStreamStatus(account.id)
        ]);
        setCapabilities(nextCapabilities);
        setStreamStatus(nextStream);
      } catch (caught) {
        setError(parseActionError(caught).message);
      }
    });
  }

  function run(action: () => Promise<unknown>, title: string) {
    setError("");
    startTransition(async () => {
      try {
        const result = await action();
        setPayload(title, result);
      } catch (caught) {
        setError(parseActionError(caught).message);
      }
    });
  }

  function syncInstruments(storage: "db" | "csv" | "delete") {
    setError("");
    startTransition(async () => {
      try {
        const result =
          storage === "db"
            ? await syncInstrumentData(account.id)
            : storage === "csv"
              ? await syncInstrumentCsv(account.id)
              : await deleteInstrumentStorage(account.id);
        setSyncResult(result);
        setPayload(
          storage === "db"
            ? "Instrument sync to DB"
            : storage === "csv"
              ? "Instrument sync to CSV"
              : "Instrument storage delete",
          result
        );
        if (storage === "delete") {
          setSearchRows([]);
        }
        refreshMeta();
      } catch (caught) {
        setError(parseActionError(caught).message);
      }
    });
  }

  function searchInstruments() {
    setError("");
    startTransition(async () => {
      try {
        const result = await searchBrokerInstruments(account.id, {
          q: searchQuery,
          exchange: searchExchange || undefined,
          limit: 30
        });
        setSearchRows(result);
      } catch (caught) {
        setError(parseActionError(caught).message);
      }
    });
  }

  function connectSocket() {
    if (wsRef.current || !streamStatus.websocket_enabled) {
      return;
    }
    const wsUrl = `${apiBaseUrl.replace(/^http/i, "ws")}/broker-accounts/${account.id}/data/stream/ws?user_id=${encodeURIComponent(account.user_id)}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;
    socket.onopen = () => setWsConnected(true);
    socket.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
    };
    socket.onmessage = (event) => {
      let nextPayload: JsonObject;
      try {
        nextPayload = JSON.parse(event.data) as JsonObject;
      } catch {
        nextPayload = { raw: String(event.data) };
      }
      setWsMessages((current) => (wsKeepHistoryRef.current ? [nextPayload, ...current].slice(0, 100) : [nextPayload]));
      startTransition(async () => {
        try {
          setStreamStatus(await getStreamStatus(account.id));
        } catch {
          return;
        }
      });
    };
  }

  function disconnectSocket() {
    wsRef.current?.close();
    wsRef.current = null;
    setWsConnected(false);
  }

  function subscribeSocket() {
    if (!wsRef.current || !wsConnected || !wsSymbol.trim()) {
      return;
    }
    wsRef.current.send(
      JSON.stringify({
        type: "subscribe",
        instruments: [{ symbol: wsSymbol.trim(), exchange: wsExchange.trim() || "NSE" }]
      })
    );
  }

  function marketInstrument() {
    return {
      symbol: marketSymbol.trim(),
      exchange: marketExchange.trim() || "NSE"
    };
  }

  return (
    <div className="grid gap-8">
      {!sessionActive ? (
        <Alert variant="warning">
          <AlertDescription>Activate the broker session first. The read-only data APIs depend on a live broker token or session.</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="warning">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Section
        title="Account"
        description="Session state, broker capabilities, and the current stream manager status."
      >
        <div className="grid gap-3 min-[820px]:grid-cols-3">
          <div className="border-t border-border py-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">Broker</div>
            <div className="mt-2 text-lg font-bold">{brokerNames[account.broker_code]}</div>
          </div>
          <div className="border-t border-border py-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">Session</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge className={account.last_verified_at ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"}>
                {account.last_verified_at ? "Verified" : "Unverified"}
              </StatusBadge>
              <StatusBadge className={statusTone(account.session_status)}>
                {account.session_status ?? "pending"}
              </StatusBadge>
            </div>
          </div>
          <div className="border-t border-border py-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">Stream status</div>
            <div className="mt-2 text-lg font-bold">{streamStatus.subscription_count} subscriptions</div>
            <div className="text-sm text-muted-foreground">{streamStatus.guidance}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(capabilities.capabilities).map(([key, value]) => (
            <StatusBadge
              className={value.supported ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-border bg-card text-muted-foreground"}
              key={key}
            >
              {key}
            </StatusBadge>
          ))}
          <Button disabled={isPending} onClick={refreshMeta} type="button" variant="outline">
            Refresh status
          </Button>
        </div>
      </Section>

      <Section
        title="Instrument sync"
        description="Manage broker-scoped instrument storage in SQLite and as a local CSV under backend/data/instruments."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={isPending || !sessionActive} onClick={() => syncInstruments("db")} type="button">
            {isPending ? "Working..." : "Sync to DB"}
          </Button>
          <Button disabled={isPending || !sessionActive} onClick={() => syncInstruments("csv")} type="button" variant="outline">
            {isPending ? "Working..." : "Sync to CSV"}
          </Button>
          <Button disabled={isPending} onClick={() => syncInstruments("delete")} type="button" variant="destructive">
            {isPending ? "Working..." : "Delete DB + CSV"}
          </Button>
          {syncResult ? (
            <div className="grid gap-1 text-sm text-muted-foreground">
              <div>
                {syncResult.storage_target ?? "db"} · {syncResult.sync_status} · {syncResult.row_count} rows · {formatDate(syncResult.finished_at ?? syncResult.started_at)}
              </div>
              {syncResult.csv_path ? <div>CSV path: {syncResult.csv_path}</div> : null}
              {typeof syncResult.deleted_db_rows === "number" ? <div>Deleted DB rows: {syncResult.deleted_db_rows}</div> : null}
              {typeof syncResult.deleted_csv === "boolean" ? <div>Deleted CSV: {syncResult.deleted_csv ? "yes" : "no file found"}</div> : null}
            </div>
          ) : null}
        </div>
      </Section>

      <Section
        title="Instrument search"
        description="Search the broker instrument cache after a sync completes, with CSV fallback when the local export is available."
      >
        <div className="grid gap-3 min-[900px]:grid-cols-[1fr_140px_140px]">
          <Input onChange={(event) => setSearchQuery(event.target.value)} placeholder="Symbol, trading symbol, name" value={searchQuery} />
          <Input onChange={(event) => setSearchExchange(event.target.value)} placeholder="Exchange" value={searchExchange} />
          <Button disabled={isPending} onClick={searchInstruments} type="button">
            Search
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Symbol</th>
                <th>Source</th>
                <th>Exchange</th>
                <th>Type</th>
                <th>Expiry</th>
                <th>Identifiers</th>
              </tr>
            </thead>
            <tbody>
              {searchRows.map((row) => (
                <tr className="border-t border-border" key={`${row.exchange}-${row.symbol}-${row.expiry ?? "na"}`}>
                  <td className="py-3">
                    <div className="font-bold">{row.symbol}</div>
                    <div className="text-xs text-muted-foreground">{row.name ?? row.trading_symbol ?? "-"}</div>
                  </td>
                  <td>{row.source ?? "db"}</td>
                  <td>{row.exchange ?? "-"}</td>
                  <td>{row.instrument_type ?? "-"}</td>
                  <td>{row.expiry ? formatDate(row.expiry) : "-"}</td>
                  <td className="max-w-[280px] truncate text-xs text-muted-foreground">
                    {Object.entries(row.identifiers)
                      .filter(([, value]) => value)
                      .map(([key, value]) => `${key}:${value}`)
                      .join(" · ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!searchRows.length ? (
            <div className="border-t border-border py-4 text-sm text-muted-foreground">No instrument rows loaded yet.</div>
          ) : null}
        </div>
      </Section>

      <Section
        title="Portfolio reads"
        description="Run the existing read-only broker operations and inspect raw broker payloads."
      >
        <div className="flex flex-wrap gap-2">
          <Button disabled={isPending || !sessionActive} onClick={() => run(() => getProfile(account.id), "Profile")} type="button" variant="outline">Profile</Button>
          <Button disabled={isPending || !sessionActive} onClick={() => run(() => getPortfolioFunds(account.id), "Funds")} type="button" variant="outline">Funds</Button>
          <Button disabled={isPending || !sessionActive} onClick={() => run(() => getPositions(account.id), "Positions")} type="button" variant="outline">Positions</Button>
          <Button disabled={isPending || !sessionActive} onClick={() => run(() => getHoldings(account.id), "Holdings")} type="button" variant="outline">Holdings</Button>
          <Button disabled={isPending || !sessionActive} onClick={() => run(() => getOrders(account.id), "Orders")} type="button" variant="outline">Orders</Button>
          <Button disabled={isPending || !sessionActive} onClick={() => run(() => getTrades(account.id), "Trades")} type="button" variant="outline">Trades</Button>
        </div>
      </Section>

      <Section
        title="Market data"
        description="Quote, OHLC, historical, option-chain, and greeks requests through the uniform backend interface."
      >
        <div className="grid gap-3 min-[960px]:grid-cols-4">
          <Input onChange={(event) => setMarketSymbol(event.target.value)} placeholder="Symbol" value={marketSymbol} />
          <Input onChange={(event) => setMarketExchange(event.target.value)} placeholder="Exchange" value={marketExchange} />
          <Input onChange={(event) => setMarketInterval(event.target.value)} placeholder="Interval" value={marketInterval} />
          <Input onChange={(event) => setMarketExpiry(event.target.value)} placeholder="Expiry YYYY-MM-DD" value={marketExpiry} />
        </div>
        <div className="mt-3 grid gap-3 min-[960px]:grid-cols-2">
          <Input onChange={(event) => setMarketFromDate(event.target.value)} placeholder="From" type="datetime-local" value={marketFromDate} />
          <Input onChange={(event) => setMarketToDate(event.target.value)} placeholder="To" type="datetime-local" value={marketToDate} />
        </div>
        <div className="mt-3 grid gap-3 min-[960px]:grid-cols-4">
          <Input onChange={(event) => setMarketStrike(event.target.value)} placeholder="Strike" value={marketStrike} />
          <Input onChange={(event) => setMarketOptionType(event.target.value)} placeholder="Option type CE/PE" value={marketOptionType} />
          <Input onChange={(event) => setMarketPrice(event.target.value)} placeholder="Option price" value={marketPrice} />
          <Input onChange={(event) => setMarketUnderlyingPrice(event.target.value)} placeholder="Underlying price" value={marketUnderlyingPrice} />
        </div>
        <div className="mt-3 grid gap-3 min-[960px]:grid-cols-3">
          <Input onChange={(event) => setMarketVolatility(event.target.value)} placeholder="Volatility" value={marketVolatility} />
          <Input onChange={(event) => setMarketInterestRate(event.target.value)} placeholder="Interest rate" value={marketInterestRate} />
          <Input onChange={(event) => setMarketDaysToExpiry(event.target.value)} placeholder="Days to expiry" value={marketDaysToExpiry} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={isPending || !sessionActive}
            onClick={() => run(() => getDataQuotes(account.id, { instruments: [marketInstrument()] }), "Data quotes")}
            type="button"
          >
            Quote
          </Button>
          <Button
            disabled={isPending || !sessionActive}
            onClick={() => run(() => getDataOhlc(account.id, { instruments: [marketInstrument()] }), "Data OHLC")}
            type="button"
            variant="outline"
          >
            OHLC
          </Button>
          <Button
            disabled={isPending || !sessionActive}
            onClick={() => {
              run(
                () =>
                  getHistoricalData(account.id, {
                    instrument: marketInstrument(),
                    interval: marketInterval,
                    from_date: new Date(marketFromDate).toISOString(),
                    to_date: new Date(marketToDate).toISOString()
                  }),
                "Historical data"
              );
            }}
            type="button"
            variant="outline"
          >
            Historical
          </Button>
          <Button
            disabled={isPending || !sessionActive || !capabilities.capabilities.option_chain?.supported}
            onClick={() => run(() => getOptionChainData(account.id, { symbol: marketSymbol.trim(), exchange: marketExchange.trim() || "NSE", expiry: marketExpiry.trim() || undefined }), "Option chain")}
            type="button"
            variant="outline"
          >
            Option chain
          </Button>
          <Button
            disabled={isPending || !sessionActive || !capabilities.capabilities.greeks?.supported}
            onClick={() => {
              run(
                () =>
                  getGreeksData(account.id, {
                    symbol: marketSymbol.trim(),
                    exchange: marketExchange.trim() || "NSE",
                    expiry: marketExpiry.trim() || undefined,
                    strike: marketStrike.trim() || undefined,
                    option_type: marketOptionType.trim() || undefined,
                    price: numberOrUndefined(marketPrice),
                    underlying_price: numberOrUndefined(marketUnderlyingPrice),
                    volatility: numberOrUndefined(marketVolatility),
                    interest_rate: numberOrUndefined(marketInterestRate),
                    days_to_expiry: integerOrUndefined(marketDaysToExpiry)
                  }),
                "Greeks"
              );
            }}
            type="button"
            variant="outline"
          >
            Greeks
          </Button>
        </div>
      </Section>

      <Section
        title="WebSocket test"
        description="On-demand quote streaming over the unified websocket route."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!streamStatus.websocket_enabled || wsConnected} onClick={connectSocket} type="button">
            Connect
          </Button>
          <Button disabled={!wsConnected} onClick={disconnectSocket} type="button" variant="outline">
            Disconnect
          </Button>
          <Input className="w-[180px]" onChange={(event) => setWsSymbol(event.target.value)} placeholder="Symbol" value={wsSymbol} />
          <Input className="w-[120px]" onChange={(event) => setWsExchange(event.target.value)} placeholder="Exchange" value={wsExchange} />
          <Button disabled={!wsConnected || !wsSymbol.trim()} onClick={subscribeSocket} type="button" variant="outline">
            Subscribe
          </Button>
          <Button disabled={!wsMessages.length} onClick={() => setWsMessages([])} type="button" variant="outline">
            Clear
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={wsKeepHistory} onCheckedChange={(checked) => setWsKeepHistory(Boolean(checked))} />
            See all received messages
          </label>
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          {wsConnected ? "Connected" : "Disconnected"} · {streamStatus.subscription_count} active subscriptions
        </div>
        <div className="mt-4 grid max-h-[28rem] gap-3 overflow-y-auto pr-1">
          {wsMessages.map((message, index) => (
            <pre className="overflow-x-auto rounded-sm border border-border bg-muted/30 p-3 text-xs" key={`${index}-${JSON.stringify(message).slice(0, 24)}`}>
              {pretty(message)}
            </pre>
          ))}
          {!wsMessages.length ? (
            <div className="border-t border-border py-4 text-sm text-muted-foreground">No websocket messages yet.</div>
          ) : null}
        </div>
      </Section>

      <Section
        title={responseTitle || "Latest response"}
        description="Raw payloads returned by the backend or broker."
      >
        <pre className="overflow-x-auto rounded-sm border border-border bg-muted/30 p-4 text-xs">
          {responseBody || "{}"}
        </pre>
      </Section>
    </div>
  );
}
