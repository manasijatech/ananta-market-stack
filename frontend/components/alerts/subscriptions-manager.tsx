"use client";

import { useState, useTransition } from "react";
import { addLiveSubscription, deleteLiveSubscription } from "@/service/actions/alerts";
import type { LiveSubscription } from "@/service/types/alerts";
import type { BrokerAccount } from "@/service/types/broker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SubscriptionsManager({
  accounts,
  initialSubscriptions
}: {
  accounts: BrokerAccount[];
  initialSubscriptions: LiveSubscription[];
}) {
  const [items, setItems] = useState(initialSubscriptions);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function add() {
    const account = accounts.find((item) => item.id === accountId);
    if (!account || !symbol.trim()) return;
    setError("");
    startTransition(async () => {
      try {
        const next = await addLiveSubscription({
          account_id: account.id,
          broker_code: account.broker_code,
          symbol: symbol.trim(),
          exchange: exchange.trim() || "NSE",
          instrument_ref: { symbol: symbol.trim(), exchange: exchange.trim() || "NSE" },
          source_kind: "manual"
        });
        setItems((current) => [next, ...current]);
        setSymbol("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not add subscription.");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteLiveSubscription(id);
      setItems((current) => current.filter((item) => item.id !== id));
    });
  }

  return (
    <div className="grid gap-6">
      {error ? <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div> : null}
      <div className="grid gap-3 min-[960px]:grid-cols-[1.4fr_1fr_160px_140px]">
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setAccountId(event.target.value)} value={accountId}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label} · {account.broker_code}
            </option>
          ))}
        </select>
        <Input onChange={(event) => setSymbol(event.target.value)} placeholder="Symbol" value={symbol} />
        <Input onChange={(event) => setExchange(event.target.value)} placeholder="Exchange" value={exchange} />
        <Button disabled={isPending || !symbol.trim()} onClick={add} type="button">
          Add symbol
        </Button>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4" key={item.id}>
            <div>
              <div className="text-sm font-bold">{item.symbol}</div>
              <div className="text-xs text-muted-foreground">
                {item.exchange ?? "-"} · {item.broker_code ?? "-"} · {item.source_kind}
              </div>
            </div>
            <Button disabled={isPending} onClick={() => remove(item.id)} size="sm" type="button" variant="outline">
              Remove
            </Button>
          </div>
        ))}
        {!items.length ? <div className="text-sm text-muted-foreground">No subscribed symbols yet.</div> : null}
      </div>
    </div>
  );
}
