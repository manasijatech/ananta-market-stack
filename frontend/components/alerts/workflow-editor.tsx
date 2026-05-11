"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  getDataOhlc,
  getDataQuotes,
  searchBrokerInstruments
} from "@/service/actions/broker";
import {
  createAlertWorkflow,
  testAlertWorkflow,
  updateAlertWorkflow
} from "@/service/actions/alerts";
import type {
  AlertChannelSelection,
  AlertChannelType,
  AlertCondition,
  AlertGraphDsl,
  AlertWorkflow,
  AlertWorkflowDsl,
  EditorMode,
  InstrumentRef
} from "@/service/types/alerts";
import type { BrokerAccount, InstrumentSearchRow, JsonObject, QuoteResponse } from "@/service/types/broker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function buildGraph(dsl: AlertWorkflowDsl): AlertGraphDsl {
  const nodes: AlertGraphDsl["nodes"] = [
    { id: "trigger", kind: "trigger", label: "Live tick", config: { combine: dsl.combine } }
  ];
  const edges: AlertGraphDsl["edges"] = [];
  for (const [index, condition] of dsl.conditions.entries()) {
    const id = `condition-${index + 1}`;
    nodes.push({ id, kind: "condition", label: `${condition.field} ${condition.operator}`, config: condition });
    edges.push({ source: "trigger", target: id });
  }
  nodes.push({ id: "notification", kind: "notification", label: "Notify", config: dsl.notification });
  for (const node of nodes.filter((item) => item.kind === "condition")) {
    edges.push({ source: node.id, target: "notification" });
  }
  nodes.push({ id: "channels", kind: "channel", label: "Channels", config: dsl.channels });
  edges.push({ source: "notification", target: "channels" });
  return { nodes, edges };
}

const fieldOptions = [
  { value: "ltp", label: "Last traded price", help: "Latest traded price for the symbol." },
  { value: "volume", label: "Volume", help: "Current traded volume from the live quote payload." },
  { value: "open_interest", label: "Open interest", help: "Useful for derivatives and option-chain driven workflows." },
  { value: "high", label: "Day high", help: "Current day high from OHLC/live quote data." },
  { value: "low", label: "Day low", help: "Current day low from OHLC/live quote data." },
  { value: "open", label: "Day open", help: "Current day open." },
  { value: "close", label: "Previous close", help: "Reference close returned by the broker." }
];

const operatorOptions = [
  { value: "gt", label: "Greater than", help: "Trigger when the field becomes greater than the value." },
  { value: "gte", label: "Greater than or equal", help: "Trigger when the field reaches or exceeds the value." },
  { value: "lt", label: "Less than", help: "Trigger when the field becomes lower than the value." },
  { value: "lte", label: "Less than or equal", help: "Trigger when the field reaches or falls below the value." },
  { value: "crosses_above", label: "Crosses above", help: "Needs live updates. Triggers only when the field moves from below to above the value." },
  { value: "crosses_below", label: "Crosses below", help: "Needs live updates. Triggers only when the field moves from above to below the value." },
  { value: "pct_change_gte", label: "Percent change up", help: "Trigger when percent change versus a reference field reaches the value." },
  { value: "pct_change_lte", label: "Percent change down", help: "Trigger when percent change versus a reference field falls below the value." }
];

const compareOptions = [
  { value: "", label: "Manual value", help: "Use the numeric value box directly." },
  { value: "open", label: "Compare to open", help: "Use day open as the reference." },
  { value: "close", label: "Compare to close", help: "Use previous close as the reference." },
  { value: "high", label: "Compare to high", help: "Use day high as the reference." },
  { value: "low", label: "Compare to low", help: "Use day low as the reference." }
];

type PreviewState = {
  quote: QuoteResponse | null;
  ohlc: JsonObject | null;
  loading: boolean;
  error: string;
};

function instrumentFromSearch(row: InstrumentSearchRow): InstrumentRef {
  return {
    symbol: row.symbol,
    exchange: row.exchange ?? null,
    zerodha_instrument_token: row.identifiers.zerodha_instrument_token ? Number(row.identifiers.zerodha_instrument_token) : null,
    upstox_instrument_key: row.identifiers.upstox_instrument_key ?? null,
    angel_exchange: row.identifiers.angel_exchange ?? null,
    angel_token: row.identifiers.angel_token ? Number(row.identifiers.angel_token) : null,
    dhan_exchange_segment: row.identifiers.dhan_exchange_segment ?? null,
    dhan_security_id: row.identifiers.dhan_security_id ?? null,
    groww_exchange: row.identifiers.groww_exchange ?? null,
    groww_segment: row.identifiers.groww_segment ?? null,
    groww_trading_symbol: row.identifiers.groww_trading_symbol ?? null,
    indmoney_scrip_code: row.identifiers.indmoney_scrip_code ?? null,
    kotak_query: row.identifiers.kotak_query ?? null,
    kotak_segment: row.identifiers.kotak_segment ?? null,
    kotak_psymbol: row.identifiers.kotak_psymbol ?? null
  };
}

function compactPreview(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function serializeInstrumentRef(value: InstrumentRef): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-muted-foreground">{children}</div>;
}

export function WorkflowEditor({
  accounts,
  initialWorkflow
}: {
  accounts: BrokerAccount[];
  initialWorkflow?: AlertWorkflow | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [matchPreview, setMatchPreview] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>(initialWorkflow?.editor_mode ?? "rule");
  const [name, setName] = useState(initialWorkflow?.name ?? "");
  const [description, setDescription] = useState(initialWorkflow?.description ?? "");
  const [accountId, setAccountId] = useState(initialWorkflow?.account_id ?? accounts[0]?.id ?? "");
  const [brokerCode, setBrokerCode] = useState(initialWorkflow?.broker_code ?? "");
  const [symbol, setSymbol] = useState(initialWorkflow?.symbol ?? "");
  const [exchange, setExchange] = useState(initialWorkflow?.exchange ?? "NSE");
  const [instrumentRef, setInstrumentRef] = useState<InstrumentRef>(initialWorkflow?.instrument_ref ?? {});
  const [status, setStatus] = useState<"active" | "inactive">(initialWorkflow?.status ?? "active");
  const [combine, setCombine] = useState<"all" | "any">(initialWorkflow?.workflow_dsl.combine ?? "all");
  const [cooldownSeconds, setCooldownSeconds] = useState(String(initialWorkflow?.workflow_dsl.cooldown_seconds ?? 300));
  const [conditions, setConditions] = useState<AlertCondition[]>(
    initialWorkflow?.workflow_dsl.conditions.length
      ? initialWorkflow.workflow_dsl.conditions
      : [{ field: "ltp", operator: "crosses_above", value: 3000 }]
  );
  const [level, setLevel] = useState(initialWorkflow?.workflow_dsl.notification.level ?? "info");
  const [titleTemplate, setTitleTemplate] = useState(initialWorkflow?.workflow_dsl.notification.title_template ?? "{symbol} alert");
  const [messageTemplate, setMessageTemplate] = useState(initialWorkflow?.workflow_dsl.notification.message_template ?? "{symbol} matched workflow");
  const [inheritDefaults, setInheritDefaults] = useState(initialWorkflow?.channel_override?.inherit_defaults ?? true);
  const [channelInApp, setChannelInApp] = useState(initialWorkflow?.workflow_dsl.channels.enabled.includes("in_app") ?? true);
  const [channelDiscord, setChannelDiscord] = useState(initialWorkflow?.workflow_dsl.channels.enabled.includes("discord") ?? false);
  const [channelTelegram, setChannelTelegram] = useState(initialWorkflow?.workflow_dsl.channels.enabled.includes("telegram") ?? false);
  const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedSearchLabel, setSelectedSearchLabel] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ quote: null, ohlc: null, loading: false, error: "" });

  const selectedAccount = accounts.find((item) => item.id === accountId);
  const activeInstrument = useMemo<InstrumentRef>(
    () => ({
      ...instrumentRef,
      symbol: symbol || instrumentRef.symbol || null,
      exchange: exchange || instrumentRef.exchange || null
    }),
    [exchange, instrumentRef, symbol]
  );

  useEffect(() => {
    if (selectedAccount?.broker_code) {
      setBrokerCode(selectedAccount.broker_code);
    }
  }, [selectedAccount?.broker_code]);

  useEffect(() => {
    const account = selectedAccount;
    if (!account || symbol.trim().length < 1) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      setSearchLoading(true);
      startTransition(async () => {
        try {
          const result = await searchBrokerInstruments(account.id, {
            q: symbol.trim(),
            exchange: exchange.trim() || undefined,
            limit: 8
          });
          setSuggestions(result);
        } catch {
          setSuggestions([]);
        } finally {
          setSearchLoading(false);
        }
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [exchange, selectedAccount, startTransition, symbol]);

  useEffect(() => {
    const account = selectedAccount;
    if (!account || !activeInstrument.symbol) {
      setPreview({ quote: null, ohlc: null, loading: false, error: "" });
      return;
    }
    const accountIdForFetch = account.id;
    let cancelled = false;
    async function load() {
      setPreview((current) => ({ ...current, loading: true, error: "" }));
      try {
        const [quotes, ohlcRows] = await Promise.all([
          getDataQuotes(accountIdForFetch, { instruments: [activeInstrument] }),
          getDataOhlc(accountIdForFetch, { instruments: [activeInstrument] })
        ]);
        if (cancelled) return;
        setPreview({
          quote: quotes[0] ?? null,
          ohlc: (ohlcRows[0] as JsonObject | undefined) ?? null,
          loading: false,
          error: ""
        });
      } catch (caught) {
        if (cancelled) return;
        setPreview({
          quote: null,
          ohlc: null,
          loading: false,
          error: caught instanceof Error ? caught.message : "Could not fetch live preview."
        });
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeInstrument, selectedAccount]);

  function selectSuggestion(row: InstrumentSearchRow) {
    setSymbol(row.symbol);
    setExchange(row.exchange ?? exchange);
    setInstrumentRef(instrumentFromSearch(row));
    setSelectedSearchLabel([row.symbol, row.exchange, row.instrument_type].filter(Boolean).join(" · "));
    setSuggestions([]);
  }

  function updateCondition(index: number, patch: Partial<AlertCondition>) {
    setConditions((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addCondition() {
    setConditions((current) => [...current, { field: "ltp", operator: "gte", value: 0 }]);
  }

  function removeCondition(index: number) {
    setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function channelSelection(): AlertChannelSelection {
    const enabled = [
      channelInApp ? "in_app" : null,
      channelDiscord ? "discord" : null,
      channelTelegram ? "telegram" : null
    ].filter(Boolean) as AlertChannelType[];
    return {
      inherit_defaults: inheritDefaults,
      enabled: enabled.length ? enabled : ["in_app"]
    };
  }

  function workflowPayload() {
    const workflowDsl: AlertWorkflowDsl = {
      combine,
      cooldown_seconds: Number(cooldownSeconds || 0),
      conditions,
      notification: {
        level,
        title_template: titleTemplate,
        message_template: messageTemplate
      },
      channels: channelSelection()
    };

    return {
      name,
      description,
      account_id: accountId || null,
      broker_code: selectedAccount?.broker_code ?? (brokerCode || null),
      symbol: symbol || null,
      exchange: exchange || null,
      instrument_ref: serializeInstrumentRef(activeInstrument),
      workflow_dsl: workflowDsl,
      graph_dsl: buildGraph(workflowDsl),
      editor_mode: editorMode,
      channel_override: channelSelection(),
      status
    };
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        const payload = workflowPayload();
        const workflow = initialWorkflow?.id
          ? await updateAlertWorkflow(initialWorkflow.id, payload)
          : await createAlertWorkflow(payload);
        router.push(`/alerts/workflows/${workflow.id}`);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save workflow.");
      }
    });
  }

  function previewTest() {
    if (!initialWorkflow) return;
    setError("");
    setMatchPreview("");
    startTransition(async () => {
      try {
        const ohlcRaw = (preview.ohlc?.raw as JsonObject | undefined) ?? {};
        const quoteDetail = (preview.quote?.detail as JsonObject | undefined) ?? {};
        const quoteRaw = (quoteDetail.raw as JsonObject | undefined) ?? {};
        const result = await testAlertWorkflow(initialWorkflow.id, {
          symbol,
          exchange,
          ltp: Number(preview.quote?.ltp ?? conditions[0]?.value ?? 0),
          open: Number((preview.ohlc?.open as number | undefined) ?? 0),
          high: Number((preview.ohlc?.high as number | undefined) ?? 0),
          low: Number((preview.ohlc?.low as number | undefined) ?? 0),
          close: Number((preview.ohlc?.close as number | undefined) ?? 0),
          volume: Number((ohlcRaw.volume as number | undefined) ?? 120000),
          open_interest: Number((quoteRaw.open_interest as number | undefined) ?? 15000)
        });
        setMatchPreview(result.matched ? `Matched: ${result.reason}` : `No match: ${result.reason}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not test workflow.");
      }
    });
  }

  return (
    <div className="grid gap-6">
      {error ? <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div> : null}
      {matchPreview ? <div className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">{matchPreview}</div> : null}

      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 text-sm font-bold">Workflow identity</div>
        <div className="grid gap-3 min-[900px]:grid-cols-2">
          <div className="grid gap-2">
            <Input onChange={(event) => setName(event.target.value)} placeholder="Workflow name" title="Use a short trading-oriented name. Example: RELIANCE breakout above 1430." value={name} />
            <HelpText>This is the name shown in workflow lists and alert history.</HelpText>
          </div>
          <div className="grid gap-2">
            <Input onChange={(event) => setDescription(event.target.value)} placeholder="Description" title="Optional human note about why this workflow exists." value={description} />
            <HelpText>Use this for strategy intent, not execution logic.</HelpText>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 text-sm font-bold">Symbol selection</div>
        <div className="grid gap-3 min-[900px]:grid-cols-[1.3fr_1fr_160px]">
          <div className="grid gap-2">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) => setAccountId(event.target.value)}
              value={accountId}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} · {account.broker_code}
                </option>
              ))}
            </select>
            <HelpText>The broker account decides which instrument universe and quote API will be used.</HelpText>
          </div>
          <div className="relative grid gap-2">
            <Input
              onChange={(event) => {
                setSymbol(event.target.value.toUpperCase());
                setInstrumentRef({ symbol: event.target.value.toUpperCase(), exchange });
                setSelectedSearchLabel("");
              }}
              placeholder="Search symbol"
              title="Start typing to search the synced broker instrument master for live suggestions."
              value={symbol}
            />
            <HelpText>{searchLoading ? "Searching instruments..." : selectedSearchLabel || "Type a symbol name or trading symbol and choose a suggestion."}</HelpText>
            {suggestions.length ? (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[280px] overflow-y-auto rounded-md border border-border bg-background shadow-auth">
                {suggestions.map((row) => (
                  <button
                    className="grid w-full gap-1 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                    key={[row.symbol, row.exchange, row.trading_symbol].join(":")}
                    onClick={() => selectSuggestion(row)}
                    type="button"
                  >
                    <span className="font-semibold">{row.symbol}</span>
                    <span className="text-xs text-muted-foreground">
                      {[row.exchange, row.instrument_type, row.name, row.trading_symbol].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Input
              onChange={(event) => {
                setExchange(event.target.value.toUpperCase());
                setInstrumentRef((current) => ({ ...current, exchange: event.target.value.toUpperCase() }));
              }}
              placeholder="Exchange"
              title="Usually NSE or BSE. Kept editable in case the selected trading symbol exists on multiple exchanges."
              value={exchange}
            />
            <HelpText>Used together with the selected instrument identifiers for market data requests.</HelpText>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Live symbol preview</div>
            <HelpText>While this page stays open, the editor refreshes quote and OHLC data for the selected symbol every few seconds.</HelpText>
          </div>
          <div className="text-xs text-muted-foreground">{preview.loading ? "Refreshing..." : preview.quote ? "Live preview active" : "No symbol selected"}</div>
        </div>
        {preview.error ? <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{preview.error}</div> : null}
        <div className="grid gap-4 min-[1080px]:grid-cols-[280px_280px_1fr]">
          <div className="rounded-md border border-border p-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">Quote</div>
            <div className="mt-2 text-2xl font-bold">{preview.quote?.ltp ?? "-"}</div>
            <div className="mt-2 text-xs text-muted-foreground">{symbol || "-"} · {exchange || "-"}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">OHLC</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <span>Open: {String(preview.ohlc?.open ?? "-")}</span>
              <span>High: {String(preview.ohlc?.high ?? "-")}</span>
              <span>Low: {String(preview.ohlc?.low ?? "-")}</span>
              <span>Close: {String(preview.ohlc?.close ?? "-")}</span>
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs font-bold uppercase text-muted-foreground">Raw payload</div>
            <pre className="mt-2 max-h-[240px] overflow-auto text-xs text-muted-foreground">{compactPreview({ quote: preview.quote, ohlc: preview.ohlc })}</pre>
          </div>
        </div>
      </div>

      <Tabs onValueChange={(value) => setEditorMode(value as EditorMode)} value={editorMode}>
        <TabsList>
          <TabsTrigger value="rule">Rule Builder</TabsTrigger>
          <TabsTrigger value="graph">Graph Builder</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-6" value="rule">
          <RuleEditor
            addCondition={addCondition}
            combine={combine}
            conditions={conditions}
            cooldownSeconds={cooldownSeconds}
            level={level}
            messageTemplate={messageTemplate}
            removeCondition={removeCondition}
            setCombine={setCombine}
            setCooldownSeconds={setCooldownSeconds}
            setLevel={setLevel}
            setMessageTemplate={setMessageTemplate}
            setTitleTemplate={setTitleTemplate}
            titleTemplate={titleTemplate}
            updateCondition={updateCondition}
          />
        </TabsContent>
        <TabsContent className="mt-6" value="graph">
          <div className="grid gap-4 min-[960px]:grid-cols-[1fr_1fr_1fr]">
            <div className="rounded-lg border border-border p-4">
              <div className="mb-2 text-sm font-bold">Trigger</div>
              <HelpText>The graph starts from the live quote stream for the selected symbol and account.</HelpText>
            </div>
            {conditions.map((condition, index) => (
              <div className="rounded-lg border border-border p-4" key={`${condition.field}-${index}`}>
                <div className="mb-2 text-sm font-bold">Condition node {index + 1}</div>
                <ConditionEditor condition={condition} index={index} removeCondition={removeCondition} updateCondition={updateCondition} />
              </div>
            ))}
            <div className="rounded-lg border border-border p-4">
              <div className="mb-2 text-sm font-bold">Notification node</div>
              <HelpText>These templates render the alert title and body when the conditions match.</HelpText>
              <div className="mt-3 grid gap-3">
                <Input onChange={(event) => setTitleTemplate(event.target.value)} placeholder="Title template" value={titleTemplate} />
                <Input onChange={(event) => setMessageTemplate(event.target.value)} placeholder="Message template" value={messageTemplate} />
                <Input onChange={(event) => setLevel(event.target.value)} placeholder="Level" value={level} />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="grid gap-4 rounded-lg border border-border p-4 min-[960px]:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-bold">Channels</div>
          <HelpText>Choose where the alert should be delivered. Inherit defaults uses your channel settings page as the base.</HelpText>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2" title="Always recommended so alerts remain visible inside the app."><input checked={channelInApp} onChange={(event) => setChannelInApp(event.target.checked)} type="checkbox" />In-app</label>
            <label className="flex items-center gap-2" title="Send through your saved Discord webhook configuration."><input checked={channelDiscord} onChange={(event) => setChannelDiscord(event.target.checked)} type="checkbox" />Discord</label>
            <label className="flex items-center gap-2" title="Send through your saved Telegram bot configuration."><input checked={channelTelegram} onChange={(event) => setChannelTelegram(event.target.checked)} type="checkbox" />Telegram</label>
            <label className="flex items-center gap-2" title="When enabled, default channels from the alert channel settings page are included automatically."><input checked={inheritDefaults} onChange={(event) => setInheritDefaults(event.target.checked)} type="checkbox" />Inherit defaults</label>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-bold">Lifecycle</div>
          <HelpText>Active workflows are evaluated by the alert worker. Inactive workflows stay saved but do not trigger.</HelpText>
          <select className="mt-3 h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setStatus(event.target.value as "active" | "inactive")} value={status}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button disabled={isPending || !name.trim() || !symbol.trim()} onClick={save} type="button">
          {isPending ? "Saving..." : initialWorkflow?.id ? "Save workflow" : "Create workflow"}
        </Button>
        {initialWorkflow?.id ? (
          <Button disabled={isPending} onClick={previewTest} type="button" variant="outline">
            Test workflow
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RuleEditor({
  addCondition,
  combine,
  conditions,
  cooldownSeconds,
  level,
  messageTemplate,
  removeCondition,
  setCombine,
  setCooldownSeconds,
  setLevel,
  setMessageTemplate,
  setTitleTemplate,
  titleTemplate,
  updateCondition
}: {
  addCondition: () => void;
  combine: "all" | "any";
  conditions: AlertCondition[];
  cooldownSeconds: string;
  level: string;
  messageTemplate: string;
  removeCondition: (index: number) => void;
  setCombine: (value: "all" | "any") => void;
  setCooldownSeconds: (value: string) => void;
  setLevel: (value: string) => void;
  setMessageTemplate: (value: string) => void;
  setTitleTemplate: (value: string) => void;
  titleTemplate: string;
  updateCondition: (index: number, patch: Partial<AlertCondition>) => void;
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-border p-4">
      <div className="grid gap-3 min-[960px]:grid-cols-[180px_180px_1fr]">
        <div className="grid gap-2">
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setCombine(event.target.value as "all" | "any")} value={combine}>
            <option value="all">All conditions</option>
            <option value="any">Any condition</option>
          </select>
          <HelpText>`All` means every condition must match. `Any` means one matching condition is enough.</HelpText>
        </div>
        <div className="grid gap-2">
          <Input onChange={(event) => setCooldownSeconds(event.target.value)} placeholder="Cooldown seconds" title="Minimum wait time before the same workflow can trigger again." value={cooldownSeconds} />
          <HelpText>Prevents repeated alerts on every tick after the first match.</HelpText>
        </div>
        <div className="grid gap-2">
          <Input onChange={(event) => setLevel(event.target.value)} placeholder="Level" title="Examples: info, warning, critical." value={level} />
          <HelpText>Used only for display and downstream routing emphasis.</HelpText>
        </div>
      </div>
      <div className="grid gap-3">
        {conditions.map((condition, index) => (
          <div className="rounded-lg border border-border p-4" key={`${condition.field}-${index}`}>
            <ConditionEditor condition={condition} index={index} removeCondition={removeCondition} updateCondition={updateCondition} />
          </div>
        ))}
      </div>
      <Button onClick={addCondition} type="button" variant="outline">Add condition</Button>
      <div className="grid gap-3 min-[960px]:grid-cols-2">
        <div className="grid gap-2">
          <Input onChange={(event) => setTitleTemplate(event.target.value)} placeholder="Title template" value={titleTemplate} />
          <HelpText>Supports placeholders like {"{symbol}"} and {"{ltp}"}.</HelpText>
        </div>
        <div className="grid gap-2">
          <Input onChange={(event) => setMessageTemplate(event.target.value)} placeholder="Message template" value={messageTemplate} />
          <HelpText>Write the trader-facing alert message body.</HelpText>
        </div>
      </div>
    </div>
  );
}

function ConditionEditor({
  condition,
  index,
  removeCondition,
  updateCondition
}: {
  condition: AlertCondition;
  index: number;
  removeCondition: (index: number) => void;
  updateCondition: (index: number, patch: Partial<AlertCondition>) => void;
}) {
  const fieldMeta = fieldOptions.find((item) => item.value === condition.field);
  const operatorMeta = operatorOptions.find((item) => item.value === condition.operator);
  const compareMeta = compareOptions.find((item) => item.value === (condition.compare_to ?? ""));

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 min-[960px]:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { field: event.target.value })} value={condition.field}>
          {fieldOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { operator: event.target.value })} value={condition.operator}>
          {operatorOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <Input onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder="Value" value={String(condition.value ?? "")} />
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { compare_to: event.target.value || null })} value={condition.compare_to ?? ""}>
          {compareOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <Button onClick={() => removeCondition(index)} type="button" variant="ghost">Remove</Button>
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <div>{fieldMeta?.help}</div>
        <div>{operatorMeta?.help}</div>
        <div>{compareMeta?.help}</div>
      </div>
    </div>
  );
}
