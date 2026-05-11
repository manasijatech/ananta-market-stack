"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
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
  syncInstrumentData
} from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { brokerNames, formatDate, StatusBadge, statusTone } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchExchange, setSearchExchange] = useState("");
  const [searchRows, setSearchRows] = useState<InstrumentSearchRow[]>([]);
  const [responseTitle, setResponseTitle] = useState("");
  const [responseBody, setResponseBody] = useState("");
  const [error, setError] = useState("");
  const [wsSymbol, setWsSymbol] = useState("");
  const [wsExchange, setWsExchange] = useState("NSE");
  const [wsMessages, setWsMessages] = useState<JsonObject[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

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

  function syncInstruments() {
    setError("");
    startTransition(async () => {
      try {
        const result = await syncInstrumentData(account.id);
        setSyncResult(result);
        setPayload("Instrument sync", result);
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
      try {
        const payload = JSON.parse(event.data) as JsonObject;
        setWsMessages((current) => [payload, ...current].slice(0, 12));
      } catch {
        setWsMessages((current) => [{ raw: String(event.data) }, ...current].slice(0, 12));
      }
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
        description="Populate the SQLite instrument cache for symbol-first requests and search."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={isPending || !sessionActive} onClick={syncInstruments} type="button">
            {isPending ? "Syncing..." : "Sync instruments"}
          </Button>
          {syncResult ? (
            <div className="text-sm text-muted-foreground">
              {syncResult.sync_status} · {syncResult.row_count} rows · {formatDate(syncResult.finished_at ?? syncResult.started_at)}
            </div>
          ) : null}
        </div>
      </Section>

      <Section
        title="Instrument search"
        description="Search the broker instrument cache after a sync completes."
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
          <Input defaultValue="RELIANCE" id="data-symbol" placeholder="Symbol" />
          <Input defaultValue="NSE" id="data-exchange" placeholder="Exchange" />
          <Input defaultValue="day" id="data-interval" placeholder="Interval" />
          <Input defaultValue={new Date().toISOString().slice(0, 10)} id="data-expiry" placeholder="Expiry YYYY-MM-DD" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={isPending || !sessionActive}
            onClick={() => {
              const symbol = (document.getElementById("data-symbol") as HTMLInputElement | null)?.value ?? "";
              const exchange = (document.getElementById("data-exchange") as HTMLInputElement | null)?.value ?? "NSE";
              run(() => getDataQuotes(account.id, { instruments: [{ symbol, exchange }] }), "Data quotes");
            }}
            type="button"
          >
            Quote
          </Button>
          <Button
            disabled={isPending || !sessionActive}
            onClick={() => {
              const symbol = (document.getElementById("data-symbol") as HTMLInputElement | null)?.value ?? "";
              const exchange = (document.getElementById("data-exchange") as HTMLInputElement | null)?.value ?? "NSE";
              run(() => getDataOhlc(account.id, { instruments: [{ symbol, exchange }] }), "Data OHLC");
            }}
            type="button"
            variant="outline"
          >
            OHLC
          </Button>
          <Button
            disabled={isPending || !sessionActive}
            onClick={() => {
              const symbol = (document.getElementById("data-symbol") as HTMLInputElement | null)?.value ?? "";
              const exchange = (document.getElementById("data-exchange") as HTMLInputElement | null)?.value ?? "NSE";
              const interval = (document.getElementById("data-interval") as HTMLInputElement | null)?.value ?? "day";
              const today = new Date().toISOString().slice(0, 10);
              run(
                () =>
                  getHistoricalData(account.id, {
                    instrument: { symbol, exchange },
                    interval,
                    from_date: `${today}T09:15:00`,
                    to_date: `${today}T15:30:00`
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
            onClick={() => {
              const symbol = (document.getElementById("data-symbol") as HTMLInputElement | null)?.value ?? "";
              const exchange = (document.getElementById("data-exchange") as HTMLInputElement | null)?.value ?? "NSE";
              const expiry = (document.getElementById("data-expiry") as HTMLInputElement | null)?.value ?? "";
              run(() => getOptionChainData(account.id, { symbol, exchange, expiry }), "Option chain");
            }}
            type="button"
            variant="outline"
          >
            Option chain
          </Button>
          <Button
            disabled={isPending || !sessionActive || !capabilities.capabilities.greeks?.supported}
            onClick={() => {
              const symbol = (document.getElementById("data-symbol") as HTMLInputElement | null)?.value ?? "";
              const exchange = (document.getElementById("data-exchange") as HTMLInputElement | null)?.value ?? "NSE";
              const expiry = (document.getElementById("data-expiry") as HTMLInputElement | null)?.value ?? "";
              run(() => getGreeksData(account.id, { symbol, exchange, expiry }), "Greeks");
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
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          {wsConnected ? "Connected" : "Disconnected"} · {streamStatus.subscription_count} active subscriptions
        </div>
        <div className="mt-4 grid gap-3">
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
