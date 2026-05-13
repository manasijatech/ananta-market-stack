"use client";

import { useState, useTransition } from "react";
import { updateBrokerDataSearchConfig } from "@/service/actions/broker";
import type { BrokerDataSearchConfig } from "@/service/types/broker";
import { Button } from "@/components/ui/button";

export function BrokerDataSearchConfigPanel({
 initialConfig
}: {
 initialConfig: BrokerDataSearchConfig;
}) {
 const [config, setConfig] = useState(initialConfig);
 const [selectedAccountId, setSelectedAccountId] = useState(initialConfig.preferred_search_account_id ?? "");
 const [error, setError] = useState("");
 const [isPending, startTransition] = useTransition();

 function save() {
 setError("");
 startTransition(async () => {
 try {
 const next = await updateBrokerDataSearchConfig(selectedAccountId || null);
 setConfig(next);
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not save broker data preference.");
 }
 });
 }

 return (
 <div className="grid gap-6">
 <section className=" border border-border p-5">
 <div className="text-sm font-bold">Default symbol-search broker</div>
 <p className="mt-2 text-sm text-muted-foreground">
 The selected broker cache is used first for symbol search. If it is unavailable, search falls back to the next available synced broker without blocking the UI.
 </p>
 <div className="mt-4 flex flex-wrap items-center gap-3">
 <select
 className="h-10 min-w-[280px] border border-input bg-background px-3 text-sm"
 onChange={(event) => setSelectedAccountId(event.target.value)}
 value={selectedAccountId}
 >
 {config.accounts.map((account) => (
 <option key={account.account_id} value={account.account_id}>
 {account.label} · {account.broker_code}
 </option>
 ))}
 </select>
 <Button disabled={isPending} onClick={save} type="button">
 {isPending ? "Saving..." : "Save"}
 </Button>
 </div>
 {config.effective_search_account_id ? (
 <div className="mt-4 text-xs text-muted-foreground">
 Effective search account: {config.accounts.find((item) => item.account_id === config.effective_search_account_id)?.label ?? config.effective_search_account_id}
 {config.fallback_used ? " · fallback active right now" : ""}
 </div>
 ) : null}
 {error ? <div className="mt-3 text-sm text-destructive">{error}</div> : null}
 </section>

 <section className="grid gap-3">
 <div className="text-sm font-bold">Broker data status</div>
 {config.accounts.map((account) => (
 <div className=" border border-border p-4" key={account.account_id}>
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-bold">
 {account.label} · {account.broker_code}
 </div>
 <div className="mt-1 text-xs text-muted-foreground">
 {account.search_available ? "Search cache ready" : "Search cache unavailable"} · {account.is_verified ? "verified" : "unverified"} · {account.session_active ? "session active" : (account.session_status ?? "session pending")}
 </div>
 </div>
 <div className="text-xs text-muted-foreground">
 {account.is_preferred ? "preferred" : account.is_effective ? "effective fallback" : "standby"}
 </div>
 </div>
 <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
 <div>
 Instrument sync: {account.latest_instrument_sync_status ?? "not run"}{account.latest_instrument_sync_finished_at ? ` · ${new Date(account.latest_instrument_sync_finished_at).toLocaleString("en-IN")}` : ""}
 </div>
 <div>
 Holdings refresh: {account.holdings_status ?? "not run"} · {account.holdings_count} items{account.holdings_fetched_at ? ` · ${new Date(account.holdings_fetched_at).toLocaleString("en-IN")}` : ""}
 </div>
 {account.last_error ? <div className="text-[var(--danger)]">{account.last_error}</div> : null}
 {account.latest_instrument_sync_error ? <div className="text-[var(--danger)]">{account.latest_instrument_sync_error}</div> : null}
 </div>
 </div>
 ))}
 {!config.accounts.length ? <div className="text-sm text-muted-foreground">No broker accounts available yet.</div> : null}
 </section>
 </div>
 );
}
