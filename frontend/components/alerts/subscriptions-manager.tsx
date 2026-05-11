"use client";

import { useMemo, useState, useTransition } from "react";
import { addLiveSubscriptionsBulk, deleteLiveSubscriptions } from "@/service/actions/alerts";
import type { LiveSubscription } from "@/service/types/alerts";
import type { BrokerAccount } from "@/service/types/broker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function parseSymbols(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[\n, ]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

export function SubscriptionsManager({
  accounts,
  initialSubscriptions
}: {
  accounts: BrokerAccount[];
  initialSubscriptions: LiveSubscription[];
}) {
  const [items, setItems] = useState(initialSubscriptions);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [symbolsInput, setSymbolsInput] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const parsedSymbols = useMemo(() => parseSymbols(symbolsInput), [symbolsInput]);
  const selectedAccount = accounts.find((item) => item.id === accountId);

  function add() {
    if (!selectedAccount || !parsedSymbols.length) return;
    setError("");
    startTransition(async () => {
      try {
        const next = await addLiveSubscriptionsBulk({
          subscriptions: parsedSymbols.map((symbol) => ({
            account_id: selectedAccount.id,
            broker_code: selectedAccount.broker_code,
            symbol,
            exchange: exchange.trim().toUpperCase() || "NSE",
            instrument_ref: { symbol, exchange: exchange.trim().toUpperCase() || "NSE" },
            source_kind: "manual"
          }))
        });
        setItems((current) => {
          const existing = new Map(current.map((item) => [item.id, item]));
          for (const row of next) existing.set(row.id, row);
          return Array.from(existing.values()).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        });
        setSymbolsInput("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not add subscriptions.");
      }
    });
  }

  function removeSelected() {
    if (!selectedIds.length) return;
    setError("");
    startTransition(async () => {
      try {
        await deleteLiveSubscriptions(selectedIds);
        setItems((current) => current.filter((item) => !selectedIds.includes(item.id)));
        setSelectedIds([]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not remove subscriptions.");
      }
    });
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) return Array.from(new Set([...current, id]));
      return current.filter((item) => item !== id);
    });
  }

  return (
    <div className="grid gap-6">
      {error ? <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div> : null}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Add subscribed symbols</div>
            <div className="text-xs text-muted-foreground">Paste one or many symbols. The stream manager will group them into broker sessions of up to 1000 symbols each.</div>
          </div>
          <Button disabled={isPending || !selectedIds.length} onClick={removeSelected} type="button" variant="outline">
            Remove selected
          </Button>
        </div>
        <div className="grid gap-3 min-[960px]:grid-cols-[1.4fr_160px]">
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setAccountId(event.target.value)} value={accountId}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} · {account.broker_code}
              </option>
            ))}
          </select>
          <Input onChange={(event) => setExchange(event.target.value)} placeholder="Exchange" value={exchange} />
        </div>
        <textarea
          className="mt-3 min-h-[112px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
          onChange={(event) => setSymbolsInput(event.target.value)}
          placeholder="RELIANCE, TCS, INFY or one symbol per line"
          value={symbolsInput}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {parsedSymbols.length} symbols ready
            {parsedSymbols.length ? ` · ${Math.ceil(parsedSymbols.length / 1000)} websocket session${Math.ceil(parsedSymbols.length / 1000) > 1 ? "s" : ""}` : ""}
          </div>
          <Button disabled={isPending || !parsedSymbols.length} onClick={add} type="button">
            Add symbols
          </Button>
        </div>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <label className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4" key={item.id}>
            <div className="flex items-start gap-3">
              <input
                checked={selectedIds.includes(item.id)}
                onChange={(event) => toggleSelected(item.id, event.target.checked)}
                type="checkbox"
              />
              <div>
                <div className="text-sm font-bold">{item.symbol}</div>
                <div className="text-xs text-muted-foreground">
                  {item.exchange ?? "-"} · {item.broker_code ?? "-"} · {item.source_kind}
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {item.last_received_at ? `Last tick ${new Date(item.last_received_at).toLocaleTimeString()}` : "Awaiting tick"}
            </div>
          </label>
        ))}
        {!items.length ? <div className="text-sm text-muted-foreground">No subscribed symbols yet.</div> : null}
      </div>
    </div>
  );
}
