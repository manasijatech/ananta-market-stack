"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createAlertWorkflow,
  testAlertWorkflow,
  updateAlertWorkflow
} from "@/service/actions/alerts";
import type {
  AlertChannelType,
  AlertChannelSelection,
  AlertCondition,
  AlertGraphDsl,
  AlertWorkflow,
  AlertWorkflowDsl,
  EditorMode
} from "@/service/types/alerts";
import type { BrokerAccount } from "@/service/types/broker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function buildGraph(dsl: AlertWorkflowDsl): AlertGraphDsl {
  const nodes: AlertGraphDsl["nodes"] = [
    { id: "trigger", kind: "trigger" as const, label: "Live tick", config: { combine: dsl.combine } }
  ];
  const edges: AlertGraphDsl["edges"] = [];
  for (const [index, condition] of dsl.conditions.entries()) {
    const id = `condition-${index + 1}`;
    nodes.push({ id, kind: "condition" as const, label: `${condition.field} ${condition.operator}`, config: condition });
    edges.push({ source: "trigger", target: id });
  }
  nodes.push({ id: "notification", kind: "notification" as const, label: "Notify", config: dsl.notification });
  for (const node of nodes.filter((item) => item.kind === "condition")) {
    edges.push({ source: node.id, target: "notification" });
  }
  nodes.push({ id: "channels", kind: "channel" as const, label: "Channels", config: dsl.channels });
  edges.push({ source: "notification", target: "channels" });
  return { nodes, edges };
}

const fieldOptions = ["ltp", "volume", "open_interest", "high", "low", "open", "close"];
const operatorOptions = ["gt", "gte", "lt", "lte", "crosses_above", "crosses_below", "pct_change_gte", "pct_change_lte"];
const compareOptions = ["", "open", "close", "high", "low"];

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
  const [accountId, setAccountId] = useState(initialWorkflow?.account_id ?? "");
  const [brokerCode, setBrokerCode] = useState(initialWorkflow?.broker_code ?? "");
  const [symbol, setSymbol] = useState(initialWorkflow?.symbol ?? "");
  const [exchange, setExchange] = useState(initialWorkflow?.exchange ?? "NSE");
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

  const selectedAccount = accounts.find((item) => item.id === accountId);

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
      instrument_ref: { symbol: symbol || null, exchange: exchange || null },
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
        const result = await testAlertWorkflow(initialWorkflow.id, {
          symbol,
          exchange,
          ltp: Number(conditions[0]?.value ?? 0),
          open: Number(conditions[0]?.value ?? 0) - 5,
          high: Number(conditions[0]?.value ?? 0),
          low: Number(conditions[0]?.value ?? 0) - 10,
          volume: 120000,
          open_interest: 15000
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
      <div className="grid gap-3 min-[900px]:grid-cols-2">
        <Input onChange={(event) => setName(event.target.value)} placeholder="Workflow name" value={name} />
        <Input onChange={(event) => setDescription(event.target.value)} placeholder="Description" value={description} />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          onChange={(event) => {
            const nextId = event.target.value;
            const nextAccount = accounts.find((item) => item.id === nextId);
            setAccountId(nextId);
            setBrokerCode(nextAccount?.broker_code ?? "");
          }}
          value={accountId}
        >
          <option value="">No broker account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label} · {account.broker_code}
            </option>
          ))}
        </select>
        <Input onChange={(event) => setBrokerCode(event.target.value)} placeholder="Broker code" value={selectedAccount?.broker_code ?? brokerCode} />
        <Input onChange={(event) => setSymbol(event.target.value)} placeholder="Symbol" value={symbol} />
        <Input onChange={(event) => setExchange(event.target.value)} placeholder="Exchange" value={exchange} />
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
              <div className="mb-3 text-sm font-bold">Trigger</div>
              <div className="text-xs text-muted-foreground">Live tick for the selected symbol and broker account.</div>
            </div>
            {conditions.map((condition, index) => (
              <div className="rounded-lg border border-border p-4" key={`${condition.field}-${index}`}>
                <div className="mb-3 text-sm font-bold">Condition node {index + 1}</div>
                <ConditionEditor condition={condition} index={index} removeCondition={removeCondition} updateCondition={updateCondition} />
              </div>
            ))}
            <div className="rounded-lg border border-border p-4">
              <div className="mb-3 text-sm font-bold">Notification node</div>
              <div className="grid gap-3">
                <Input onChange={(event) => setTitleTemplate(event.target.value)} placeholder="Title template" value={titleTemplate} />
                <Input onChange={(event) => setMessageTemplate(event.target.value)} placeholder="Message template" value={messageTemplate} />
                <Input onChange={(event) => setLevel(event.target.value)} placeholder="Level" value={level} />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="grid gap-3 rounded-lg border border-border p-4 min-[960px]:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-bold">Channels</div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2"><input checked={channelInApp} onChange={(event) => setChannelInApp(event.target.checked)} type="checkbox" />In-app</label>
            <label className="flex items-center gap-2"><input checked={channelDiscord} onChange={(event) => setChannelDiscord(event.target.checked)} type="checkbox" />Discord</label>
            <label className="flex items-center gap-2"><input checked={channelTelegram} onChange={(event) => setChannelTelegram(event.target.checked)} type="checkbox" />Telegram</label>
            <label className="flex items-center gap-2"><input checked={inheritDefaults} onChange={(event) => setInheritDefaults(event.target.checked)} type="checkbox" />Inherit defaults</label>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-bold">Lifecycle</div>
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setStatus(event.target.value as "active" | "inactive")} value={status}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button disabled={isPending || !name.trim()} onClick={save} type="button">
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
    <div className="grid gap-4">
      <div className="grid gap-3 min-[960px]:grid-cols-[160px_160px_1fr]">
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setCombine(event.target.value as "all" | "any")} value={combine}>
          <option value="all">All conditions</option>
          <option value="any">Any condition</option>
        </select>
        <Input onChange={(event) => setCooldownSeconds(event.target.value)} placeholder="Cooldown seconds" value={cooldownSeconds} />
        <Input onChange={(event) => setLevel(event.target.value)} placeholder="Level" value={level} />
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
        <Input onChange={(event) => setTitleTemplate(event.target.value)} placeholder="Title template" value={titleTemplate} />
        <Input onChange={(event) => setMessageTemplate(event.target.value)} placeholder="Message template" value={messageTemplate} />
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
  return (
    <div className="grid gap-3 min-[960px]:grid-cols-[1fr_1fr_1fr_1fr_auto]">
      <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { field: event.target.value })} value={condition.field}>
        {fieldOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { operator: event.target.value })} value={condition.operator}>
        {operatorOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <Input onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder="Value" value={String(condition.value ?? "")} />
      <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { compare_to: event.target.value || null })} value={condition.compare_to ?? ""}>
        {compareOptions.map((item) => <option key={item} value={item}>{item || "Reference field"}</option>)}
      </select>
      <Button onClick={() => removeCondition(index)} type="button" variant="ghost">Remove</Button>
    </div>
  );
}
