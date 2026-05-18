"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import {
 getDataOhlc,
 getDataQuotes,
 searchDefaultBrokerInstruments
} from "@/service/actions/broker";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import {
 compilePreviewAlertWorkflow,
 createAlertWorkflow,
 deleteAlertWorkflow,
 deployAlertWorkflow,
 explainAlertWorkflow,
 getWorkflowSampleAlerts,
 getAlertConditionRegistry,
 getAlertLlmPlaceholders,
 previewAlertUniverse,
 previewAlertWorkflowLlmContext,
 sendWorkflowTestNotification,
 testAlertWorkflow,
 testAlertWorkflowLlm,
 updateAlertWorkflow,
 validateAlertWorkflow
} from "@/service/actions/alerts";
import type {
 AlertChannelSelection,
 AlertChannelType,
 AlertCondition,
 AlertConditionRegistry,
 AlertGraphDsl,
 AlertTargetEntry,
 AlertUniversePreview,
 AlertWorkflow,
 AlertWorkflowDsl,
 EditorMode,
 InstrumentRef,
 AlertWorkflowTargeting
} from "@/service/types/alerts";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type { BrokerAccount, InstrumentSearchRow, JsonObject, LlmProvider, LlmProviderConfig, QuoteResponse } from "@/service/types/broker";
import type { Watchlist } from "@/service/types/watchlist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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
 { value: "last_price", label: "Raw last price", help: "Last price from the raw broker payload." },
 { value: "average_price", label: "Average price", help: "Broker-reported average traded price when available." },
 { value: "volume", label: "Volume", help: "Current traded volume from the live quote payload." },
 { value: "avg_volume", label: "Average volume", help: "Reference average volume when provided by enrichment." },
 { value: "volume_ratio", label: "Volume ratio", help: "Computed volume divided by average/reference volume." },
 { value: "open_interest", label: "Open interest", help: "Useful for derivatives and option-chain driven workflows." },
 { value: "previous_open_interest", label: "Previous open interest", help: "Previous open interest when available." },
 { value: "oi_day_change", label: "OI day change", help: "Open-interest day change." },
 { value: "oi_day_change_percentage", label: "OI day change %", help: "Open-interest day change percentage." },
 { value: "high", label: "Day high", help: "Current day high from OHLC/live quote data." },
 { value: "low", label: "Day low", help: "Current day low from OHLC/live quote data." },
 { value: "open", label: "Day open", help: "Current day open." },
 { value: "close", label: "Previous close", help: "Reference close returned by the broker." },
 { value: "day_change", label: "Day change", help: "Broker-reported absolute day change." },
 { value: "day_change_perc", label: "Day change %", help: "Broker-reported day change percentage." },
 { value: "reference_price", label: "Reference price", help: "Computed reference price for change calculations." },
 { value: "change_pct", label: "Computed change %", help: "Computed percent change versus selected reference." },
 { value: "abs_change", label: "Absolute change", help: "Computed absolute move versus selected reference." },
 { value: "gap_pct", label: "Gap %", help: "Computed open-versus-close gap percentage." },
 { value: "last_trade_quantity", label: "Last trade quantity", help: "Quantity from the latest trade." },
 { value: "last_trade_time", label: "Last trade time", help: "Latest trade timestamp from the broker." },
 { value: "total_buy_quantity", label: "Total buy quantity", help: "Total buy quantity in the order book." },
 { value: "total_sell_quantity", label: "Total sell quantity", help: "Total sell quantity in the order book." },
 { value: "best_bid_price", label: "Best bid price", help: "Top-of-book bid price." },
 { value: "best_bid_quantity", label: "Best bid quantity", help: "Top-of-book bid quantity." },
 { value: "best_bid_orders", label: "Best bid orders", help: "Top-of-book bid order count." },
 { value: "best_ask_price", label: "Best ask price", help: "Top-of-book ask price." },
 { value: "best_ask_quantity", label: "Best ask quantity", help: "Top-of-book ask quantity." },
 { value: "best_ask_orders", label: "Best ask orders", help: "Top-of-book ask order count." },
 { value: "bid_price", label: "Broker bid price", help: "Broker-provided bid price when available." },
 { value: "bid_quantity", label: "Broker bid quantity", help: "Broker-provided bid quantity when available." },
 { value: "offer_price", label: "Broker offer price", help: "Broker-provided offer price when available." },
 { value: "offer_quantity", label: "Broker offer quantity", help: "Broker-provided offer quantity when available." },
 { value: "upper_circuit_limit", label: "Upper circuit", help: "Upper circuit price limit." },
 { value: "lower_circuit_limit", label: "Lower circuit", help: "Lower circuit price limit." },
 { value: "week_52_high", label: "52-week high", help: "52-week high from the broker payload." },
 { value: "week_52_low", label: "52-week low", help: "52-week low from the broker payload." },
 { value: "high_trade_range", label: "High trade range", help: "Broker high trade range when available." },
 { value: "low_trade_range", label: "Low trade range", help: "Broker low trade range when available." },
 { value: "implied_volatility", label: "Implied volatility", help: "Implied volatility when available for derivatives." },
 { value: "market_cap", label: "Market cap", help: "Market capitalization when provided by the broker." }
];

const operatorOptions = [
 { value: "gt", label: "Greater than", help: "Trigger when the field becomes greater than the value." },
 { value: "gte", label: "Greater than or equal", help: "Trigger when the field reaches or exceeds the value." },
 { value: "lt", label: "Less than", help: "Trigger when the field becomes lower than the value." },
 { value: "lte", label: "Less than or equal", help: "Trigger when the field reaches or falls below the value." },
 { value: "crosses_above", label: "Crosses above", help: "Needs live updates. Triggers only when the field moves from below to above the value." },
 { value: "crosses_below", label: "Crosses below", help: "Needs live updates. Triggers only when the field moves from above to below the value." },
 { value: "pct_change_gte", label: "Percent change up", help: "Trigger when percent change versus a reference field reaches the value." },
 { value: "pct_change_lte", label: "Percent change down", help: "Trigger when percent change versus a reference field falls below the value." },
 { value: "rolling_pct_change_gte", label: "Rolling percent move up", help: "Trigger when percent change over a rolling window reaches the value." },
 { value: "rolling_pct_change_lte", label: "Rolling percent move down", help: "Trigger when percent change over a rolling window falls below the value." },
 { value: "abs_change_gte", label: "Absolute move up", help: "Trigger when absolute change versus a reference reaches the value." },
 { value: "abs_change_lte", label: "Absolute move down", help: "Trigger when absolute change versus a reference falls below the value." },
 { value: "field_gt", label: "Field greater than field", help: "Compare the selected field to another same-tick field." },
 { value: "field_gte", label: "Field greater/equal field", help: "Compare the selected field to another same-tick field." },
 { value: "field_lt", label: "Field less than field", help: "Compare the selected field to another same-tick field." },
 { value: "field_lte", label: "Field less/equal field", help: "Compare the selected field to another same-tick field." },
 { value: "breaks_day_high", label: "Breaks day high", help: "Trigger when price reaches or breaks the current day high." },
 { value: "breaks_day_low", label: "Breaks day low", help: "Trigger when price reaches or breaks the current day low." },
 { value: "gap_up_pct_gte", label: "Gap up percent", help: "Trigger when the open gaps up versus previous close by the configured percent." },
 { value: "gap_down_pct_gte", label: "Gap down percent", help: "Trigger when the open gaps down versus previous close by the configured percent." },
 { value: "volume_spike", label: "Volume spike", help: "Trigger when volume is a multiple of the reference volume." },
 { value: "relative_volume_gte", label: "Relative volume", help: "Trigger when current volume is high versus average/reference volume." },
 { value: "oi_change_gte", label: "Open interest increase", help: "Trigger when open interest increases by at least the configured value." },
 { value: "oi_change_lte", label: "Open interest decrease", help: "Trigger when open interest decreases by at least the configured value." },
 { value: "always", label: "Always", help: "Always match. Useful for delivery testing or staged workflow construction." }
];

const compareOptions = [
 { value: "", label: "Manual value", help: "Use the numeric value box directly." },
 ...fieldOptions.map((item) => ({
 value: item.value,
 label: `Compare to ${item.label.toLowerCase()}`,
 help: item.help
 }))
];

const messageTemplateFields = [
 "symbol",
 "exchange",
 "ltp",
 "open",
 "high",
 "low",
 "close",
 "last_price",
 "average_price",
 "reference_price",
 "change_pct",
 "abs_change",
 "gap_pct",
 "volume",
 "avg_volume",
 "volume_ratio",
 "open_interest",
 "previous_open_interest",
 "oi_day_change",
 "oi_day_change_percentage",
 "day_change",
 "day_change_perc",
 "last_trade_quantity",
 "last_trade_time",
 "total_buy_quantity",
 "total_sell_quantity",
 "best_bid_price",
 "best_bid_quantity",
 "best_bid_orders",
 "best_ask_price",
 "best_ask_quantity",
 "best_ask_orders",
 "bid_price",
 "bid_quantity",
 "offer_price",
 "offer_quantity",
 "upper_circuit_limit",
 "lower_circuit_limit",
 "week_52_high",
 "week_52_low",
 "high_trade_range",
 "low_trade_range",
 "implied_volatility",
 "market_cap",
 "received_at",
 "broker_code",
 "account_id",
 "alpha_product",
 "alpha_event_id",
 "category",
 "related_categories",
 "company_name",
 "headline",
 "title",
 "summary",
 "alpha_category_filter",
 "feed_trigger_reason",
 "instrument_key",
 "connection_id",
 "connection_index",
 "symbol_count",
 "capacity"
];
const alphaFeedProducts = ["news", "announcements", "earnings", "concalls", "alerts"] as const;
const defaultActivePeriod = {
 enabled: true,
 timezone: "Asia/Kolkata",
 days: ["mon", "tue", "wed", "thu", "fri"],
 sessions: [{ label: "Regular market", start: "09:15", end: "15:30" }],
 exchanges: [],
 exchange_types: [],
 segments: [],
 instrument_types: []
};
const dayOptions = [
 ["mon", "Mon"],
 ["tue", "Tue"],
 ["wed", "Wed"],
 ["thu", "Thu"],
 ["fri", "Fri"],
 ["sat", "Sat"],
 ["sun", "Sun"]
] as const;

const targetListExample = "RELIANCE,NSE\nTCS,NSE\nINFY,NSE";

const fallbackLlmPrompt = `Analyze why this alert triggered for {symbol}.

Trigger: @trigger.reason
Workflow: @trigger.summary
Price data: @price.full
Recent news: @news(days=2, max_pages=1, max_items=5)
Recent announcements: @announcements(days=2, max_pages=1, max_items=5, detailed=true)
Recent earnings: @earnings(days=2, max_pages=1, max_items=3, detailed=true)
Recent concalls: @concalls(days=2, max_pages=1, max_items=2)

Give a concise market-relevant explanation, include likely drivers, and mention when context is insufficient.`;

type PreviewState = {
 quote: QuoteResponse | null;
 ohlc: JsonObject | null;
 loading: boolean;
 error: string;
};

type UniverseSymbolPreview = {
 symbol: string;
 exchange?: string | null;
 instrument_ref?: InstrumentRef;
 source_label?: string | null;
 source_type?: string | null;
};

type DslSuggestion = {
 value: string;
 label: string;
 description: string;
 kind: "field" | "operator" | "function" | "placeholder";
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

function buildTargetEntry(symbol: string, exchange: string, instrumentRef: InstrumentRef): AlertTargetEntry | null {
 const normalizedSymbol = symbol.trim().toUpperCase();
 if (!normalizedSymbol) return null;
 const normalizedExchange = exchange.trim().toUpperCase() || null;
 return {
 symbol: normalizedSymbol,
 exchange: normalizedExchange,
 instrument_ref: {
 ...instrumentRef,
 symbol: normalizedSymbol,
 exchange: normalizedExchange
 },
 label: null,
 tags: [],
 metadata: {}
 };
}

function normalizeTargets(entries: AlertTargetEntry[]): AlertTargetEntry[] {
 const seen = new Set<string>();
 const next: AlertTargetEntry[] = [];
 for (const entry of entries) {
 const normalized = buildTargetEntry(entry.symbol, entry.exchange ?? "", entry.instrument_ref);
 if (!normalized) continue;
 const key = `${normalized.symbol}:${normalized.exchange ?? ""}`;
 if (seen.has(key)) continue;
 seen.add(key);
 next.push(normalized);
 }
 return next;
}

function targetDisplay(entry: AlertTargetEntry) {
 return [entry.symbol, entry.exchange].filter(Boolean).join(" · ");
}

function announcementCategoryLabel(category: string) {
 const normalized = category.replace(/^AnnouncementCategory\./, "").replace(/_/g, " ").trim();
 if (!normalized || normalized.includes("/")) return category;
 return normalized.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function parseBulkTargets(text: string, fallbackExchange: string): AlertTargetEntry[] {
 return normalizeTargets(
 text
 .split(/\r?\n/)
 .map((raw) => raw.trim())
 .filter(Boolean)
 .map((raw) => {
 const [symbolPart, exchangePart] = raw.split(/[,:|\s]+/).filter(Boolean);
 return buildTargetEntry(symbolPart ?? "", exchangePart ?? fallbackExchange, {
 symbol: (symbolPart ?? "").toUpperCase(),
 exchange: (exchangePart ?? fallbackExchange).toUpperCase()
 });
 })
 .filter(Boolean) as AlertTargetEntry[]
 );
}

function dslValue(value: unknown): string {
 if (typeof value === "number" || typeof value === "boolean") return String(value);
 const asNumber = Number(value);
 if (typeof value === "string" && value.trim() !== "" && Number.isFinite(asNumber)) return value.trim();
 return JSON.stringify(String(value ?? ""));
}

function conditionToDsl(condition: AlertCondition): string {
 const field = condition.field || "ltp";
 const value = dslValue(condition.value ?? 0);
 const compareTo = condition.compare_to || "";
 const simple = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as Record<string, string>;
 if (simple[condition.operator]) {
 return `${field} ${simple[condition.operator]} ${value}`;
 }
 if (condition.operator.startsWith("field_") && compareTo) {
 const symbol = { field_gt: ">", field_gte: ">=", field_lt: "<", field_lte: "<=" }[condition.operator] ?? ">";
 return `${field} ${symbol} ${compareTo}`;
 }
 const args = [field];
 if (condition.value !== null && condition.value !== undefined && condition.value !== "") args.push(`value=${value}`);
 if (compareTo) args.push(`compare_to=${compareTo}`);
 if (condition.window_seconds) args.push(`window_seconds=${condition.window_seconds}`);
 return `${condition.operator || "always"}(${args.join(", ")})`;
}

function conditionsToDsl(combine: "all" | "any", conditions: AlertCondition[]): string {
 const parts = conditions.map(conditionToDsl);
 if (!parts.length) return "always()";
 if (parts.length === 1) return parts[0];
 return `${combine}(${parts.join(", ")})`;
}

function conditionPhrase(condition: AlertCondition): string {
 const field = fieldOptions.find((item) => item.value === condition.field)?.label.toLowerCase() ?? condition.field;
 const operator = operatorOptions.find((item) => item.value === condition.operator)?.label.toLowerCase() ?? condition.operator;
 const value = condition.value ?? "";
 const compare = condition.compare_to ? ` vs ${condition.compare_to}` : "";
 return `${field} ${operator}${value !== "" ? ` ${value}` : ""}${compare}`;
}

function suggestedTemplates(conditions: AlertCondition[], combine: "all" | "any") {
 const joined = conditions.map(conditionPhrase).join(combine === "all" ? " and " : " or ");
 const summary = joined || "the configured market condition";
 return {
 title: `{symbol} matched ${conditions.length > 1 ? "multi-condition" : "alert"} workflow`,
 message: `{symbol} matched ${summary}. LTP {ltp}, change {change_pct}%, volume {volume}, OI {open_interest}.`
 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
 return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logicNodeToConditions(node: unknown): { combine: "all" | "any"; conditions: AlertCondition[]; flattened: boolean } | null {
 if (!isRecord(node)) return null;
 const kind = String(node.kind ?? "condition");
 if (kind === "all" || kind === "any") {
 const children = Array.isArray(node.children) ? node.children : [];
 const conditions: AlertCondition[] = [];
 let flattened = false;
 for (const child of children) {
 const parsed = logicNodeToConditions(child);
 if (!parsed) continue;
 conditions.push(...parsed.conditions);
 flattened = flattened || parsed.flattened || parsed.combine !== kind;
 }
 return { combine: kind, conditions, flattened };
 }
 if (kind === "not") {
 return { combine: "all", conditions: [], flattened: true };
 }
 return {
 combine: "all",
 conditions: [
 {
 field: typeof node.field === "string" ? node.field : "ltp",
 operator: typeof node.operator === "string" ? node.operator : "always",
 value: typeof node.value === "string" || typeof node.value === "number" || typeof node.value === "boolean" ? node.value : null,
 compare_to: typeof node.compare_to === "string" ? node.compare_to : null,
 window_seconds: typeof node.window_seconds === "number" ? node.window_seconds : null
 }
 ],
 flattened: false
 };
}

function dslTokenAt(text: string, position: number): { token: string; start: number; end: number } {
 const before = text.slice(0, position);
 const match = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
 const start = match ? position - match[0].length : position;
 return { token: match?.[0] ?? "", start, end: position };
}

function textareaCaretDropdownPosition(textarea: HTMLTextAreaElement, caretPosition: number) {
 const styles = window.getComputedStyle(textarea);
 const mirror = document.createElement("div");
 const properties = [
 "box-sizing",
 "width",
 "font-family",
 "font-size",
 "font-weight",
 "font-style",
 "letter-spacing",
 "text-transform",
 "word-spacing",
 "line-height",
 "padding-top",
 "padding-right",
 "padding-bottom",
 "padding-left",
 "border-top-width",
 "border-right-width",
 "border-bottom-width",
 "border-left-width"
 ];
 for (const property of properties) {
 mirror.style.setProperty(property, styles.getPropertyValue(property));
 }
 mirror.style.position = "absolute";
 mirror.style.visibility = "hidden";
 mirror.style.pointerEvents = "none";
 mirror.style.whiteSpace = "pre-wrap";
 mirror.style.overflowWrap = "break-word";
 mirror.style.wordBreak = styles.wordBreak;
 mirror.style.top = "0";
 mirror.style.left = "-9999px";
 mirror.style.height = "auto";
 mirror.style.minHeight = "0";
 mirror.style.maxHeight = "none";
 mirror.style.overflow = "hidden";
 mirror.textContent = textarea.value.slice(0, caretPosition);
 const marker = document.createElement("span");
 marker.textContent = textarea.value.slice(caretPosition, caretPosition + 1) || "\u200b";
 mirror.appendChild(marker);
 document.body.appendChild(mirror);
 const lineHeight = Number.parseFloat(styles.lineHeight) || Number.parseFloat(styles.fontSize) * 1.4 || 20;
 const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
 const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
 const top = textarea.offsetTop + marker.offsetTop - textarea.scrollTop + lineHeight + borderTop + 4;
 const left = textarea.offsetLeft + marker.offsetLeft - textarea.scrollLeft + borderLeft;
 document.body.removeChild(mirror);
 return { top, left };
}

function stripOuterParens(value: string): string {
 const trimmed = value.trim();
 if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return trimmed;
 let depth = 0;
 for (let index = 0; index < trimmed.length; index += 1) {
 const char = trimmed[index];
 if (char === "(") depth += 1;
 if (char === ")") depth -= 1;
 if (depth === 0 && index < trimmed.length - 1) return trimmed;
 }
 return trimmed.slice(1, -1).trim();
}

function splitTopLevel(value: string): string[] {
 const parts: string[] = [];
 let current = "";
 let depth = 0;
 let quote: string | null = null;
 for (const char of value) {
 if (quote) {
 current += char;
 if (char === quote) quote = null;
 continue;
 }
 if (char === "'" || char === '"') {
 quote = char;
 current += char;
 continue;
 }
 if (char === "(") depth += 1;
 if (char === ")") depth -= 1;
 if (char === "," && depth === 0) {
 parts.push(current.trim());
 current = "";
 continue;
 }
 current += char;
 }
 if (current.trim()) parts.push(current.trim());
 return parts;
}

function parseDslLiteral(raw: string): string | number | boolean | null {
 const value = raw.trim();
 if (!value) return null;
 if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
 return value.slice(1, -1);
 }
 if (value === "true") return true;
 if (value === "false") return false;
 const asNumber = Number(value);
 if (Number.isFinite(asNumber)) return asNumber;
 return value;
}

function parseLocalDslExpression(text: string): Record<string, unknown> | null {
 const expression = stripOuterParens(text.trim());
 if (!expression) return null;
 const callMatch = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/);
 if (callMatch) {
 const [, name, rawArgs] = callMatch;
 const args = splitTopLevel(rawArgs);
 if (name === "all" || name === "any") {
 return { kind: name, children: args.map(parseLocalDslExpression).filter(Boolean) };
 }
 if (name === "not") {
 return { kind: "not", children: args.slice(0, 1).map(parseLocalDslExpression).filter(Boolean) };
 }
 const condition: Record<string, unknown> = { kind: "condition", operator: name, children: [] };
 for (const [index, arg] of args.entries()) {
 const equalsIndex = arg.indexOf("=");
 if (equalsIndex > 0) {
 const key = arg.slice(0, equalsIndex).trim();
 const value = parseDslLiteral(arg.slice(equalsIndex + 1));
 if (key === "value") condition.value = value;
 if (key === "compare_to") condition.compare_to = value;
 if (key === "field") condition.field = value;
 if (key === "window_seconds") condition.window_seconds = Number(value);
 continue;
 }
 if (index === 0) condition.field = arg.trim();
 }
 if (!condition.field && name !== "always") condition.field = "ltp";
 return condition;
 }
 const compareMatch = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|>|<)\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)$/);
 if (compareMatch) {
 const [, field, symbol, rawRight] = compareMatch;
 const operatorMap: Record<string, string> = { ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" };
 const parsedRight = parseDslLiteral(rawRight);
 const isFieldCompare = typeof parsedRight === "string" && fieldOptions.some((item) => item.value === parsedRight);
 return {
 kind: "condition",
 field,
 operator: isFieldCompare ? `field_${operatorMap[symbol]}` : operatorMap[symbol],
 value: isFieldCompare ? null : parsedRight,
 compare_to: isFieldCompare ? parsedRight : null,
 children: []
 };
 }
 return null;
}

function parseLlmPromptPlaceholders(prompt: string): Record<string, unknown>[] {
 const matches = prompt.matchAll(/@([A-Za-z][A-Za-z0-9_.]*)(?:\(([^)]*)\))?/g);
 return Array.from(matches).map((match) => ({
 raw: match[0],
 name: match[1],
 args: match[2] ?? ""
 }));
}

function compileLocalDslToAst(text: string, baseAst: Record<string, unknown>): Record<string, unknown> | null {
 const logic = parseLocalDslExpression(text);
 if (!logic) return null;
 return { ...baseAst, logic };
}

function numeric(value: unknown): number | null {
 if (value === null || value === undefined || value === "") return null;
 const next = Number(value);
 return Number.isFinite(next) ? next : null;
}

function csvList(value: string): string[] {
 return value
 .split(",")
 .map((item) => item.trim().toUpperCase())
 .filter(Boolean);
}

function listCsv(value: string[] | undefined): string {
 return (value ?? []).join(", ");
}

function timeToMinutes(value: string): number | null {
 const match = value.match(/^(\d{2}):(\d{2})$/);
 if (!match) return null;
 const hour = Number(match[1]);
 const minute = Number(match[2]);
 if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
 return hour * 60 + minute;
}

function timezoneParts(timezone: string): { day: string; minutes: number } | null {
 try {
 const parts = new Intl.DateTimeFormat("en-US", {
 timeZone: timezone || "Asia/Kolkata",
 weekday: "short",
 hour: "2-digit",
 minute: "2-digit",
 hourCycle: "h23"
 }).formatToParts(new Date());
 const weekday = parts.find((part) => part.type === "weekday")?.value.slice(0, 3).toLowerCase();
 const hour = Number(parts.find((part) => part.type === "hour")?.value);
 const minute = Number(parts.find((part) => part.type === "minute")?.value);
 if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
 return { day: weekday, minutes: hour * 60 + minute };
 } catch {
 return null;
 }
}

function isWithinSession(nowMinutes: number, start: number, end: number): boolean {
 if (start <= end) return nowMinutes >= start && nowMinutes <= end;
 return nowMinutes >= start || nowMinutes <= end;
}

function targetScopeSummary(targeting: AlertWorkflowTargeting): string {
 if (targeting.mode === "preset_universe") {
 return targeting.preset_label || targeting.preset_id || "Preset universe";
 }
 const entries = normalizeTargets(targeting.entries);
 if (!entries.length) {
 return "No targets";
 }
 if (entries.length === 1) {
 return targetDisplay(entries[0]);
 }
 const preview = entries
 .slice(0, 3)
 .map((entry) => entry.symbol)
 .join(", ");
 const remainder = entries.length - 3;
 return remainder > 0 ? `${entries.length} targets · ${preview} +${remainder} more` : `${entries.length} targets · ${preview}`;
}

function HelpText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
 return <div className={["text-[13px] leading-5 text-muted-foreground", className].filter(Boolean).join(" ")}>{children}</div>;
}

function FieldLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
 return <span className={["text-sm font-semibold leading-5 text-foreground", className].filter(Boolean).join(" ")}>{children}</span>;
}

function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
 return <h3 className={["text-base font-semibold leading-5 text-foreground", className].filter(Boolean).join(" ")}>{children}</h3>;
}

function StepHeader({
 step,
 title,
 description,
 action
}: {
 step: string;
 title: string;
 description: React.ReactNode;
 action?: React.ReactNode;
}) {
 return (
 <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
 <div className="max-w-[760px]">
 <div className="type-step-eyebrow">{step}</div>
 <h2 className="mt-1 text-xl font-semibold leading-6 text-foreground">{title}</h2>
 <HelpText className="mt-1.5">{description}</HelpText>
 </div>
 {action}
 </div>
 );
}

export function WorkflowEditor({
accounts,
announcementCategories = [],
initialWorkflow,
 llmProviders = [],
 presets = [],
 watchlists = []
}: {
 accounts: BrokerAccount[];
 announcementCategories?: string[];
 initialWorkflow?: AlertWorkflow | null;
 llmProviders?: LlmProviderConfig[];
 presets?: Array<Record<string, unknown>>;
 watchlists?: Watchlist[];
}) {
 const router = useRouter();
 const [isPending, startTransition] = useTransition();
 const [error, setError] = useState("");
 const [notice, setNotice] = useState("");
 const [matchPreview, setMatchPreview] = useState("");
 const [editorMode, setEditorMode] = useState<EditorMode>(initialWorkflow?.editor_mode ?? "rule");
 const initialWorkflowType = initialWorkflow?.workflow_dsl.workflow_type ?? "market_data";
 const [workflowType, setWorkflowType] = useState<"market_data" | "alpha_feed">(initialWorkflowType);
 const [name, setName] = useState(initialWorkflow?.name ?? "");
 const [description, setDescription] = useState(initialWorkflow?.description ?? "");
 const [accountId, setAccountId] = useState(initialWorkflow?.account_id ?? accounts[0]?.id ?? "");
 const [brokerCode, setBrokerCode] = useState(initialWorkflow?.broker_code ?? "");
 const [symbol, setSymbol] = useState(initialWorkflow?.symbol ?? "");
 const [exchange, setExchange] = useState(initialWorkflow?.exchange ?? "NSE");
 const [instrumentRef, setInstrumentRef] = useState<InstrumentRef>(initialWorkflow?.instrument_ref ?? {});
 const initialTargeting = initialWorkflow?.workflow_dsl.targeting ?? {
 mode: "single_symbol",
 entries: initialWorkflow?.symbol ? [buildTargetEntry(initialWorkflow.symbol, initialWorkflow.exchange ?? "NSE", initialWorkflow.instrument_ref)!].filter(Boolean) : [],
 preset_id: null,
 preset_label: null,
 filters: {}
 };
 const initialAst = initialWorkflow?.workflow_dsl.workflow_ast as JsonObject | null | undefined;
 const initialUniverse = (initialAst?.target_universe as JsonObject | undefined) ?? {};
 const initialTargetMode =
 initialUniverse.kind && initialUniverse.kind !== "static_symbols"
 ? "preset_universe"
 : initialTargeting.mode;
 const [targetMode, setTargetMode] = useState<AlertWorkflowTargeting["mode"]>(initialTargetMode as AlertWorkflowTargeting["mode"]);
 const initialDynamicUniverseKind =
 initialUniverse.kind === "curated_preset" || initialUniverse.kind === "metadata_filter"
 ? initialUniverse.kind
 : "watchlist";
 const [dynamicUniverseKind, setDynamicUniverseKind] = useState(initialDynamicUniverseKind);
 const [selectedWatchlistId, setSelectedWatchlistId] = useState(String(initialUniverse.watchlist_id ?? watchlists[0]?.id ?? ""));
 const [selectedPresetId, setSelectedPresetId] = useState(String(initialUniverse.preset_id ?? presets[0]?.id ?? "nse-equity"));
 const initialUniverseFilters = (initialUniverse.filters as JsonObject | undefined) ?? {};
 const [metadataExchange, setMetadataExchange] = useState(String(initialUniverseFilters.exchange ?? "NSE"));
 const [metadataInstrumentType, setMetadataInstrumentType] = useState(String(initialUniverseFilters.instrument_type ?? "EQ"));
 const [metadataSegmentContains, setMetadataSegmentContains] = useState(String(initialUniverseFilters.segment_contains ?? ""));
 const [targetEntries, setTargetEntries] = useState<AlertTargetEntry[]>(normalizeTargets(initialTargeting.entries));
 const [bulkTargets, setBulkTargets] = useState("");
 const initialEditableStatus = initialWorkflow?.status === "inactive" ? "inactive" : "active";
 const [status, setStatus] = useState<"active" | "inactive">(initialEditableStatus);
 const [combine, setCombine] = useState<"all" | "any">(initialWorkflow?.workflow_dsl.combine ?? "all");
 const [cooldownSeconds, setCooldownSeconds] = useState(String(initialWorkflow?.workflow_dsl.cooldown_seconds ?? 300));
 const initialActivePeriod = { ...defaultActivePeriod, ...(initialWorkflow?.workflow_dsl.active_period ?? {}) };
 const [activePeriodEnabled, setActivePeriodEnabled] = useState(initialActivePeriod.enabled);
 const [activeTimezone, setActiveTimezone] = useState(initialActivePeriod.timezone);
 const [activeDays, setActiveDays] = useState<string[]>(initialActivePeriod.days.length ? initialActivePeriod.days : defaultActivePeriod.days);
 const [activeSessionLabel, setActiveSessionLabel] = useState(initialActivePeriod.sessions[0]?.label ?? "Regular market");
 const [activeSessionStart, setActiveSessionStart] = useState(initialActivePeriod.sessions[0]?.start ?? "09:15");
const [activeSessionEnd, setActiveSessionEnd] = useState(initialActivePeriod.sessions[0]?.end ?? "15:30");
const [activeExchanges, setActiveExchanges] = useState(listCsv(initialActivePeriod.exchanges));
const [activeExchangeTypes, setActiveExchangeTypes] = useState(listCsv(initialActivePeriod.exchange_types));
const [activeSegments, setActiveSegments] = useState(listCsv(initialActivePeriod.segments));
const [activeInstrumentTypes, setActiveInstrumentTypes] = useState(listCsv(initialActivePeriod.instrument_types));
 const [showAdvancedMarketScope, setShowAdvancedMarketScope] = useState(
 Boolean(
 initialActivePeriod.exchanges.length ||
 initialActivePeriod.exchange_types.length ||
 initialActivePeriod.segments.length ||
 initialActivePeriod.instrument_types.length
 )
 );
 const [conditions, setConditions] = useState<AlertCondition[]>(
 initialWorkflow?.workflow_dsl.conditions.length
 ? initialWorkflow.workflow_dsl.conditions
 : [{ field: "ltp", operator: "crosses_above", value: 3000 }]
 );
 const [level, setLevel] = useState(initialWorkflow?.workflow_dsl.notification.level ?? "info");
 const [titleTemplate, setTitleTemplate] = useState(initialWorkflow?.workflow_dsl.notification.title_template ?? "{symbol} alert");
 const [messageTemplate, setMessageTemplate] = useState(initialWorkflow?.workflow_dsl.notification.message_template ?? "{symbol} matched workflow");
 const initialLlm = initialWorkflow?.workflow_dsl.llm_analysis;
 const enabledLlmProviders = llmProviders.filter((provider) => provider.has_api_key && provider.is_enabled);
 const firstLlmProvider = enabledLlmProviders[0];
 const firstLlmModel = firstLlmProvider?.models.find((model) => model.is_enabled);
 const [llmEnabled, setLlmEnabled] = useState(Boolean(initialLlm?.enabled));
 const [llmProvider, setLlmProvider] = useState<LlmProvider | "">(initialLlm?.provider ?? firstLlmProvider?.provider ?? "");
 const [llmModelId, setLlmModelId] = useState(initialLlm?.model_id ?? firstLlmModel?.model_id ?? "");
 const [llmPromptTemplate, setLlmPromptTemplate] = useState(initialLlm?.prompt_template || fallbackLlmPrompt);
 const [llmTemperature, setLlmTemperature] = useState(String(initialLlm?.temperature ?? 0.2));
 const [llmMaxTokens, setLlmMaxTokens] = useState(String(initialLlm?.max_completion_tokens ?? 500));
 const [llmTimeout, setLlmTimeout] = useState(String(initialLlm?.timeout_seconds ?? 25));
 const initialFeedTrigger = initialWorkflow?.workflow_dsl.feed_trigger;
 const [feedProducts, setFeedProducts] = useState<string[]>(initialFeedTrigger?.products ?? ["news"]);
 const [feedAnnouncementCategories, setFeedAnnouncementCategories] = useState<string[]>(initialFeedTrigger?.announcement_categories ?? []);
 const [feedCategoryFilterEnabled, setFeedCategoryFilterEnabled] = useState(Boolean(initialFeedTrigger?.announcement_categories?.length));
 const [feedIncludeRelatedCategories, setFeedIncludeRelatedCategories] = useState(initialFeedTrigger?.include_related_categories ?? true);
 const [feedCategoryQuery, setFeedCategoryQuery] = useState("");
 const [feedConditionPrompt, setFeedConditionPrompt] = useState(initialFeedTrigger?.condition_prompt ?? "");
 const [feedSourceScope, setFeedSourceScope] = useState(initialFeedTrigger?.source_scope ?? "current_alpha_subscription");
 const [feedWatchlistIds, setFeedWatchlistIds] = useState<string[]>(initialFeedTrigger?.watchlist_ids ?? []);
 const [feedPresetIds, setFeedPresetIds] = useState<string[]>(initialFeedTrigger?.preset_ids ?? []);
 const [feedIncludeAllWatchlists, setFeedIncludeAllWatchlists] = useState(Boolean(initialFeedTrigger?.include_all_watchlists));
 const [feedTriggerLlmEnabled, setFeedTriggerLlmEnabled] = useState(Boolean(initialFeedTrigger?.condition_prompt || initialFeedTrigger?.provider || initialFeedTrigger?.model_id));
 const [feedProvider, setFeedProvider] = useState<LlmProvider | "">(initialFeedTrigger?.provider ?? "");
 const [feedModelId, setFeedModelId] = useState(initialFeedTrigger?.model_id ?? "");
const [feedTemperature, setFeedTemperature] = useState(String(initialFeedTrigger?.temperature ?? 0.1));
const [feedMaxTokens, setFeedMaxTokens] = useState(String(initialFeedTrigger?.max_completion_tokens ?? 400));
const [feedTimeout, setFeedTimeout] = useState(String(initialFeedTrigger?.timeout_seconds ?? 25));
const [llmPromptTab, setLlmPromptTab] = useState<"prompt" | "preview">("prompt");
const [llmFeedback, setLlmFeedback] = useState("");
const [llmDetails, setLlmDetails] = useState<Record<string, unknown> | null>(null);
 const [llmSuggestionQuery, setLlmSuggestionQuery] = useState("");
 const [llmSuggestionRange, setLlmSuggestionRange] = useState<{ start: number; end: number } | null>(null);
 const [llmSuggestionPosition, setLlmSuggestionPosition] = useState<{ top: number; left: number; width: number } | null>(null);
 const [llmSuggestionIndex, setLlmSuggestionIndex] = useState(0);
 const [showLlmSuggestions, setShowLlmSuggestions] = useState(false);
 const [llmPlaceholderExamples, setLlmPlaceholderExamples] = useState([
 "@price.full",
 "@trigger.reason",
 "@trigger.summary",
 "@trigger.details",
 "@news(days=2, max_pages=1, max_items=5)",
 "@announcements(days=2, max_pages=1, max_items=5, detailed=true)",
 "@earnings(days=2, max_pages=1, max_items=3, detailed=true)",
 "@concalls(days=2, max_pages=1, max_items=2)"
 ]);
 const [dslText, setDslText] = useState(initialWorkflow?.workflow_dsl.dsl_text ?? "");
 const [engineFeedback, setEngineFeedback] = useState("");
 const [engineDetails, setEngineDetails] = useState<Record<string, unknown> | null>(null);
 const [universePreview, setUniversePreview] = useState<AlertUniversePreview | null>(null);
 const [universePreviewLoading, setUniversePreviewLoading] = useState(false);
 const [hoveredSymbolKey, setHoveredSymbolKey] = useState("");
 const [hoverQuote, setHoverQuote] = useState<QuoteResponse | null>(null);
 const [hoverQuoteLoading, setHoverQuoteLoading] = useState(false);
 const [conditionRegistry, setConditionRegistry] = useState<AlertConditionRegistry | null>(null);
 const [dslSuggestionQuery, setDslSuggestionQuery] = useState("");
 const [dslSuggestionRange, setDslSuggestionRange] = useState<{ start: number; end: number } | null>(null);
 const [showDslSuggestions, setShowDslSuggestions] = useState(false);
 const [inheritDefaults, setInheritDefaults] = useState(initialWorkflow?.channel_override?.inherit_defaults ?? true);
 const [channelInApp, setChannelInApp] = useState(initialWorkflow?.workflow_dsl.channels.enabled.includes("in_app") ?? true);
 const [channelDiscord, setChannelDiscord] = useState(initialWorkflow?.workflow_dsl.channels.enabled.includes("discord") ?? false);
 const [channelTelegram, setChannelTelegram] = useState(initialWorkflow?.workflow_dsl.channels.enabled.includes("telegram") ?? false);
 const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
 const [suggestionMetadata, setSuggestionMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
 const [searchLoading, setSearchLoading] = useState(false);
 const [selectedSearchLabel, setSelectedSearchLabel] = useState("");
 const [preview, setPreview] = useState<PreviewState>({ quote: null, ohlc: null, loading: false, error: "" });
 const [previewMode, setPreviewMode] = useState<"summary" | "raw">("summary");
 const [showSuggestions, setShowSuggestions] = useState(false);
 const [messageFieldQuery, setMessageFieldQuery] = useState("");
 const [messageFieldPosition, setMessageFieldPosition] = useState<{ top: number; left: number; width: number } | null>(null);
 const [messageFieldIndex, setMessageFieldIndex] = useState(0);
 const [showMessageFieldSuggestions, setShowMessageFieldSuggestions] = useState(false);
 const symbolWrapRef = useRef<HTMLDivElement | null>(null);
 const messageTemplateWrapRef = useRef<HTMLDivElement | null>(null);
 const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
 const messageFieldListRef = useRef<HTMLDivElement | null>(null);
 const llmPromptWrapRef = useRef<HTMLDivElement | null>(null);
 const llmPromptInputRef = useRef<HTMLTextAreaElement | null>(null);
 const llmSuggestionListRef = useRef<HTMLDivElement | null>(null);
 const suppressLlmAutocompleteRef = useRef(false);
 const suppressMessageAutocompleteRef = useRef(false);

const selectedAccount = accounts.find((item) => item.id === accountId);
const selectedWatchlist = watchlists.find((item) => item.id === selectedWatchlistId) ?? null;
const selectedPreset = presets.find((item) => String(item.id ?? "") === selectedPresetId) ?? null;
const isTemplateDraft = Boolean(initialWorkflow?.template_id && !initialWorkflow?.id);
 const advancedMarketScopeCount = [
 activeExchanges,
 activeExchangeTypes,
 activeSegments,
 activeInstrumentTypes
 ].filter((value) => value.trim()).length;
const activeInstrument = useMemo<InstrumentRef>(
 () => ({
 ...instrumentRef,
 symbol: symbol || instrumentRef.symbol || null,
 exchange: exchange || instrumentRef.exchange || null
 }),
 [exchange, instrumentRef, symbol]
 );
 const suggestedDsl = useMemo(() => conditionsToDsl(combine, conditions), [combine, conditions]);
 const suggestedCopy = useMemo(() => suggestedTemplates(conditions, combine), [combine, conditions]);
 const livePreviewAllowed = useMemo(() => {
 if (workflowType !== "market_data" || !activePeriodEnabled) return true;
 const current = timezoneParts(activeTimezone);
 if (!current) return true;
 if (!activeDays.includes(current.day)) return false;
 const start = timeToMinutes(activeSessionStart);
 const end = timeToMinutes(activeSessionEnd);
 if (start === null || end === null) return true;
 return isWithinSession(current.minutes, start, end);
 }, [activeDays, activePeriodEnabled, activeSessionEnd, activeSessionStart, activeTimezone, workflowType]);
 const dslSuggestions = useMemo<DslSuggestion[]>(() => {
 const registrySuggestions: DslSuggestion[] = [
 ...(conditionRegistry?.fields ?? []).map((item) => ({
 value: item.name,
 label: item.name,
 description: item.description,
 kind: "field" as const
 })),
 ...(conditionRegistry?.operators ?? []).map((item) => ({
 value: `${item.operator}(`,
 label: `${item.operator}()`,
 description: item.description,
 kind: "operator" as const
 })),
 ...(conditionRegistry?.functions ?? []).map((item) => ({
 value: `${item.name}(`,
 label: `${item.name}()`,
 description: item.description,
 kind: "function" as const
 }))
 ];
 const placeholderSuggestions = messageTemplateFields.map((item) => ({
 value: item,
 label: `{${item}}`,
 description: "Notification placeholder available from live tick, enrichment, or runtime context.",
 kind: "placeholder" as const
 }));
 const query = dslSuggestionQuery.toLowerCase();
 return [...registrySuggestions, ...placeholderSuggestions]
 .filter((item) => !query || item.label.toLowerCase().includes(query) || item.value.toLowerCase().includes(query))
 .slice(0, 12);
 }, [conditionRegistry, dslSuggestionQuery]);
 const availableAnnouncementCategories = useMemo(() => {
 const seen = new Set<string>();
 return [...announcementCategories, ...feedAnnouncementCategories]
 .map((item) => item.trim())
 .filter(Boolean)
 .sort((left, right) => left.localeCompare(right))
 .filter((item) => {
 const key = item.toLowerCase();
 if (seen.has(key)) return false;
 seen.add(key);
 return true;
 });
 }, [announcementCategories, feedAnnouncementCategories]);
 const filteredAnnouncementCategories = useMemo(() => {
 const query = feedCategoryQuery.trim().toLowerCase();
 if (!query) return availableAnnouncementCategories;
 return availableAnnouncementCategories.filter((item) => item.toLowerCase().includes(query));
 }, [availableAnnouncementCategories, feedCategoryQuery]);
 const announcementsEnabled = feedProducts.includes("announcements");
 const dynamicTargetUniverse = useMemo(() => {
 if (dynamicUniverseKind === "curated_preset") {
 return {
 kind: "curated_preset",
 preset_id: selectedPresetId,
 label: String(selectedPreset?.label ?? selectedPresetId)
 };
 }
 if (dynamicUniverseKind === "metadata_filter") {
 return {
 kind: "metadata_filter",
 label: "Metadata filter",
 filters: {
 exchange: metadataExchange.trim().toUpperCase() || undefined,
 instrument_type: metadataInstrumentType.trim().toUpperCase() || undefined,
 segment_contains: metadataSegmentContains.trim() || undefined
 }
 };
 }
 return {
 kind: "watchlist",
 watchlist_id: selectedWatchlistId,
 label: selectedWatchlist?.name ?? selectedWatchlistId
 };
 }, [dynamicUniverseKind, metadataExchange, metadataInstrumentType, metadataSegmentContains, selectedPreset?.label, selectedPresetId, selectedWatchlist?.name, selectedWatchlistId]);
 const dynamicTargetUniverseKey = JSON.stringify(dynamicTargetUniverse);
 const universeSymbols = useMemo<UniverseSymbolPreview[]>(() => {
 if (targetMode === "symbol_list") {
 return targetEntries.map((entry) => ({
 symbol: entry.symbol,
 exchange: entry.exchange,
 instrument_ref: entry.instrument_ref,
 source_type: "symbol_list"
 }));
 }
 if (targetMode === "single_symbol" && symbol.trim()) {
 return [{ symbol: symbol.trim().toUpperCase(), exchange, instrument_ref: activeInstrument, source_type: "single_symbol" }];
 }
 if (targetMode !== "preset_universe") return [];
 if (dynamicUniverseKind === "watchlist") {
 return (selectedWatchlist?.items ?? []).map((item) => ({
 symbol: item.symbol,
 exchange: item.exchange,
 instrument_ref: item.instrument_ref,
 source_label: selectedWatchlist?.name,
 source_type: "watchlist"
 }));
 }
 return (universePreview?.sample ?? []).map((item) => ({
 symbol: String(item.symbol ?? ""),
 exchange: typeof item.exchange === "string" ? item.exchange : null,
 source_label: typeof item.source_label === "string" ? item.source_label : null,
 source_type: typeof item.source_type === "string" ? item.source_type : dynamicUniverseKind
 })).filter((item) => item.symbol);
 }, [activeInstrument, dynamicUniverseKind, exchange, selectedWatchlist, symbol, targetEntries, targetMode, universePreview?.sample]);

 useEffect(() => {
 if (selectedAccount?.broker_code) {
 setBrokerCode(selectedAccount.broker_code);
 }
 }, [selectedAccount?.broker_code]);

 useEffect(() => {
 let cancelled = false;
 startTransition(async () => {
 try {
 const registry = await getAlertConditionRegistry();
 if (!cancelled) setConditionRegistry(registry);
 } catch {
 if (!cancelled) setConditionRegistry(null);
 }
 });
 return () => {
 cancelled = true;
 };
 }, [startTransition]);

 useEffect(() => {
 let cancelled = false;
 startTransition(async () => {
 try {
 const catalog = await getAlertLlmPlaceholders();
 if (!cancelled) {
 setLlmPlaceholderExamples(catalog.placeholders.map((item) => item.example));
 if (!initialLlm?.prompt_template && catalog.defaults.prompt_template) {
 setLlmPromptTemplate(catalog.defaults.prompt_template);
 }
 }
 } catch {
 if (!cancelled) setLlmPlaceholderExamples((current) => current);
 }
 });
 return () => {
 cancelled = true;
 };
 }, [initialLlm?.prompt_template, startTransition]);

 useEffect(() => {
 const provider = llmProviders.find((item) => item.provider === llmProvider);
 if (!provider) return;
 if (provider.models.some((model) => model.model_id === llmModelId && model.is_enabled)) return;
 const nextModel = provider.models.find((model) => model.is_enabled);
 setLlmModelId(nextModel?.model_id ?? "");
 }, [llmModelId, llmProvider, llmProviders]);

 useEffect(() => {
 const provider = llmProviders.find((item) => item.provider === feedProvider);
 if (!provider) return;
 if (provider.models.some((model) => model.model_id === feedModelId && model.is_enabled)) return;
 const nextModel = provider.models.find((model) => model.is_enabled);
 setFeedModelId(nextModel?.model_id ?? "");
 }, [feedModelId, feedProvider, llmProviders]);

 useEffect(() => {
 if (targetMode !== "preset_universe" || dynamicUniverseKind === "watchlist") {
 setUniversePreview(null);
 setUniversePreviewLoading(false);
 return;
 }
 let cancelled = false;
 setUniversePreviewLoading(true);
 startTransition(async () => {
 try {
 const result = await previewAlertUniverse(dynamicTargetUniverse, 5000);
 if (!cancelled) setUniversePreview(result);
 } catch {
 if (!cancelled) setUniversePreview({ count: 0, sample: [] });
 } finally {
 if (!cancelled) setUniversePreviewLoading(false);
 }
 });
 return () => {
 cancelled = true;
 };
 }, [dynamicTargetUniverseKey, dynamicUniverseKind, startTransition, targetMode]);

 useEffect(() => {
 function handlePointerDown(event: MouseEvent) {
 if (symbolWrapRef.current && !symbolWrapRef.current.contains(event.target as Node)) {
 setShowSuggestions(false);
 }
 }
 document.addEventListener("mousedown", handlePointerDown);
 return () => document.removeEventListener("mousedown", handlePointerDown);
 }, []);

 useEffect(() => {
 if (symbol.trim().length < 1) {
 setSuggestions([]);
 setSuggestionMetadata({});
 return;
 }
 let cancelled = false;
 const handle = window.setTimeout(() => {
 setSearchLoading(true);
 startTransition(async () => {
 try {
 const result = await searchDefaultBrokerInstruments({
 q: symbol.trim(),
 exchange: exchange.trim() || undefined,
 limit: 20
 });
 if (cancelled) return;
 setSuggestions(result);
 setShowSuggestions(true);
 const symbols = Array.from(new Set(result.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))).slice(0, 20);
 if (!symbols.length) {
 setSuggestionMetadata({});
 return;
 }
 try {
 const metadata = await getAlphaSymbolMetadata(symbols);
 if (cancelled) return;
 setSuggestionMetadata(
 metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
 acc[item.symbol.trim().toUpperCase()] = item;
 return acc;
 }, {})
 );
 } catch {
 if (!cancelled) setSuggestionMetadata({});
 }
 } catch {
 if (cancelled) return;
 setSuggestions([]);
 setSuggestionMetadata({});
 } finally {
 if (!cancelled) setSearchLoading(false);
 }
 });
 }, 250);
 return () => {
 cancelled = true;
 window.clearTimeout(handle);
 };
 }, [exchange, startTransition, symbol]);

 useEffect(() => {
 const account = selectedAccount;
 if (!account || !activeInstrument.symbol) {
 setPreview({ quote: null, ohlc: null, loading: false, error: "" });
 return;
 }
 if (!livePreviewAllowed) {
 setPreview({
 quote: null,
 ohlc: null,
 loading: false,
 error: "Live broker preview is paused outside this workflow's active market period."
 });
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
 }, [activeInstrument, livePreviewAllowed, selectedAccount]);

 function selectSuggestion(row: InstrumentSearchRow) {
 setSymbol(row.symbol);
 setExchange(row.exchange ?? exchange);
 setInstrumentRef(instrumentFromSearch(row));
 setSelectedSearchLabel([row.symbol, row.exchange, row.instrument_type].filter(Boolean).join(" · "));
 setSuggestions([]);
 setShowSuggestions(false);
 }

 function clearScriptIfVisualLogicChanged(nextCombine: "all" | "any", nextConditions: AlertCondition[]) {
 const nextDsl = conditionsToDsl(nextCombine, nextConditions);
 if (dslText.trim() && dslText.trim() !== nextDsl) {
 setDslText("");
 setEngineFeedback("Advanced script cleared because the visual conditions were edited. The saved workflow will now use the visible rule builder.");
 }
 }

 function updateCombine(nextCombine: "all" | "any") {
 clearScriptIfVisualLogicChanged(nextCombine, conditions);
 setCombine(nextCombine);
 }

 function updateCondition(index: number, patch: Partial<AlertCondition>) {
 const nextConditions = conditions.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
 clearScriptIfVisualLogicChanged(combine, nextConditions);
 setConditions(nextConditions);
 }

 function addCondition() {
 const nextConditions = [...conditions, { field: "ltp", operator: "gte", value: 0 }];
 clearScriptIfVisualLogicChanged(combine, nextConditions);
 setConditions(nextConditions);
 }

 function removeCondition(index: number) {
 const nextConditions = conditions.filter((_, itemIndex) => itemIndex !== index);
 clearScriptIfVisualLogicChanged(combine, nextConditions);
 setConditions(nextConditions);
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

 function toggleActiveDay(day: string, checked: boolean) {
 setActiveDays((current) => checked ? Array.from(new Set([...current, day])) : current.filter((item) => item !== day));
 }

 function workflowTargetingPayload(): AlertWorkflowTargeting {
 const currentTarget = buildTargetEntry(symbol, exchange, activeInstrument);
 if (targetMode === "single_symbol") {
 return {
 mode: "single_symbol",
 entries: currentTarget ? [currentTarget] : [],
 preset_id: null,
 preset_label: null,
 filters: {}
 };
 }
 if (targetMode === "symbol_list") {
 return {
 mode: "symbol_list",
 entries: normalizeTargets(targetEntries),
 preset_id: null,
 preset_label: null,
 filters: {}
 };
 }
 return {
 mode: "preset_universe",
 entries: normalizeTargets(targetEntries),
 preset_id: null,
 preset_label: null,
 filters: {}
 };
 }

 function workflowAstPayload(targeting: AlertWorkflowTargeting, astConditions = conditions) {
 const staticUniverse = {
 kind: "static_symbols",
 symbols: targeting.entries.map((entry) => ({
 symbol: entry.symbol,
 exchange: entry.exchange ?? null,
 instrument_ref: serializeInstrumentRef(entry.instrument_ref),
 label: entry.label ?? null,
 metadata: entry.metadata ?? {}
 }))
 };
 if (targetMode !== "preset_universe") {
 return {
 version: 2,
 target_universe: staticUniverse,
 logic: {
 kind: combine,
 children: astConditions.map((condition) => ({ kind: "condition", ...condition }))
 },
 cooldown_seconds: Number(cooldownSeconds || 0),
 notification: {
 level,
 title_template: titleTemplate,
 message_template: messageTemplate
 },
 channels: channelSelection()
 };
 }
 return {
 version: 2,
 target_universe: dynamicTargetUniverse,
 logic: {
 kind: combine,
 children: astConditions.map((condition) => ({ kind: "condition", ...condition }))
 },
 cooldown_seconds: Number(cooldownSeconds || 0),
 notification: {
 level,
 title_template: titleTemplate,
 message_template: messageTemplate
 },
 channels: channelSelection()
 };
 }

 function workflowPayload() {
 const targeting = workflowTargetingPayload();
 const primaryTarget = targeting.entries[0];
 const effectiveConditions = workflowType === "alpha_feed" ? [{ operator: "always", field: "event" }] : conditions;
 const workflowDsl: AlertWorkflowDsl = {
 version: 2,
 workflow_type: workflowType,
 combine,
 cooldown_seconds: Number(cooldownSeconds || 0),
 conditions: effectiveConditions,
 targeting,
 notification: {
 level,
 title_template: titleTemplate,
 message_template: messageTemplate
 },
 channels: channelSelection(),
 llm_analysis: {
 enabled: llmEnabled,
 provider: llmProvider || null,
 model_id: llmModelId || null,
 prompt_template: llmPromptTemplate,
 context_placeholders: parseLlmPromptPlaceholders(llmPromptTemplate),
 temperature: Number(llmTemperature || 0.2),
 max_completion_tokens: Number(llmMaxTokens || 500),
 timeout_seconds: Number(llmTimeout || 25)
 },
 feed_trigger: {
 enabled: workflowType === "alpha_feed",
 products: feedProducts as AlertWorkflowDsl["feed_trigger"]["products"],
 announcement_categories: announcementsEnabled && feedCategoryFilterEnabled ? feedAnnouncementCategories : [],
 include_related_categories: feedIncludeRelatedCategories,
 condition_prompt: feedTriggerLlmEnabled ? feedConditionPrompt : "",
 source_scope: feedSourceScope as AlertWorkflowDsl["feed_trigger"]["source_scope"],
 watchlist_ids: feedWatchlistIds,
 preset_ids: feedPresetIds,
 include_all_watchlists: feedIncludeAllWatchlists,
 provider: feedTriggerLlmEnabled ? feedProvider || null : null,
 model_id: feedTriggerLlmEnabled ? feedModelId || null : null,
 temperature: Number(feedTemperature || 0.1),
 max_completion_tokens: Number(feedMaxTokens || 400),
 timeout_seconds: Number(feedTimeout || 25)
 },
 active_period: {
 enabled: activePeriodEnabled,
 timezone: activeTimezone.trim() || "Asia/Kolkata",
 days: activeDays.length ? activeDays : defaultActivePeriod.days,
 sessions: [
 {
 label: activeSessionLabel.trim() || "Regular market",
 start: activeSessionStart || "09:15",
 end: activeSessionEnd || "15:30"
 }
 ],
 exchanges: csvList(activeExchanges),
 exchange_types: csvList(activeExchangeTypes),
 segments: csvList(activeSegments),
 instrument_types: csvList(activeInstrumentTypes)
 },
 dsl_text: dslText.trim() || null,
 workflow_ast: workflowAstPayload(targeting, effectiveConditions),
 validation_status: "unknown",
 compiled_summary: {}
 };

 return {
 template_id: initialWorkflow?.template_id ?? null,
 name,
 description,
 account_id: accountId || null,
 broker_code: selectedAccount?.broker_code ?? (brokerCode || null),
 symbol: primaryTarget?.symbol ?? (symbol || null),
 exchange: primaryTarget?.exchange ?? (exchange || null),
 instrument_ref: serializeInstrumentRef(primaryTarget?.instrument_ref ?? activeInstrument),
 workflow_dsl: workflowDsl,
 graph_dsl: buildGraph(workflowDsl),
 editor_mode: editorMode,
 channel_override: channelSelection(),
 status
 };
 }

 function updateMessageTemplate(nextValue: string, caretPosition?: number, force = false, textarea?: HTMLTextAreaElement) {
 if (suppressMessageAutocompleteRef.current) {
 suppressMessageAutocompleteRef.current = false;
 return;
 }
 setMessageTemplate(nextValue);
 const scanUntil = typeof caretPosition === "number" ? caretPosition : nextValue.length;
 const beforeCursor = nextValue.slice(0, scanUntil);
 const openIndex = beforeCursor.lastIndexOf("{");
 const closeIndex = beforeCursor.lastIndexOf("}");
 const input = textarea ?? messageInputRef.current;
 if (input && (force || openIndex >= 0 && openIndex > closeIndex)) {
 const position = textareaCaretDropdownPosition(input, scanUntil);
 const wrapWidth = messageTemplateWrapRef.current?.clientWidth ?? input.clientWidth;
 const width = Math.min(520, Math.max(260, wrapWidth - 16));
 const maxLeft = Math.max(8, wrapWidth - width - 8);
 setMessageFieldPosition({
 top: Math.max(8, position.top),
 left: Math.min(Math.max(8, position.left), maxLeft),
 width
 });
 }
 if (openIndex >= 0 && openIndex > closeIndex) {
 const query = beforeCursor.slice(openIndex + 1).trim().toLowerCase();
 if (query !== messageFieldQuery) {
 setMessageFieldIndex(0);
 }
 setMessageFieldQuery(query);
 setShowMessageFieldSuggestions(true);
 return;
 }
 setShowMessageFieldSuggestions(force);
 setMessageFieldQuery("");
 setMessageFieldIndex(0);
 if (!force) setMessageFieldPosition(null);
 }

 function applyMessageField(field: string) {
 const input = messageInputRef.current;
 const current = messageTemplate;
 const caret = input?.selectionStart ?? current.length;
 const beforeCursor = current.slice(0, caret);
 const afterCursor = current.slice(caret);
 const openIndex = beforeCursor.lastIndexOf("{");
 const closeIndex = beforeCursor.lastIndexOf("}");
 if (openIndex >= 0 && openIndex > closeIndex) {
 const nextValue = `${beforeCursor.slice(0, openIndex)}{${field}}${afterCursor}`;
 const nextCaret = openIndex + field.length + 2;
 setMessageTemplate(nextValue);
 setShowMessageFieldSuggestions(false);
 setMessageFieldQuery("");
 setMessageFieldIndex(0);
 setMessageFieldPosition(null);
 suppressMessageAutocompleteRef.current = true;
 requestAnimationFrame(() => {
 input?.focus();
 input?.setSelectionRange(nextCaret, nextCaret);
 });
 return;
 }
 const nextValue = `${current.slice(0, caret)}{${field}}${afterCursor}`;
 const nextCaret = caret + field.length + 2;
 setMessageTemplate(nextValue);
 setShowMessageFieldSuggestions(false);
 setMessageFieldQuery("");
 setMessageFieldIndex(0);
 setMessageFieldPosition(null);
 suppressMessageAutocompleteRef.current = true;
 requestAnimationFrame(() => {
 input?.focus();
 input?.setSelectionRange(nextCaret, nextCaret);
 });
 }

 const filteredMessageFields = messageTemplateFields.filter((item) => item.includes(messageFieldQuery));

 useEffect(() => {
 setMessageFieldIndex((current) => Math.min(current, Math.max(filteredMessageFields.length - 1, 0)));
 }, [filteredMessageFields.length]);

 useEffect(() => {
 if (!showMessageFieldSuggestions) return;
 const active = messageFieldListRef.current?.querySelector<HTMLElement>("[data-active='true']");
 active?.scrollIntoView({ block: "nearest" });
 }, [messageFieldIndex, showMessageFieldSuggestions]);

 function handleMessageTemplateKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
 if (showMessageFieldSuggestions && filteredMessageFields.length) {
 if (event.key === "ArrowDown") {
 event.preventDefault();
 setMessageFieldIndex((current) => (current + 1) % filteredMessageFields.length);
 return;
 }
 if (event.key === "ArrowUp") {
 event.preventDefault();
 setMessageFieldIndex((current) => (current - 1 + filteredMessageFields.length) % filteredMessageFields.length);
 return;
 }
 if (event.key === "Enter" || event.key === "Tab") {
 event.preventDefault();
 applyMessageField(filteredMessageFields[messageFieldIndex] ?? filteredMessageFields[0]);
 return;
 }
 if (event.key === "Escape") {
 event.preventDefault();
 setShowMessageFieldSuggestions(false);
 setMessageFieldPosition(null);
 return;
 }
 }
 if ((event.ctrlKey || event.metaKey) && event.key === " ") {
 event.preventDefault();
 updateMessageTemplate(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, true, event.currentTarget);
 }
 }

 function updateLlmPromptAutocomplete(nextValue: string, caretPosition: number, force = false, textarea?: HTMLTextAreaElement) {
 if (suppressLlmAutocompleteRef.current) {
 suppressLlmAutocompleteRef.current = false;
 return;
 }
 const before = nextValue.slice(0, caretPosition);
 const match = before.match(/@[A-Za-z0-9_.]*(?:\([^)]*)?$/);
 const promptInput = textarea ?? llmPromptInputRef.current;
 if (promptInput && (force || match)) {
 const position = textareaCaretDropdownPosition(promptInput, caretPosition);
 const wrapWidth = llmPromptWrapRef.current?.clientWidth ?? promptInput.clientWidth;
 const width = Math.min(520, Math.max(260, wrapWidth - 16));
 const maxLeft = Math.max(8, wrapWidth - width - 8);
 setLlmSuggestionPosition({
 top: Math.max(8, position.top),
 left: Math.min(Math.max(8, position.left), maxLeft),
 width
 });
 }
 if (!match) {
 setShowLlmSuggestions(force);
 setLlmSuggestionQuery("");
 setLlmSuggestionRange({ start: caretPosition, end: caretPosition });
 setLlmSuggestionIndex(0);
 if (!force) setLlmSuggestionPosition(null);
 return;
 }
 const start = caretPosition - match[0].length;
 const nextQuery = match[0].toLowerCase();
 const exactPlaceholderMatch = llmPlaceholderExamples.some((item) => item.toLowerCase() === nextQuery);
 if (exactPlaceholderMatch && !force) {
 setShowLlmSuggestions(false);
 setLlmSuggestionQuery("");
 setLlmSuggestionRange(null);
 setLlmSuggestionPosition(null);
 setLlmSuggestionIndex(0);
 return;
 }
 if (nextQuery !== llmSuggestionQuery) {
 setLlmSuggestionIndex(0);
 }
 setLlmSuggestionQuery(nextQuery);
 setLlmSuggestionRange({ start, end: caretPosition });
 setShowLlmSuggestions(force || match[0].length > 0);
 }

 function applyLlmSuggestion(example: string) {
 const range = llmSuggestionRange ?? { start: llmPromptTemplate.length, end: llmPromptTemplate.length };
 const nextValue = `${llmPromptTemplate.slice(0, range.start)}${example}${llmPromptTemplate.slice(range.end)}`;
 const nextCaret = range.start + example.length;
 setLlmPromptTemplate(nextValue);
 setShowLlmSuggestions(false);
 setLlmSuggestionQuery("");
 setLlmSuggestionRange(null);
 setLlmSuggestionPosition(null);
 setLlmSuggestionIndex(0);
 suppressLlmAutocompleteRef.current = true;
 requestAnimationFrame(() => {
 llmPromptInputRef.current?.focus();
 llmPromptInputRef.current?.setSelectionRange(nextCaret, nextCaret);
 });
 }

 const filteredLlmPlaceholders = llmPlaceholderExamples
 .filter((item) => !llmSuggestionQuery || item.toLowerCase().includes(llmSuggestionQuery.replace(/^@/, "")))
 .slice(0, 10);

 useEffect(() => {
 setLlmSuggestionIndex((current) => Math.min(current, Math.max(filteredLlmPlaceholders.length - 1, 0)));
 }, [filteredLlmPlaceholders.length]);

 useEffect(() => {
 if (!showLlmSuggestions) return;
 const active = llmSuggestionListRef.current?.querySelector<HTMLElement>("[data-active='true']");
 active?.scrollIntoView({ block: "nearest" });
 }, [llmSuggestionIndex, showLlmSuggestions]);

 function updateDslAutocomplete(nextValue: string, caretPosition: number, force = false) {
 const token = dslTokenAt(nextValue, caretPosition);
 setDslSuggestionQuery(token.token);
 setDslSuggestionRange({ start: token.start, end: token.end });
 setShowDslSuggestions(force || token.token.length > 0);
 }

 function applyDslSuggestion(item: DslSuggestion) {
 const range = dslSuggestionRange ?? { start: dslText.length, end: dslText.length };
 const nextValue = `${dslText.slice(0, range.start)}${item.value}${dslText.slice(range.end)}`;
 setDslText(nextValue);
 setShowDslSuggestions(false);
 setDslSuggestionQuery("");
 }

 function syncVisualBuilderFromAst(workflowAst: unknown, options: { silent?: boolean } = {}) {
 if (!isRecord(workflowAst)) return false;
 const parsed = logicNodeToConditions(workflowAst.logic);
 if (!parsed || !parsed.conditions.length) return false;
 const nextConditionsJson = JSON.stringify(parsed.conditions);
 const currentConditionsJson = JSON.stringify(conditions);
 if (nextConditionsJson === currentConditionsJson && parsed.combine === combine) return true;
 setCombine(parsed.combine);
 setConditions(parsed.conditions);
 if (options.silent) return true;
 if (parsed.flattened) {
 setEngineFeedback("Script compiled. The visual builder was updated with supported conditions; nested or inverted groups remain represented by the script.");
 } else {
 setEngineFeedback("Script compiled and the visual rule builder was updated.");
 }
 return true;
 }

 useEffect(() => {
 if (!dslText.trim()) return;
 const targeting = workflowTargetingPayload();
 const localAst = compileLocalDslToAst(dslText, workflowAstPayload(targeting) as unknown as Record<string, unknown>);
 if (!localAst) return;
 syncVisualBuilderFromAst(localAst, { silent: true });
 }, [dslText]);

 function save() {
 setError("");
 setNotice("");
 const saveBlockReason = getSaveBlockReason();
 if (saveBlockReason) {
 setError(saveBlockReason);
 return;
 }
 startTransition(async () => {
 try {
 const payload = workflowPayload();
 const workflow = initialWorkflow?.id
 ? await updateAlertWorkflow(initialWorkflow.id, payload)
 : await createAlertWorkflow(payload);
 setNotice(initialWorkflow?.id ? "Workflow saved." : "Workflow created.");
 if (initialWorkflow?.id) {
 router.refresh();
 } else {
 router.push(`/alerts-workspace/workflows/${workflow.id}`);
 router.refresh();
 }
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not save workflow.");
 }
 });
 }

 function getSaveBlockReason() {
 if (!name.trim()) {
 return "Enter a workflow name before creating this workflow.";
 }
 if (workflowType === "alpha_feed") {
 if (!feedProducts.length) {
 return "Select at least one feed product before creating this workflow.";
 }
 if (feedTriggerLlmEnabled) {
 if (!feedConditionPrompt.trim()) {
 return "Enter a trigger LLM condition, or turn off trigger LLM to alert on feed filters only.";
 }
 if (!feedProvider) {
 return "Select a trigger LLM provider, or turn off trigger LLM to alert on feed filters only.";
 }
 if (!feedModelId) {
 return "Select a trigger LLM model, or turn off trigger LLM to alert on feed filters only.";
 }
 }
 if (announcementsEnabled && feedCategoryFilterEnabled && !feedAnnouncementCategories.length) {
 return "Select at least one announcement category, or switch back to all categories.";
 }
 return null;
 }
 if (targetMode === "single_symbol") {
 return symbol.trim() ? null : "Select a symbol target before creating this workflow.";
 }
 if (targetMode === "symbol_list") {
 return targetEntries.length > 0 ? null : "Add at least one symbol to the target list before creating this workflow.";
 }
 if (dynamicUniverseKind === "curated_preset") {
 return selectedPresetId ? null : "Select a preset universe before creating this workflow.";
 }
 if (dynamicUniverseKind === "metadata_filter") {
 return metadataExchange.trim() || metadataInstrumentType.trim() || metadataSegmentContains.trim()
 ? null
 : "Add at least one metadata filter before creating this workflow.";
 }
 return selectedWatchlistId ? null : "Select a watchlist before creating this workflow.";
 }

 function buildPreviewTick(): Record<string, unknown> {
 const ohlcRaw = (preview.ohlc?.raw as JsonObject | undefined) ?? {};
 const quoteDetail = (preview.quote?.detail as JsonObject | undefined) ?? {};
 const quoteRaw = (quoteDetail.raw as JsonObject | undefined) ?? {};
 const quoteOhlc = (quoteRaw.ohlc as JsonObject | undefined) ?? {};
 const rawOhlc = (ohlcRaw.ohlc as JsonObject | undefined) ?? {};
 const buyDepth = ((quoteRaw.depth as JsonObject | undefined)?.buy as JsonObject[] | undefined) ?? [];
 const sellDepth = ((quoteRaw.depth as JsonObject | undefined)?.sell as JsonObject[] | undefined) ?? [];
 const bestBid = buyDepth[0] ?? {};
 const bestAsk = sellDepth[0] ?? {};
 const ltp = numeric(preview.quote?.ltp) ?? numeric(conditions[0]?.value) ?? 0;
 const openValue = numeric(preview.ohlc?.open) ?? numeric(rawOhlc.open) ?? numeric(quoteOhlc.open) ?? numeric(quoteRaw.open) ?? 0;
 const closeValue = numeric(preview.ohlc?.close) ?? numeric(rawOhlc.close) ?? numeric(quoteOhlc.close) ?? numeric(quoteRaw.close) ?? 0;
 const highValue = numeric(preview.ohlc?.high) ?? numeric(rawOhlc.high) ?? numeric(quoteOhlc.high) ?? numeric(quoteRaw.high) ?? 0;
 const lowValue = numeric(preview.ohlc?.low) ?? numeric(rawOhlc.low) ?? numeric(quoteOhlc.low) ?? numeric(quoteRaw.low) ?? 0;
 const volume = numeric(ohlcRaw.volume) ?? numeric(quoteRaw.volume) ?? 120000;
 const avgVolume = numeric(ohlcRaw.avg_volume) ?? numeric(quoteRaw.avg_volume) ?? null;
 const firstPct = conditions.find((condition) => condition.operator.includes("pct_change"));
 const referenceKey = firstPct?.compare_to || "open";
 const referenceMap: Record<string, number | null> = {
 open: openValue,
 close: closeValue,
 high: highValue,
 low: lowValue,
 avg_volume: avgVolume
 };
 const referenceValue = numeric(referenceMap[referenceKey]);
 const changePct = referenceValue && referenceValue !== 0 ? Number((((ltp - referenceValue) / referenceValue) * 100).toFixed(2)) : numeric(quoteRaw.day_change_perc);
 const absChange = referenceValue !== null ? Number((ltp - referenceValue).toFixed(2)) : null;
 const gapPct = closeValue ? Number((((openValue - closeValue) / closeValue) * 100).toFixed(2)) : null;
 return {
 ...quoteRaw,
 ...ohlcRaw,
 symbol,
 exchange,
 ltp,
 last_price: numeric(quoteRaw.last_price) ?? ltp,
 open: openValue,
 high: highValue,
 low: lowValue,
 close: closeValue,
 average_price: numeric(quoteRaw.average_price),
 reference_price: referenceValue,
 change_pct: changePct,
 abs_change: absChange,
 gap_pct: gapPct,
 volume,
 avg_volume: avgVolume,
 volume_ratio: avgVolume ? Number((volume / avgVolume).toFixed(2)) : null,
 open_interest: numeric(quoteRaw.open_interest),
 previous_open_interest: numeric(quoteRaw.previous_open_interest),
 oi_day_change: numeric(quoteRaw.oi_day_change),
 oi_day_change_percentage: numeric(quoteRaw.oi_day_change_percentage),
 day_change: numeric(quoteRaw.day_change),
 day_change_perc: numeric(quoteRaw.day_change_perc) ?? changePct,
 last_trade_quantity: numeric(quoteRaw.last_trade_quantity),
 last_trade_time: quoteRaw.last_trade_time ?? null,
 total_buy_quantity: numeric(quoteRaw.total_buy_quantity),
 total_sell_quantity: numeric(quoteRaw.total_sell_quantity),
 best_bid_price: numeric(bestBid.price),
 best_bid_quantity: numeric(bestBid.quantity),
 best_bid_orders: numeric(bestBid.orderCount),
 best_ask_price: numeric(bestAsk.price),
 best_ask_quantity: numeric(bestAsk.quantity),
 best_ask_orders: numeric(bestAsk.orderCount),
 bid_price: numeric(quoteRaw.bid_price),
 bid_quantity: numeric(quoteRaw.bid_quantity),
 offer_price: numeric(quoteRaw.offer_price),
 offer_quantity: numeric(quoteRaw.offer_quantity),
 upper_circuit_limit: numeric(quoteRaw.upper_circuit_limit),
 lower_circuit_limit: numeric(quoteRaw.lower_circuit_limit),
 week_52_high: numeric(quoteRaw.week_52_high),
 week_52_low: numeric(quoteRaw.week_52_low),
 high_trade_range: numeric(quoteRaw.high_trade_range),
 low_trade_range: numeric(quoteRaw.low_trade_range),
 implied_volatility: numeric(quoteRaw.implied_volatility),
 market_cap: numeric(quoteRaw.market_cap),
 broker_code: selectedAccount?.broker_code ?? brokerCode,
 account_id: selectedAccount?.id ?? accountId
 };
 }

 function previewTest() {
 if (!initialWorkflow) return;
 setError("");
 setMatchPreview("");
 startTransition(async () => {
 try {
 const result = await testAlertWorkflow(initialWorkflow.id, buildPreviewTick());
 setMatchPreview(result.matched ? `Current preview tick matched the workflow: ${result.reason}` : `Current preview tick did not match: ${result.reason}`);
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not test workflow.");
 }
 });
 }

 function sendTestAlert() {
 if (!initialWorkflow) return;
 setError("");
 setMatchPreview("");
 startTransition(async () => {
 try {
 const result = await sendWorkflowTestNotification(initialWorkflow.id, buildPreviewTick());
 setMatchPreview(`${result.message} Notification id: ${result.notification_id}`);
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not send test alert.");
 }
 });
 }

 function previewLlmContext() {
 if (!initialWorkflow?.id) return;
 setError("");
 setLlmFeedback("");
 setLlmDetails(null);
 startTransition(async () => {
 try {
 const result = await previewAlertWorkflowLlmContext(initialWorkflow.id, buildPreviewTick());
 setLlmFeedback(`Resolved ${Object.keys(result.placeholders ?? {}).length} placeholder context block${Object.keys(result.placeholders ?? {}).length === 1 ? "" : "s"} for ${result.symbol}.`);
 setLlmDetails(result as unknown as Record<string, unknown>);
 setLlmPromptTab("preview");
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not preview LLM context.");
 }
 });
 }

 function testLlmAnalysis() {
 if (!initialWorkflow?.id) return;
 setError("");
 setLlmFeedback("");
 setLlmDetails(null);
 startTransition(async () => {
 try {
 const result = await testAlertWorkflowLlm(initialWorkflow.id, buildPreviewTick());
 const analysis = result.llm_analysis ?? {};
 setLlmFeedback(String(analysis.output || analysis.error || analysis.status || "LLM test completed."));
 setLlmDetails(result as unknown as Record<string, unknown>);
 setLlmPromptTab("preview");
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not run LLM test.");
 }
 });
 }

 function loadSymbolQuote(item: UniverseSymbolPreview) {
 const key = `${item.symbol}:${item.exchange ?? ""}`;
 setHoveredSymbolKey(key);
 setHoverQuote(null);
 if (!selectedAccount || !item.symbol || !livePreviewAllowed) return;
 setHoverQuoteLoading(true);
 startTransition(async () => {
 try {
 const [quote] = await getDataQuotes(selectedAccount.id, {
 instruments: [
 {
 ...(item.instrument_ref ?? {}),
 symbol: item.symbol,
 exchange: item.exchange ?? undefined
 }
 ]
 });
 setHoverQuote(quote ?? null);
 } catch {
 setHoverQuote(null);
 } finally {
 setHoverQuoteLoading(false);
 }
 });
 }

 function removeWorkflow() {
 if (!initialWorkflow?.id || typeof window === "undefined") return;
 if (!window.confirm(`Delete workflow "${initialWorkflow.name}"? This removes its live subscription and history remains only in past notifications.`)) {
 return;
 }
 setError("");
 startTransition(async () => {
 try {
 await deleteAlertWorkflow(initialWorkflow.id);
 router.push("/alerts-workspace/workflows");
 router.refresh();
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not delete workflow.");
 }
 });
 }

 function addCurrentTarget() {
 const entry = buildTargetEntry(symbol, exchange, activeInstrument);
 if (!entry) return;
 setTargetEntries((current) => normalizeTargets([...current, entry]));
 }

 function removeTarget(index: number) {
 setTargetEntries((current) => current.filter((_, currentIndex) => currentIndex !== index));
 }

 function loadTarget(entry: AlertTargetEntry) {
 setSymbol(entry.symbol);
 setExchange(entry.exchange ?? "NSE");
 setInstrumentRef(entry.instrument_ref);
 setSelectedSearchLabel(targetDisplay(entry));
 }

 function importBulkTargets() {
 const imported = parseBulkTargets(bulkTargets, exchange);
 if (!imported.length) {
 return;
 }
 setTargetEntries((current) => normalizeTargets([...current, ...imported]));
 setBulkTargets("");
 }

 function clearTargets() {
 setTargetEntries([]);
 }

 function runEngineAction(action: "validate" | "compile" | "explain" | "samples" | "deploy") {
 if (!initialWorkflow?.id) return;
 setError("");
 setEngineFeedback("");
 setEngineDetails(null);
 startTransition(async () => {
 try {
 let result: Record<string, unknown>;
 if (action === "validate") {
 result = (await validateAlertWorkflow(initialWorkflow.id)) as unknown as Record<string, unknown>;
 setEngineFeedback((result.valid as boolean) ? "Workflow validation passed." : "Workflow validation failed.");
 if (result.valid && result.workflow_ast) {
 syncVisualBuilderFromAst(result.workflow_ast);
 }
 } else if (action === "compile") {
 result = (await compilePreviewAlertWorkflow(initialWorkflow.id)) as unknown as Record<string, unknown>;
 setEngineFeedback((result.valid as boolean) ? "Compile preview is valid." : "Compile preview has errors.");
 if (result.valid && result.workflow_ast) {
 syncVisualBuilderFromAst(result.workflow_ast);
 }
 } else if (action === "explain") {
 result = await explainAlertWorkflow(initialWorkflow.id);
 setEngineFeedback(String(result.summary ?? "Workflow explanation generated."));
 } else if (action === "samples") {
 result = await getWorkflowSampleAlerts(initialWorkflow.id);
 setEngineFeedback("Sample alert payload generated.");
 } else {
 const deployed = await deployAlertWorkflow(initialWorkflow.id);
 result = deployed as unknown as Record<string, unknown>;
 setEngineFeedback(`Workflow deployed as version ${deployed.deploy_version ?? 0}.`);
 router.refresh();
 }
 setEngineDetails(result);
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Workflow engine action failed.");
 }
 });
 }

 const currentTemplatesMatchSuggestion = titleTemplate === suggestedCopy.title && messageTemplate === suggestedCopy.message;
 const selectedLlmProvider = llmProviders.find((item) => item.provider === llmProvider);
 const selectedLlmModels = selectedLlmProvider?.models.filter((model) => model.is_enabled) ?? [];
 const selectedFeedProvider = llmProviders.find((item) => item.provider === feedProvider);
 const selectedFeedModels = selectedFeedProvider?.models.filter((model) => model.is_enabled) ?? [];
 let visibleStepIndex = 1;
 const nextStep = () => `Step ${visibleStepIndex++}`;
 const workflowBasicsStep = nextStep();
 const marketWindowStep = workflowType === "market_data" ? nextStep() : "";
 const feedTriggerStep = workflowType === "alpha_feed" ? nextStep() : "";
 const targetStep = workflowType === "market_data" ? nextStep() : "";
 const validateTargetStep = workflowType === "market_data" ? nextStep() : "";
 const buildTriggerStep = nextStep();
 const optionalAnalysisStep = nextStep();
 const reviewCopyStep = !currentTemplatesMatchSuggestion ? nextStep() : "";
 const advancedDeploymentStep = nextStep();
 const deliveryLifecycleStep = nextStep();

function toggleFeedProduct(product: string, checked: boolean) {
 setFeedProducts((current) => checked ? Array.from(new Set([...current, product])) : current.filter((item) => item !== product));
}

 function toggleFeedAnnouncementCategory(category: string, checked: boolean) {
 setFeedAnnouncementCategories((current) => checked ? Array.from(new Set([...current, category])) : current.filter((item) => item !== category));
 }

 function enableSpecificAnnouncementCategories() {
 setFeedCategoryFilterEnabled(true);
 }

 function useAllAnnouncementCategories() {
 setFeedCategoryFilterEnabled(false);
 setFeedCategoryQuery("");
 }

 function selectAllAnnouncementCategories() {
 setFeedCategoryFilterEnabled(true);
 setFeedAnnouncementCategories(availableAnnouncementCategories);
 }

 function clearAnnouncementCategorySelection() {
 setFeedAnnouncementCategories([]);
 }

function toggleFeedWatchlist(id: string, checked: boolean) {
 setFeedWatchlistIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id));
}

 function toggleFeedPreset(id: string, checked: boolean) {
 setFeedPresetIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id));
 }

 return (
 <div className="grid max-w-5xl gap-4">
 {error ? <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div> : null}
 {notice ? <div className="border-l-2 border-primary bg-secondary/30 px-4 py-3 text-sm text-foreground">{notice}</div> : null}
 {isTemplateDraft ? <div className="border-l-2 border-primary bg-secondary/30 px-4 py-3 text-sm text-foreground">Template loaded as a new workflow draft. Saving creates your own workflow and leaves the system template unchanged.</div> : null}
{matchPreview ? <div className="type-body border border-border px-4 py-3 text-muted-foreground">{matchPreview}</div> : null}

 <div className="grid gap-4">
 <div className="grid gap-4">
 <div className="border border-border p-3">
 <StepHeader
 step={workflowBasicsStep}
 title="Workflow basics"
 description={workflowType === "alpha_feed"
 ? "Set the workflow identity first so the trigger mode and naming are clear before you configure the feed source."
 : "Set the workflow identity first so the trigger mode and naming are clear before you configure the market window or targets."}
 />
 <div className="grid max-w-3xl items-start gap-3 min-[760px]:grid-cols-[220px_minmax(0,360px)]">
 <Label className="grid content-start self-start gap-2 text-sm">
 <FieldLabel>Workflow type</FieldLabel>
 <Select className="h-9 max-w-full border border-input bg-background px-3 text-sm" onChange={(event) => setWorkflowType(event.target.value as "market_data" | "alpha_feed")} value={workflowType}>
 <option value="market_data">Broker market data trigger</option>
 <option value="alpha_feed">Market Stack websocket feed trigger</option>
 </Select>
 <HelpText>
 {workflowType === "alpha_feed"
 ? "This workflow analyzes stored Market Stack websocket items from your configured feed symbols, watchlists, presets, or full-market tier."
 : "This workflow evaluates broker quote ticks first, then optionally runs LLM analysis after a trigger."}
 </HelpText>
 </Label>
 <Label className="grid content-start self-start gap-2 text-sm">
 <FieldLabel>Workflow name</FieldLabel>
 <Input onChange={(event) => setName(event.target.value)} placeholder="Workflow name" title="Use a short trading-oriented name. Example: RELIANCE breakout above 1430." value={name} />
 <HelpText>This is the name shown in workflow lists and alert history.</HelpText>
 </Label>
 </div>
 <Label className="mt-3 grid max-w-2xl gap-2 text-sm">
 <FieldLabel>Description</FieldLabel>
 <Input onChange={(event) => setDescription(event.target.value)} placeholder="Description" title="Optional human note about why this workflow exists." value={description} />
 <HelpText>Use this for strategy intent, not execution logic.</HelpText>
 </Label>
 </div>

{workflowType === "market_data" ? (
 <div className="border border-border p-3">
 <StepHeader
 step={marketWindowStep}
 title="Market window"
 description="Broker market-data workflows ignore ticks outside this window, preventing stale post-close quotes from creating alerts."
 action={<Label className="flex items-center gap-2 text-sm">
 <Checkbox checked={activePeriodEnabled} onCheckedChange={(checked) => setActivePeriodEnabled(Boolean(checked))} />
 Enforce active period
 </Label>}
 />
 <div className="grid max-w-2xl items-start gap-3 min-[760px]:grid-cols-[minmax(0,280px)_100px_100px]">
 <Label className="grid content-start self-start gap-2 text-sm">
 <FieldLabel>Timezone</FieldLabel>
 <Input onChange={(event) => setActiveTimezone(event.target.value)} placeholder="Asia/Kolkata" value={activeTimezone} />
 <HelpText>Default is `Asia/Kolkata` for NSE/BSE market hours.</HelpText>
 </Label>
 <Label className="grid content-start self-start gap-2 text-sm">
 <FieldLabel>Start</FieldLabel>
 <Input onChange={(event) => setActiveSessionStart(event.target.value)} placeholder="09:15" value={activeSessionStart} />
 <HelpText>Session start time.</HelpText>
 </Label>
 <Label className="grid content-start self-start gap-2 text-sm">
 <FieldLabel>End</FieldLabel>
 <Input onChange={(event) => setActiveSessionEnd(event.target.value)} placeholder="15:30" value={activeSessionEnd} />
 <HelpText>Session end time.</HelpText>
 </Label>
 </div>
 <div className="mt-3 grid max-w-3xl items-start gap-3 min-[760px]:grid-cols-[minmax(0,280px)_1fr]">
 <Label className="grid content-start self-start gap-2 text-sm">
 <FieldLabel>Session label</FieldLabel>
 <Input onChange={(event) => setActiveSessionLabel(event.target.value)} placeholder="Regular market" value={activeSessionLabel} />
 <HelpText>Saved with runtime evaluation metadata.</HelpText>
 </Label>
 <div className="grid content-start self-start gap-2">
 <FieldLabel>Days</FieldLabel>
 <div className="flex flex-wrap gap-3">
 {dayOptions.map(([day, label]) => (
 <Label className="flex items-center gap-1.5 text-sm" key={day}>
 <Checkbox checked={activeDays.includes(day)} onCheckedChange={(checked) => toggleActiveDay(day, Boolean(checked))} />
 {label}
 </Label>
 ))}
 </div>
 <HelpText>Common default is Monday-Friday.</HelpText>
 </div>
 </div>
 <div className="mt-3 border border-border p-3">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <SectionTitle>Advanced scope</SectionTitle>
 <HelpText>Optional filters for restricting the active period to specific markets and instruments.</HelpText>
 </div>
 <Button
 onClick={() => setShowAdvancedMarketScope((current) => !current)}
 size="sm"
 type="button"
 variant="secondary"
 >
 {showAdvancedMarketScope ? "Hide optional scope" : `Show optional scope${advancedMarketScopeCount ? ` (${advancedMarketScopeCount})` : ""}`}
 </Button>
 </div>
 {showAdvancedMarketScope ? (
 <div className="mt-3 grid gap-3 min-[980px]:grid-cols-2">
 <Label className="grid gap-2 text-sm">
 <FieldLabel>Exchanges</FieldLabel>
 <Input className="font-mono uppercase" onChange={(event) => setActiveExchanges(event.target.value.toUpperCase())} placeholder="NSE, BSE" value={activeExchanges} />
 <HelpText>Optional exchange scope.</HelpText>
 </Label>
 <Label className="grid gap-2 text-sm">
 <FieldLabel>Exchange types</FieldLabel>
 <Input className="font-mono uppercase" onChange={(event) => setActiveExchangeTypes(event.target.value.toUpperCase())} placeholder="NSE, BSE, NFO" value={activeExchangeTypes} />
 <HelpText>Optional exchange-type scope.</HelpText>
 </Label>
 <Label className="grid gap-2 text-sm">
 <FieldLabel>Segments</FieldLabel>
 <Input className="font-mono uppercase" onChange={(event) => setActiveSegments(event.target.value.toUpperCase())} placeholder="NSE, NFO-OPT" value={activeSegments} />
 <HelpText>Optional broker segment scope from synced instruments.</HelpText>
 </Label>
 <Label className="grid gap-2 text-sm">
 <FieldLabel>Instrument types</FieldLabel>
 <Input className="font-mono uppercase" onChange={(event) => setActiveInstrumentTypes(event.target.value.toUpperCase())} placeholder="EQ, FUT, CE, PE" value={activeInstrumentTypes} />
 <HelpText>Optional instrument-type scope.</HelpText>
 </Label>
 </div>
 ) : null}
 </div>
 </div>
) : null}

 {workflowType === "alpha_feed" ? (
 <div className="border border-border p-3">
 <StepHeader
 step={feedTriggerStep}
 title="Feed trigger"
 description="Choose which Market Stack websocket products and symbol scopes can create alerts before optional trigger LLM classification runs."
 />
 <div className="grid max-w-3xl gap-4 min-[900px]:grid-cols-2">
 <div>
 <FieldLabel>Products</FieldLabel>
 <div className="mt-3 grid gap-2">
 {alphaFeedProducts.map((product) => (
 <Label className="flex items-center gap-2 text-sm" key={product}>
 <Checkbox checked={feedProducts.includes(product)} onCheckedChange={(checked) => toggleFeedProduct(product, Boolean(checked))} />
 <span>{product}</span>
 </Label>
 ))}
 </div>
 </div>
 <div>
 <FieldLabel>Feed scope</FieldLabel>
 <Select className="mt-3 h-9 w-full border border-input bg-background px-3 text-sm" onChange={(event) => setFeedSourceScope(event.target.value as typeof feedSourceScope)} value={feedSourceScope}>
 <option value="current_alpha_subscription">Current configured Alpha subscription</option>
 <option value="watchlists">Specific watchlists</option>
 <option value="preset_lists">Preset lists</option>
 <option value="full_market">Full market feed</option>
 </Select>
 <HelpText>Events are only available for symbols currently subscribed by the background Market Stack websocket worker unless full-market is enabled for the chosen products.</HelpText>
 </div>
 {announcementsEnabled ? (
 <div className="min-w-0">
 <FieldLabel>Announcement categories</FieldLabel>
 <div className="mt-3 grid gap-2.5">
 <div className="inline-flex w-fit border border-border p-1">
 <Button className="h-7 px-2.5 text-xs" onClick={useAllAnnouncementCategories} size="sm" type="button" variant={!feedCategoryFilterEnabled ? "secondary" : "ghost"}>All</Button>
 <Button className="h-7 px-2.5 text-xs" onClick={enableSpecificAnnouncementCategories} size="sm" type="button" variant={feedCategoryFilterEnabled ? "secondary" : "ghost"}>Specific</Button>
 </div>
 {!feedCategoryFilterEnabled ? (
 <HelpText>All announcement categories are currently allowed. Turn on specific-category mode only when you want to restrict this workflow.</HelpText>
 ) : (
 <>
 <div className="flex flex-wrap items-center gap-2">
 <Button className="h-7 px-2.5 text-xs" onClick={selectAllAnnouncementCategories} size="sm" type="button" variant="ghost">Select all</Button>
 <Button className="h-7 px-2.5 text-xs" onClick={clearAnnouncementCategorySelection} size="sm" type="button" variant="ghost">Clear</Button>
 <HelpText>{feedAnnouncementCategories.length} selected</HelpText>
 </div>
 <Input className="h-9" onChange={(event) => setFeedCategoryQuery(event.target.value)} placeholder="Filter categories" value={feedCategoryQuery} />
 <Label className="flex items-center gap-2 text-sm">
 <Checkbox checked={feedIncludeRelatedCategories} onCheckedChange={(checked) => setFeedIncludeRelatedCategories(Boolean(checked))} />
 Also match related announcement categories
 </Label>
 <div className="max-h-48 overflow-auto border border-border">
 {filteredAnnouncementCategories.map((category) => (
 <Label className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-2.5 py-1.5 text-sm last:border-b-0" key={category} title={category}>
 <span className="min-w-0 truncate">{announcementCategoryLabel(category)}</span>
 <Checkbox checked={feedAnnouncementCategories.includes(category)} onCheckedChange={(checked) => toggleFeedAnnouncementCategory(category, Boolean(checked))} />
 </Label>
 ))}
{!filteredAnnouncementCategories.length ? <div className="type-help px-3 py-2 text-muted-foreground">No categories available for the current filter.</div> : null}
 </div>
 {!feedAnnouncementCategories.length ? <HelpText>Select at least one category, or switch back to `All categories`.</HelpText> : null}
 </>
 )}
 <HelpText>The category API is only used while this editor page loads. Live matching uses the category fields already present in incoming announcement payloads.</HelpText>
 </div>
 </div>
 ) : null}
 </div>
 {feedSourceScope === "watchlists" ? (
 <div className="grid gap-2">
 <Label className="flex items-center gap-2 text-sm">
 <Checkbox checked={feedIncludeAllWatchlists} onCheckedChange={(checked) => setFeedIncludeAllWatchlists(Boolean(checked))} />
 All watchlists
 </Label>
 <div className="max-h-44 overflow-auto border border-border">
 {watchlists.map((watchlist) => (
 <Label className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm" key={watchlist.id}>
 <span>{watchlist.name}</span>
 <Checkbox checked={feedWatchlistIds.includes(watchlist.id)} disabled={feedIncludeAllWatchlists} onCheckedChange={(checked) => toggleFeedWatchlist(watchlist.id, Boolean(checked))} />
 </Label>
 ))}
 </div>
 </div>
 ) : null}
 {feedSourceScope === "preset_lists" ? (
 <div className="grid gap-2">
 <FieldLabel>Preset lists</FieldLabel>
 <div className="max-h-44 overflow-auto border border-border">
 {presets.map((preset) => {
 const id = String(preset.id ?? "");
 return (
 <Label className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm" key={id}>
 <span>{String(preset.label ?? id)}</span>
 <Checkbox checked={feedPresetIds.includes(id)} onCheckedChange={(checked) => toggleFeedPreset(id, Boolean(checked))} />
 </Label>
 );
 })}
 </div>
 </div>
 ) : null}
 <div className="grid gap-2">
 <div className="flex items-center justify-between gap-3">
 <FieldLabel>Trigger LLM</FieldLabel>
 <Label className="flex items-center gap-2 text-sm">
 <Checkbox checked={feedTriggerLlmEnabled} onCheckedChange={(checked) => setFeedTriggerLlmEnabled(Boolean(checked))} />
 Enable
 </Label>
 </div>
 <div className="grid gap-2">
 <Select className="h-10 border border-input bg-background px-3 text-sm" disabled={!feedTriggerLlmEnabled} onChange={(event) => setFeedProvider(event.target.value as LlmProvider | "")} value={feedProvider}>
 <option value="">Select provider</option>
 {enabledLlmProviders.map((provider) => <option key={provider.provider} value={provider.provider}>{provider.label}</option>)}
 </Select>
 <Select className="h-10 border border-input bg-background px-3 text-sm" disabled={!feedTriggerLlmEnabled} onChange={(event) => setFeedModelId(event.target.value)} value={feedModelId}>
 <option value="">Select model</option>
 {selectedFeedModels.map((model) => <option key={model.id} value={model.model_id}>{model.label || model.model_id}</option>)}
 </Select>
 </div>
 <HelpText>{feedTriggerLlmEnabled ? "The trigger model classifies matched feed items after product, symbol, and category filters pass." : "Off means every item that passes product, symbol scope, and category filters can create an alert without trigger LLM usage."}</HelpText>
 </div>
 <div className="grid gap-2">
 <Label className="grid gap-2">
 <FieldLabel>Natural-language trigger condition</FieldLabel>
 <Textarea className="min-h-28 border border-input bg-background p-3 text-sm" disabled={!feedTriggerLlmEnabled} onChange={(event) => setFeedConditionPrompt(event.target.value)} placeholder="Example: Alert me when the item is about a confirmed order win, large contract, or new customer mandate." value={feedConditionPrompt} />
 </Label>
 <HelpText>{feedTriggerLlmEnabled ? "The trigger model returns strict JSON with match, reason, confidence, and matched terms. Optional post-trigger LLM analysis below still runs separately." : "This is only used when trigger LLM is enabled. Category and scope filters still work without it."}</HelpText>
 </div>
 <div className="grid gap-3 min-[720px]:grid-cols-3">
 <Input onChange={(event) => setFeedTemperature(event.target.value)} placeholder="Trigger temperature" value={feedTemperature} />
 <Input onChange={(event) => setFeedMaxTokens(event.target.value)} placeholder="Trigger max tokens" value={feedMaxTokens} />
 <Input onChange={(event) => setFeedTimeout(event.target.value)} placeholder="Trigger timeout seconds" value={feedTimeout} />
 </div>
 </div>
 ) : (
 <div className=" border border-border p-3">
 <StepHeader
 step={targetStep}
 title="Target"
 description="The workflow can target one symbol today or a shared symbol list under the same rules. Preset universes are reserved for the next layer."
 action={<Label className="grid max-w-[280px] gap-2 text-sm">
 <FieldLabel>Target mode</FieldLabel>
 <Select
 className="h-9 border border-input bg-background px-3 text-sm"
 onChange={(event) => {
 const nextMode = event.target.value as AlertWorkflowTargeting["mode"];
 setTargetMode(nextMode);
 if (nextMode === "symbol_list" && !targetEntries.length) {
 const currentTarget = buildTargetEntry(symbol, exchange, activeInstrument);
 if (currentTarget) {
 setTargetEntries([currentTarget]);
 }
 }
 }}
 value={targetMode}
 >
 <option value="single_symbol">Single symbol</option>
 <option value="symbol_list">Symbol list</option>
 <option value="preset_universe">Preset universe</option>
 </Select>
 </Label>}
 />
 <div className="grid gap-3">
 <Label className="grid max-w-sm gap-2 text-sm">
 <FieldLabel>Broker account</FieldLabel>
 <Select
 className="h-9 border border-input bg-background px-3 text-sm"
 onChange={(event) => setAccountId(event.target.value)}
 value={accountId}
 >
 {accounts.map((account) => (
 <option key={account.id} value={account.id}>
 {account.label} · {account.broker_code}
 </option>
 ))}
 </Select>
 <HelpText>The broker account decides which instrument universe and quote API will be used.</HelpText>
 </Label>
 <div className="grid max-w-3xl items-start gap-x-3 gap-y-2 min-[760px]:grid-cols-[minmax(0,1fr)_120px]">
 <div className="relative grid content-start gap-2" ref={symbolWrapRef}>
 <Label className="grid content-start gap-2 text-sm">
 <FieldLabel>Search symbol</FieldLabel>
 <Input
 className="h-10"
 onChange={(event) => {
 setSymbol(event.target.value.toUpperCase());
 setInstrumentRef({ symbol: event.target.value.toUpperCase(), exchange });
 setSelectedSearchLabel("");
 setShowSuggestions(true);
 }}
 onFocus={() => {
 if (suggestions.length) {
 setShowSuggestions(true);
 }
 }}
 placeholder="Search symbol"
 title="Start typing to search the synced broker instrument master for live suggestions."
 value={symbol}
 />
 </Label>
 {showSuggestions && suggestions.length ? (
 <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[280px] overflow-y-auto border border-border bg-background">
 {suggestions.map((row, index) => {
 const metadata = suggestionMetadata[row.symbol.trim().toUpperCase()];
 const detail = [metadata?.company_name ?? row.name, row.trading_symbol, row.account_label].filter(Boolean).join(" / ");
 return (
 <button
 className="flex min-h-[58px] w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm normal-case tracking-normal text-foreground transition-colors last:border-b-0 hover:bg-[var(--accent-glow)] focus-visible:border-ring focus-visible:outline-none"
 key={[row.symbol, row.exchange, row.trading_symbol, index].join(":")}
 onClick={() => selectSuggestion(row)}
 type="button"
 >
 <span className="flex min-w-0 items-center gap-3">
 {metadata?.logo ? (
 <img alt="" className="size-8 shrink-0 object-contain" src={metadata.logo} />
 ) : (
 <span className="flex size-8 shrink-0 items-center justify-center font-mono text-[10px] font-semibold uppercase text-muted-foreground">
 {row.symbol.slice(0, 2)}
 </span>
 )}
 <span className="min-w-0">
 <span className="block truncate font-mono text-sm font-semibold leading-5">{row.symbol}</span>
 <span className="block truncate text-[12px] leading-4 text-muted-foreground">
 {detail}
 </span>
 </span>
 </span>
 <span className="shrink-0 font-mono text-[11px] uppercase leading-4 text-primary">
 {[row.exchange, row.instrument_type].filter(Boolean).join(" / ")}
 </span>
 </button>
 );
 })}
 </div>
 ) : null}
 {targetMode === "preset_universe" && String(workflowType) === "alpha_feed" ? (
 <div className="mt-3 grid gap-3 border border-border p-3">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <SectionTitle>Resolved symbols</SectionTitle>
 <HelpText>
 {dynamicUniverseKind === "watchlist"
 ? `${universeSymbols.length} symbol${universeSymbols.length === 1 ? "" : "s"} from ${selectedWatchlist?.name ?? "watchlist"}.`
 : universePreviewLoading
 ? "Resolving universe..."
 : `${universePreview?.count ?? universeSymbols.length} matching symbol${(universePreview?.count ?? universeSymbols.length) === 1 ? "" : "s"}.`}
 </HelpText>
 </div>
 </div>
 <div className="flex max-h-56 flex-wrap gap-2 overflow-auto">
 {universeSymbols.map((item) => {
 const key = `${item.symbol}:${item.exchange ?? ""}`;
 return (
 <div className="relative" key={key}>
 <Button
 className="border border-border px-2 py-1 font-mono text-xs hover:border-primary"
 onFocus={() => loadSymbolQuote(item)}
 onMouseEnter={() => loadSymbolQuote(item)}
 onMouseLeave={() => setHoveredSymbolKey("")}
 size="sm"
 type="button"
 variant="ghost"
 >
 {[item.symbol, item.exchange].filter(Boolean).join(" · ")}
 </Button>
 {hoveredSymbolKey === key ? (
 <SymbolQuoteTooltip loading={hoverQuoteLoading} quote={hoverQuote} />
 ) : null}
 </div>
 );
 })}
{!universeSymbols.length ? <div className="type-help text-muted-foreground">No symbols resolved for this universe yet.</div> : null}
 </div>
 </div>
 ) : null}
 </div>
 <Label className="grid content-start gap-2 text-sm">
 <FieldLabel>Exchange</FieldLabel>
 <Input
 className="h-10"
 onChange={(event) => {
 setExchange(event.target.value.toUpperCase());
 setInstrumentRef((current) => ({ ...current, exchange: event.target.value.toUpperCase() }));
 }}
 placeholder="Exchange"
 title="Usually NSE or BSE. Kept editable in case the selected trading symbol exists on multiple exchanges."
 value={exchange}
 />
 </Label>
 <HelpText className="min-[760px]:col-span-2">
 {searchLoading
 ? "Searching instruments..."
 : selectedSearchLabel || "Type a symbol name or trading symbol and choose a suggestion. Exchange is used with the selected instrument identifiers for market data requests."}
 </HelpText>
 </div>
 {targetMode === "symbol_list" ? (
 <div className="mt-3 grid gap-3 border border-border p-3">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <SectionTitle>Target list</SectionTitle>
 <HelpText>Add one symbol at a time from the search box above or bulk import many symbols. These all share the same workflow conditions and notification rules.</HelpText>
 </div>
 <div className="flex flex-wrap gap-2">
 <Button onClick={addCurrentTarget} type="button">Add current symbol</Button>
 <Button onClick={clearTargets} type="button" variant="destructive">Clear list</Button>
 </div>
 </div>
 <div className="grid gap-2">
 <FieldLabel>Bulk import</FieldLabel>
 <Textarea
 className="min-h-[108px] w-full border border-input bg-background px-3 py-2 text-sm outline-none"
 onChange={(event) => setBulkTargets(event.target.value.toUpperCase())}
 placeholder={targetListExample}
 value={bulkTargets}
 />
 <div className="flex flex-wrap items-center justify-between gap-2">
 <HelpText>Use one per line. Accepted forms: `RELIANCE`, `RELIANCE NSE`, `RELIANCE:NSE`.</HelpText>
 <Button onClick={importBulkTargets} type="button">Import symbols</Button>
 </div>
 </div>
 <div className="grid gap-2">
 <div className="type-step-eyebrow">Current targets · {targetEntries.length}</div>
 {targetEntries.map((entry, index) => (
 <div className="flex flex-wrap items-center justify-between gap-3 border border-border px-3 py-2" key={`${entry.symbol}:${entry.exchange ?? ""}:${index}`}>
 <Button className="h-auto px-0 text-left" onClick={() => loadTarget(entry)} type="button" variant="ghost">
 <div className="font-semibold">{entry.symbol}</div>
 <div className="type-meta">{entry.exchange ?? "-"} · shared rule target</div>
 </Button>
 <Button onClick={() => removeTarget(index)} size="sm" type="button" variant="destructive">Remove</Button>
 </div>
 ))}
{!targetEntries.length ? <div className="type-help text-muted-foreground">No targets added yet.</div> : null}
 </div>
 </div>
 ) : null}
{targetMode === "preset_universe" ? (
<div className="mt-3 grid gap-3 border border-border p-3">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <SectionTitle>Dynamic universe</SectionTitle>
 <HelpText>Use a live watchlist or a backend preset as the workflow target. The subscription reconciler keeps the resolved symbols current.</HelpText>
 </div>
 <Select
 className="h-10 min-w-[220px] border border-input bg-background px-3 text-sm"
 onChange={(event) => setDynamicUniverseKind(event.target.value)}
 value={dynamicUniverseKind}
 >
 <option value="watchlist">Watchlist</option>
 <option value="curated_preset">Curated preset</option>
 <option value="metadata_filter">Metadata filter</option>
 </Select>
 </div>
 {dynamicUniverseKind === "watchlist" ? (
 <div className="grid max-w-[420px] gap-2">
 <Select
 className="h-10 border border-input bg-background px-3 text-sm"
 onChange={(event) => setSelectedWatchlistId(event.target.value)}
 value={selectedWatchlistId}
 >
 {watchlists.map((watchlist) => (
 <option key={watchlist.id} value={watchlist.id}>
 {watchlist.name} · {watchlist.items.length} symbols
 </option>
 ))}
 </Select>
 {!watchlists.length ? <HelpText>Create a watchlist first, then return here to link it to this workflow.</HelpText> : <HelpText>Symbols added to or removed from this watchlist are reconciled into live subscriptions automatically.</HelpText>}
 </div>
 ) : dynamicUniverseKind === "curated_preset" ? (
 <div className="grid max-w-[420px] gap-2">
 <Select
 className="h-10 border border-input bg-background px-3 text-sm"
 onChange={(event) => setSelectedPresetId(event.target.value)}
 value={selectedPresetId}
 >
 {presets.map((preset) => (
 <option key={String(preset.id)} value={String(preset.id)}>
 {String(preset.label ?? preset.id)}
 </option>
 ))}
 </Select>
 <HelpText>Presets are resolved from backend registry rules and broker instrument metadata.</HelpText>
 </div>
 ) : dynamicUniverseKind === "metadata_filter" ? (
 <div className="grid gap-3 min-[980px]:grid-cols-3">
 <Label className="grid gap-2 text-sm">
 <FieldLabel>Exchange filter</FieldLabel>
 <Input className="font-mono uppercase" onChange={(event) => setMetadataExchange(event.target.value.toUpperCase())} placeholder="NSE" value={metadataExchange} />
 <HelpText>Exchange filter.</HelpText>
 </Label>
 <Label className="grid gap-2 text-sm">
 <FieldLabel>Instrument type</FieldLabel>
 <Input className="font-mono uppercase" onChange={(event) => setMetadataInstrumentType(event.target.value.toUpperCase())} placeholder="EQ" value={metadataInstrumentType} />
 <HelpText>Instrument type filter.</HelpText>
 </Label>
 <Label className="grid gap-2 text-sm">
 <FieldLabel>Segment contains</FieldLabel>
 <Input className="font-mono uppercase" onChange={(event) => setMetadataSegmentContains(event.target.value.toUpperCase())} placeholder="FO" value={metadataSegmentContains} />
 <HelpText>Optional segment contains filter.</HelpText>
 </Label>
 </div>
 ) : null}
 <div className="grid gap-3 border border-border p-4">
 <SectionTitle>Resolved symbols</SectionTitle>
 <HelpText>
 {dynamicUniverseKind === "watchlist"
 ? `${universeSymbols.length} symbol${universeSymbols.length === 1 ? "" : "s"} from ${selectedWatchlist?.name ?? "watchlist"}.`
 : universePreviewLoading
 ? "Resolving universe..."
 : `${universePreview?.count ?? universeSymbols.length} matching symbol${(universePreview?.count ?? universeSymbols.length) === 1 ? "" : "s"}.`}
 </HelpText>
 <div className="flex max-h-56 flex-wrap gap-2 overflow-auto">
 {universeSymbols.map((item) => {
 const key = `${item.symbol}:${item.exchange ?? ""}`;
 return (
 <div className="relative" key={key}>
 <Button
 className="border border-border px-2 py-1 font-mono text-xs hover:border-primary"
 onFocus={() => loadSymbolQuote(item)}
 onMouseEnter={() => loadSymbolQuote(item)}
 onMouseLeave={() => setHoveredSymbolKey("")}
 size="sm"
 type="button"
 variant="ghost"
 >
 {[item.symbol, item.exchange].filter(Boolean).join(" - ")}
 </Button>
 {hoveredSymbolKey === key ? (
 <SymbolQuoteTooltip loading={hoverQuoteLoading} quote={hoverQuote} />
 ) : null}
 </div>
 );
 })}
{!universeSymbols.length ? <div className="type-help text-muted-foreground">No symbols resolved for this universe yet.</div> : null}
 </div>
 </div>
 </div>
 ) : null}
 </div>
 </div>
 )}

 </div>
{workflowType === "market_data" ? (
 <div className="border border-border p-3">
 <StepHeader
 step={validateTargetStep}
 title="Validate target"
 description="Use the live preview to confirm the selected symbol and market data before you move on to rule building."
 action={<div className="flex flex-wrap items-center gap-2">
 <div className="type-meta">{preview.loading ? "Refreshing..." : preview.quote ? "Live preview active" : "No symbol selected"}</div>
 <div className="inline-flex border border-border p-1">
 <Button
 className={previewMode === "summary" ? "bg-secondary text-foreground" : "text-muted-foreground"}
 onClick={() => setPreviewMode("summary")}
 size="sm"
 type="button"
 variant="ghost"
 >
 Summary
 </Button>
 <Button
 className={previewMode === "raw" ? "bg-secondary text-foreground" : "text-muted-foreground"}
 onClick={() => setPreviewMode("raw")}
 size="sm"
 type="button"
 variant="ghost"
 >
 Raw
 </Button>
 </div>
 </div>}
 />
 <div className="type-meta mb-3 max-w-2xl border border-border px-3 py-2">
 <div className="font-semibold text-foreground">{symbol || "No symbol selected"}</div>
 <div className="mt-1">{selectedAccount ? `${selectedAccount.label} - ${selectedAccount.broker_code}` : "No broker account selected"}{exchange ? ` - ${exchange}` : ""}</div>
 </div>
 {preview.error ? <div className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--danger)]">{preview.error}</div> : null}
 {previewMode === "summary" ? (
 <LivePreviewSummary exchange={exchange} preview={preview} symbol={symbol} />
 ) : (
 <div className=" border border-border p-3">
 <div className="type-step-eyebrow">Raw payload</div>
 <pre className="type-meta mt-2 max-h-[320px] overflow-auto">{compactPreview({ quote: preview.quote, ohlc: preview.ohlc })}</pre>
 </div>
 )}
 </div>
) : null}
 </div>

 <div className="max-w-5xl">
 <Tabs onValueChange={(value) => setEditorMode(value as EditorMode)} value={editorMode}>
 <div className="grid gap-3 border border-border p-3">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div className="max-w-[760px]">
 <div className="type-step-eyebrow">{buildTriggerStep}</div>
 <h2 className="mt-1 text-xl font-semibold leading-6 text-foreground">Build trigger</h2>
 <HelpText className="mt-1.5">Start with the rule logic first, then refine the outgoing alert content underneath it.</HelpText>
 </div>
 <TabsList>
 <TabsTrigger value="rule">Rule Builder</TabsTrigger>
 <TabsTrigger value="graph">Graph Builder</TabsTrigger>
 </TabsList>
 </div>
 <TabsContent className="mt-0" value="rule">
 <RuleEditor
 addCondition={addCondition}
 applyMessageField={applyMessageField}
 combine={combine}
 conditions={conditions}
 cooldownSeconds={cooldownSeconds}
 filteredMessageFields={filteredMessageFields}
 handleMessageTemplateKeyDown={handleMessageTemplateKeyDown}
 level={level}
 messageFieldIndex={messageFieldIndex}
 messageFieldListRef={messageFieldListRef}
 messageFieldPosition={messageFieldPosition}
 messageTemplate={messageTemplate}
 messageInputRef={messageInputRef}
 messageTemplateWrapRef={messageTemplateWrapRef}
 onMessageTemplateBlur={() => window.setTimeout(() => {
 setShowMessageFieldSuggestions(false);
 setMessageFieldPosition(null);
 }, 120)}
 removeCondition={removeCondition}
 setCombine={updateCombine}
 setCooldownSeconds={setCooldownSeconds}
 setLevel={setLevel}
 setTitleTemplate={setTitleTemplate}
 showMessageFieldSuggestions={showMessageFieldSuggestions}
 titleTemplate={titleTemplate}
 updateMessageTemplate={updateMessageTemplate}
 updateCondition={updateCondition}
 />
 </TabsContent>
 <TabsContent className="mt-0" value="graph">
 <div className="grid gap-3 min-[960px]:grid-cols-[150px_1fr_1fr]">
 <div className="border border-border p-3">
 <SectionTitle className="mb-2">Trigger</SectionTitle>
 <HelpText>The graph starts from the live quote stream for the selected symbol and account.</HelpText>
 </div>
 {conditions.map((condition, index) => (
 <div className="border border-border p-3" key={`${condition.field}-${index}`}>
 <SectionTitle className="mb-2">Condition node {index + 1}</SectionTitle>
 <ConditionEditor condition={condition} index={index} removeCondition={removeCondition} updateCondition={updateCondition} />
 </div>
 ))}
 <div className="border border-border p-3 min-[960px]:col-span-3">
 <SectionTitle className="mb-2">Notification node</SectionTitle>
 <HelpText>These templates render the alert title and body when the conditions match.</HelpText>
 <div className="mt-3 grid max-w-[820px] gap-3 min-[960px]:grid-cols-[200px_minmax(0,1fr)_120px]">
 <Input className="max-w-[200px]" onChange={(event) => setTitleTemplate(event.target.value)} placeholder="Title template" value={titleTemplate} />
 <Input onChange={(event) => setMessageTemplate(event.target.value)} placeholder="Message template" value={messageTemplate} />
 <Input className="max-w-[120px]" onChange={(event) => setLevel(event.target.value)} placeholder="Level" value={level} />
 </div>
 </div>
 </div>
 </TabsContent>
 </div>
 </Tabs>
 </div>

 <div className="grid max-w-5xl gap-3 border border-border p-3">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div className="max-w-[760px]">
 <div className="type-step-eyebrow">{optionalAnalysisStep}</div>
 <h2 className="mt-1 text-xl font-semibold leading-6 text-foreground">Optional analysis</h2>
 <HelpText className="mt-1.5">Post-trigger analysis is optional and stays tucked away until you need it.</HelpText>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <Label className="flex items-center gap-2 text-sm">
 <Checkbox checked={llmEnabled} onCheckedChange={(checked) => setLlmEnabled(Boolean(checked))} />
 Enable
 </Label>
 </div>
 </div>
 <>
 <div className="grid max-w-3xl gap-3 min-[900px]:grid-cols-[180px_180px_80px_90px_80px]">
 <div className="grid gap-2">
 <Select
 className="h-10 border border-input bg-background px-3 text-sm"
 disabled={!llmEnabled || !llmProviders.length}
 onChange={(event) => setLlmProvider(event.target.value as LlmProvider | "")}
 value={llmProvider}
 >
 <option value="">Select provider</option>
 {llmProviders.map((provider) => (
 <option disabled={!provider.has_api_key || !provider.is_enabled} key={provider.provider} value={provider.provider}>
 {provider.label}{provider.has_api_key && provider.is_enabled ? "" : " · configure key"}
 </option>
 ))}
 </Select>
 <HelpText>Uses the encrypted provider key from System Config.</HelpText>
 </div>
 <div className="grid gap-2">
 <Select
 className="h-10 border border-input bg-background px-3 text-sm"
 disabled={!llmEnabled || !selectedLlmModels.length}
 onChange={(event) => setLlmModelId(event.target.value)}
 value={llmModelId}
 >
 <option value="">Select model</option>
 {selectedLlmModels.map((model) => (
 <option key={model.id} value={model.model_id}>
 {model.label || model.model_id}
 </option>
 ))}
 </Select>
 <HelpText>Saved enabled models for the selected provider.</HelpText>
 </div>
 <div className="grid gap-2">
 <Input className="max-w-[96px]" disabled={!llmEnabled} onChange={(event) => setLlmTemperature(event.target.value)} placeholder="0.2" value={llmTemperature} />
 <HelpText>Temperature.</HelpText>
 </div>
 <div className="grid gap-2">
 <Input className="max-w-[110px]" disabled={!llmEnabled} onChange={(event) => setLlmMaxTokens(event.target.value)} placeholder="500" value={llmMaxTokens} />
 <HelpText>Max tokens.</HelpText>
 </div>
 <div className="grid gap-2">
 <Input className="max-w-[96px]" disabled={!llmEnabled} onChange={(event) => setLlmTimeout(event.target.value)} placeholder="25" value={llmTimeout} />
 <HelpText>Timeout sec.</HelpText>
 </div>
 </div>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="inline-flex border border-border p-1">
 <Button
 className={llmPromptTab === "prompt" ? "bg-secondary text-foreground" : "text-muted-foreground"}
 onClick={() => setLlmPromptTab("prompt")}
 size="sm"
 type="button"
 variant="ghost"
 >
 Prompt
 </Button>
 <Button
 className={llmPromptTab === "preview" ? "bg-secondary text-foreground" : "text-muted-foreground"}
 onClick={() => setLlmPromptTab("preview")}
 size="sm"
 type="button"
 variant="ghost"
 >
 Context Preview
 </Button>
 </div>
 <div className="flex flex-wrap gap-2">
 <Button disabled={isPending || !initialWorkflow?.id || !llmEnabled} onClick={previewLlmContext} size="sm" type="button" variant="secondary">Preview Context</Button>
 <Button disabled={isPending || !initialWorkflow?.id || !llmEnabled} onClick={testLlmAnalysis} size="sm" type="button" variant="secondary">Test LLM</Button>
 </div>
 </div>
 {llmPromptTab === "prompt" ? (
 <div className="relative" ref={llmPromptWrapRef}>
 <Textarea
 ref={llmPromptInputRef}
 className="min-h-[160px] w-full border border-input bg-background px-3 py-2 font-mono text-sm outline-none"
 disabled={!llmEnabled}
 onBlur={() => window.setTimeout(() => {
 setShowLlmSuggestions(false);
 setLlmSuggestionPosition(null);
 }, 120)}
 onChange={(event) => {
 setLlmPromptTemplate(event.target.value);
 updateLlmPromptAutocomplete(event.target.value, event.target.selectionStart ?? event.target.value.length, false, event.currentTarget);
 }}
 onClick={(event) => updateLlmPromptAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, false, event.currentTarget)}
 onKeyDown={(event) => {
 if (showLlmSuggestions && filteredLlmPlaceholders.length) {
 if (event.key === "ArrowDown") {
 event.preventDefault();
 setLlmSuggestionIndex((current) => (current + 1) % filteredLlmPlaceholders.length);
 return;
 }
 if (event.key === "ArrowUp") {
 event.preventDefault();
 setLlmSuggestionIndex((current) => (current - 1 + filteredLlmPlaceholders.length) % filteredLlmPlaceholders.length);
 return;
 }
 if (event.key === "Enter" || event.key === "Tab") {
 event.preventDefault();
 applyLlmSuggestion(filteredLlmPlaceholders[llmSuggestionIndex] ?? filteredLlmPlaceholders[0]);
 return;
 }
 if (event.key === "Escape") {
 event.preventDefault();
 setShowLlmSuggestions(false);
 setLlmSuggestionPosition(null);
 return;
 }
 }
 if ((event.ctrlKey || event.metaKey) && event.key === " ") {
 event.preventDefault();
 updateLlmPromptAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, true, event.currentTarget);
 }
 }}
 onKeyUp={(event) => {
 if ((event.ctrlKey || event.metaKey) && event.key === " ") return;
 if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
 updateLlmPromptAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, false, event.currentTarget);
 }}
 onScroll={(event) => {
 if (showLlmSuggestions) {
 updateLlmPromptAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, true, event.currentTarget);
 }
 }}
 onSelect={(event) => updateLlmPromptAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, false, event.currentTarget)}
 placeholder="Type @ for context placeholders"
 value={llmPromptTemplate}
 />
 {showLlmSuggestions && filteredLlmPlaceholders.length ? (
 <div
 className="absolute z-30 max-h-[220px] overflow-y-auto border border-border bg-background shadow-sm"
 style={{
 left: llmSuggestionPosition?.left ?? 0,
 top: llmSuggestionPosition?.top ?? "calc(100% + 4px)",
 width: llmSuggestionPosition?.width ?? "100%"
 }}
 >
 <div ref={llmSuggestionListRef}>
 {filteredLlmPlaceholders.map((item, index) => (
 <Button
 className={`block w-full border-b border-border px-3 py-2 text-left font-mono text-xs last:border-b-0 ${index === llmSuggestionIndex ? "bg-secondary text-foreground" : "hover:bg-[var(--accent-glow)]"}`}
 data-active={index === llmSuggestionIndex}
 key={item}
 onMouseDown={(event) => {
 event.preventDefault();
 applyLlmSuggestion(item);
 }}
 variant="ghost"
 type="button"
 >
 {item}
 </Button>
 ))}
 </div>
 </div>
 ) : null}
 <HelpText>Use `@` placeholders for symbol-scoped API context. Save the workflow before previewing or testing changes.</HelpText>
 </div>
 ) : (
 <div className="grid gap-3">
{llmFeedback ? <div className="type-body border border-border px-3 py-2 text-muted-foreground">{llmFeedback}</div> : null}
<pre className="type-meta max-h-[420px] overflow-auto border border-border bg-secondary/20 p-3">{llmDetails ? compactPreview(llmDetails) : "No context preview yet."}</pre>
 </div>
 )}
 </>
 </div>

 {!currentTemplatesMatchSuggestion ? (
 <div className="grid max-w-5xl gap-3 border border-border bg-secondary/20 p-3">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div className="max-w-[760px]">
 <div className="type-step-eyebrow">{reviewCopyStep}</div>
 <h2 className="mt-1 text-xl font-semibold leading-6 text-foreground">Review alert copy</h2>
 <HelpText className="mt-1.5">The conditions changed or the copy was manually edited. You can keep your current text, or replace it with a generated version that includes the active fields.</HelpText>
 </div>
 <Button
 onClick={() => {
 setTitleTemplate(suggestedCopy.title);
 setMessageTemplate(suggestedCopy.message);
 }}
 size="sm"
 type="button"
 >
 Use suggested copy
 </Button>
 </div>
 <div className="type-body grid gap-2 text-muted-foreground">
 <div><span className="font-semibold text-foreground">Title:</span> {suggestedCopy.title}</div>
 <div><span className="font-semibold text-foreground">Message:</span> {suggestedCopy.message}</div>
 </div>
 </div>
 ) : null}

 <div className="grid max-w-5xl gap-3 border border-border p-3">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div className="max-w-[760px]">
 <div className="type-step-eyebrow">{advancedDeploymentStep}</div>
 <h2 className="mt-1 text-xl font-semibold leading-6 text-foreground">Advanced script and deployment</h2>
 <HelpText className="mt-1.5">The script is optional. When present, it is validated by the sandboxed expression compiler and overrides the visual logic in the compiled workflow AST.</HelpText>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <div className="flex flex-wrap gap-2">
 <Button disabled={isPending || !initialWorkflow?.id} onClick={() => runEngineAction("validate")} size="sm" type="button" variant="secondary">Validate</Button>
 <Button disabled={isPending || !initialWorkflow?.id} onClick={() => runEngineAction("compile")} size="sm" type="button" variant="secondary">Compile</Button>
 <Button disabled={isPending || !initialWorkflow?.id} onClick={() => runEngineAction("explain")} size="sm" type="button" variant="secondary">Explain</Button>
 <Button disabled={isPending || !initialWorkflow?.id} onClick={() => runEngineAction("samples")} size="sm" type="button" variant="secondary">Samples</Button>
 <Button disabled={isPending || !initialWorkflow?.id} onClick={() => runEngineAction("deploy")} size="sm" type="button">Deploy</Button>
 </div>
 </div>
 </div>
 <>
 <div className="relative">
 <Textarea
 className="min-h-[120px] w-full border border-input bg-background px-3 py-2 font-mono text-sm outline-none"
 onBlur={() => window.setTimeout(() => setShowDslSuggestions(false), 120)}
 onChange={(event) => {
 setDslText(event.target.value);
 updateDslAutocomplete(event.target.value, event.target.selectionStart ?? event.target.value.length);
 }}
 onClick={(event) => updateDslAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
 onKeyDown={(event) => {
 if ((event.ctrlKey || event.metaKey) && event.key === " ") {
 event.preventDefault();
 updateDslAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, true);
 return;
 }
 if (event.key === "Tab") {
 if (showDslSuggestions && dslSuggestions[0]) {
 event.preventDefault();
 applyDslSuggestion(dslSuggestions[0]);
 return;
 }
 if (!dslText.trim() && suggestedDsl) {
 event.preventDefault();
 setDslText(suggestedDsl);
 }
 }
 }}
 onKeyUp={(event) => updateDslAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
 placeholder={suggestedDsl}
 value={dslText}
 />
 {showDslSuggestions && dslSuggestions.length ? (
 <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-72 overflow-y-auto border border-border bg-background shadow-lg">
 {dslSuggestions.map((item) => (
 <Button
 className="grid w-full gap-1 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-[var(--accent-glow)]"
 key={`${item.kind}:${item.value}`}
 onMouseDown={(event) => {
 event.preventDefault();
 applyDslSuggestion(item);
 }}
 variant="ghost"
 type="button"
 >
 <span className="font-mono font-bold">{item.label}</span>
 <span className="text-muted-foreground">{item.kind} - {item.description}</span>
 </Button>
 ))}
 </div>
 ) : null}
 </div>
 <div className="type-meta flex max-w-[820px] flex-wrap items-start justify-between gap-3 border border-border px-3 py-2">
 <div>
 <span className="font-bold uppercase">Generated from visual logic:</span>{" "}
 <code className="font-mono">{suggestedDsl}</code>
 </div>
 <Button onClick={() => setDslText(suggestedDsl)} size="sm" type="button" variant="secondary">Use generated script</Button>
 </div>
 <HelpText>Use Ctrl+Space for suggestions. Tab accepts the highlighted suggestion; when empty, Tab inserts the generated script from the visual rule builder.</HelpText>
 <div className="grid max-w-[820px] gap-3 min-[900px]:grid-cols-3">
 <div className="border border-border p-3">
 <div className="type-step-eyebrow">Deployment</div>
 <div className="type-body mt-2 text-muted-foreground">
 {(initialWorkflow?.deployment_status ?? "draft")} · version {initialWorkflow?.deploy_version ?? 0}
 </div>
 </div>
 <div className="border border-border p-3">
 <div className="type-step-eyebrow">Last validation</div>
 <div className="type-body mt-2 text-muted-foreground">{initialWorkflow?.last_validated_at ? new Date(initialWorkflow.last_validated_at).toLocaleString() : "-"}</div>
 </div>
 <div className="border border-border p-3">
 <div className="type-step-eyebrow">Runtime error</div>
 <div className="type-body mt-2 text-muted-foreground">{initialWorkflow?.last_runtime_error || "-"}</div>
 </div>
 </div>
 {engineFeedback ? <div className="type-body border border-border px-3 py-2 text-muted-foreground">{engineFeedback}</div> : null}
 {engineDetails ? <pre className="type-meta max-h-[260px] overflow-auto border border-border p-3">{compactPreview(engineDetails)}</pre> : null}
 </>
 </div>

 <div className="grid max-w-5xl gap-3 border border-border p-3">
 <div>
 <div className="type-step-eyebrow">{deliveryLifecycleStep}</div>
 <h2 className="mt-1 text-xl font-semibold leading-6 text-foreground">Delivery and lifecycle</h2>
 <HelpText className="mt-1.5">Choose where the alert goes, set the workflow state, and then save or test it.</HelpText>
 </div>
 <div className="grid gap-3 min-[860px]:grid-cols-[240px_minmax(0,1fr)]">
 <div className="grid gap-3">
 <div className="border border-border p-3">
 <SectionTitle className="mb-2">Workflow scope</SectionTitle>
 <HelpText>{targetScopeSummary(workflowTargetingPayload())}</HelpText>
 </div>
 <div className="border border-border p-3">
 <SectionTitle className="mb-2">Lifecycle</SectionTitle>
 <HelpText>Active workflows are evaluated by the alert worker. Inactive workflows stay saved but do not trigger.</HelpText>
 <Select className="mt-3 h-9 max-w-[220px] border border-input bg-background px-3 text-sm" onChange={(event) => setStatus(event.target.value as "active" | "inactive")} value={status}>
 <option value="active">Active</option>
 <option value="inactive">Inactive</option>
 </Select>
 </div>
 </div>
 <div className="border border-border p-3">
 <SectionTitle className="mb-2">Channels</SectionTitle>
 <HelpText>Choose where the alert should be delivered. Inherit defaults uses your channel settings page as the base.</HelpText>
 <div className="mt-3 grid gap-2 text-sm min-[560px]:grid-cols-2">
 <Label className="flex items-center gap-2" title="Always recommended so alerts remain visible inside the app."><Checkbox checked={channelInApp} onCheckedChange={(checked) => setChannelInApp(Boolean(checked))} />In-app</Label>
 <Label className="flex items-center gap-2" title="Send through your saved Discord webhook configuration."><Checkbox checked={channelDiscord} onCheckedChange={(checked) => setChannelDiscord(Boolean(checked))} />Discord</Label>
 <Label className="flex items-center gap-2" title="Send through your saved Telegram bot configuration."><Checkbox checked={channelTelegram} onCheckedChange={(checked) => setChannelTelegram(Boolean(checked))} />Telegram</Label>
 <Label className="flex items-center gap-2" title="When enabled, default channels from the alert channel settings page are included automatically."><Checkbox checked={inheritDefaults} onCheckedChange={(checked) => setInheritDefaults(Boolean(checked))} />Inherit defaults</Label>
 </div>
 </div>
 </div>

 <div className="flex flex-wrap gap-2 border-t border-border pt-3">
 <Button disabled={isPending} onClick={save} type="button">
 {isPending ? "Saving..." : initialWorkflow?.id ? "Save workflow" : "Create workflow"}
 </Button>
 {initialWorkflow?.id ? (
 <Button disabled={isPending} onClick={previewTest} type="button" variant="secondary">
 Evaluate current preview
 </Button>
 ) : null}
 {initialWorkflow?.id ? (
 <Button disabled={isPending} onClick={sendTestAlert} type="button" variant="secondary">
 Send test alert
 </Button>
 ) : null}
 {initialWorkflow?.id ? (
 <Button disabled={isPending} onClick={removeWorkflow} type="button" variant="destructive">
 Delete workflow
 </Button>
 ) : null}
 </div>
 {initialWorkflow?.id ? (
 <div className="type-help grid gap-1 border border-border px-3 py-2 text-muted-foreground">
 <div>`Evaluate current preview` checks the workflow conditions against the live preview tick shown above. It does not create an alert or notify any channel.</div>
 <div>`Send test alert` renders the current title and message templates with the preview payload and attempts delivery through the selected channels.</div>
 </div>
 ) : null}
 </div>
 </div>
 );
}

function LivePreviewSummary({
 symbol,
 exchange,
 preview
}: {
 symbol: string;
 exchange: string;
 preview: PreviewState;
}) {
 const quoteRaw = ((preview.quote?.detail as JsonObject | undefined)?.raw as JsonObject | undefined) ?? {};
 const depth = (quoteRaw.depth as JsonObject | undefined) ?? {};
 const buyDepth = Array.isArray(depth.buy) ? depth.buy.slice(0, 3) : [];
 const sellDepth = Array.isArray(depth.sell) ? depth.sell.slice(0, 3) : [];
 return (
 <div className="grid max-w-4xl gap-2 min-[720px]:grid-cols-4">
 <div className=" border border-border p-3">
 <div className="type-step-eyebrow">Quote</div>
 <div className="mt-2 text-xl font-bold">{preview.quote?.ltp ?? "-"}</div>
 <div className="type-meta mt-1">{symbol || "-"} - {exchange || "-"}</div>
 <div className="type-meta mt-3 grid gap-1">
 <div>Change: {String(quoteRaw.day_change ?? "-")}</div>
 <div>Change %: {String(quoteRaw.day_change_perc ?? "-")}</div>
 <div>Volume: {String(quoteRaw.volume ?? "-")}</div>
 <div>Open interest: {String(quoteRaw.open_interest ?? "-")}</div>
 </div>
 </div>
 <div className=" border border-border p-3">
 <div className="type-step-eyebrow">OHLC</div>
 <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
 <span>Open: {String(preview.ohlc?.open ?? "-")}</span>
 <span>High: {String(preview.ohlc?.high ?? "-")}</span>
 <span>Low: {String(preview.ohlc?.low ?? "-")}</span>
 <span>Close: {String(preview.ohlc?.close ?? "-")}</span>
 </div>
 <div className="type-meta mt-3 grid gap-1">
 <div>52w high: {String(quoteRaw.week_52_high ?? "-")}</div>
 <div>52w low: {String(quoteRaw.week_52_low ?? "-")}</div>
 </div>
 </div>
 <div className=" border border-border p-3">
 <div className="type-step-eyebrow">Market internals</div>
 <div className="type-meta mt-3 grid gap-1">
 <div>Total buy qty: {String(quoteRaw.total_buy_quantity ?? "-")}</div>
 <div>Total sell qty: {String(quoteRaw.total_sell_quantity ?? "-")}</div>
 <div>Last trade qty: {String(quoteRaw.last_trade_quantity ?? "-")}</div>
 <div>Last trade time: {String(quoteRaw.last_trade_time ?? "-")}</div>
 <div>Upper circuit: {String(quoteRaw.upper_circuit_limit ?? "-")}</div>
 <div>Lower circuit: {String(quoteRaw.lower_circuit_limit ?? "-")}</div>
 </div>
 </div>
 <div className=" border border-border p-3 min-[720px]:col-span-4">
 <div className="grid gap-3 min-[720px]:grid-cols-2">
 <div>
 <div className="type-step-eyebrow">Top bids</div>
 <div className="mt-2 grid gap-2">
 {buyDepth.map((row, index) => {
 const item = row as JsonObject;
 return (
 <div className="type-meta border border-border px-2 py-2" key={`buy-${index}`}>
 <div>Price: {String(item.price ?? "-")}</div>
 <div>Qty: {String(item.quantity ?? "-")}</div>
 <div>Orders: {String(item.orderCount ?? "-")}</div>
 </div>
 );
 })}
 {!buyDepth.length ? <div className="type-meta">No bid depth available.</div> : null}
 </div>
 </div>
 <div>
 <div className="type-step-eyebrow">Top asks</div>
 <div className="mt-2 grid gap-2">
 {sellDepth.map((row, index) => {
 const item = row as JsonObject;
 return (
 <div className="type-meta border border-border px-2 py-2" key={`sell-${index}`}>
 <div>Price: {String(item.price ?? "-")}</div>
 <div>Qty: {String(item.quantity ?? "-")}</div>
 <div>Orders: {String(item.orderCount ?? "-")}</div>
 </div>
 );
 })}
 {!sellDepth.length ? <div className="type-meta">No ask depth available.</div> : null}
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}

function SymbolQuoteTooltip({ loading, quote }: { loading: boolean; quote: QuoteResponse | null }) {
 const detail = (quote?.detail as JsonObject | undefined) ?? {};
 const raw = (detail.raw as JsonObject | undefined) ?? {};
 return (
 <div className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-64 border border-border bg-popover p-3 shadow-lg">
 {loading ? (
 <div className="type-meta">Loading live quote...</div>
 ) : quote ? (
 <div className="type-meta grid gap-2">
 <div className="flex items-center justify-between gap-4">
 <span className="font-mono font-bold">{quote.symbol ?? "Symbol"}</span>
 <span className="font-mono text-primary">{quote.ltp}</span>
 </div>
 <div className="grid grid-cols-2 gap-2 text-muted-foreground">
 <div>Change {String(raw.day_change_perc ?? raw.change_pct ?? "-")}</div>
 <div>Volume {String(raw.volume ?? "-")}</div>
 <div>OI {String(raw.open_interest ?? "-")}</div>
 <div>Last {String(raw.last_trade_time ?? "-")}</div>
 </div>
 </div>
 ) : (
 <div className="type-meta">No live quote available.</div>
 )}
 </div>
 );
}

function RuleEditor({
 addCondition,
 applyMessageField,
 combine,
 conditions,
 cooldownSeconds,
 filteredMessageFields,
 handleMessageTemplateKeyDown,
 level,
 messageFieldIndex,
 messageFieldListRef,
 messageFieldPosition,
 messageTemplate,
 messageInputRef,
 messageTemplateWrapRef,
 onMessageTemplateBlur,
 removeCondition,
 setCombine,
 setCooldownSeconds,
 setLevel,
 setTitleTemplate,
 showMessageFieldSuggestions,
 titleTemplate,
 updateMessageTemplate,
 updateCondition
}: {
 addCondition: () => void;
 applyMessageField: (field: string) => void;
 combine: "all" | "any";
 conditions: AlertCondition[];
 cooldownSeconds: string;
 filteredMessageFields: string[];
 handleMessageTemplateKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
 level: string;
 messageFieldIndex: number;
 messageFieldListRef: RefObject<HTMLDivElement | null>;
 messageFieldPosition: { top: number; left: number; width: number } | null;
 messageTemplate: string;
 messageInputRef: RefObject<HTMLTextAreaElement | null>;
 messageTemplateWrapRef: RefObject<HTMLDivElement | null>;
 onMessageTemplateBlur: () => void;
 removeCondition: (index: number) => void;
 setCombine: (value: "all" | "any") => void;
 setCooldownSeconds: (value: string) => void;
 setLevel: (value: string) => void;
 setTitleTemplate: (value: string) => void;
 showMessageFieldSuggestions: boolean;
 titleTemplate: string;
 updateMessageTemplate: (nextValue: string, caretPosition?: number, force?: boolean, textarea?: HTMLTextAreaElement) => void;
 updateCondition: (index: number, patch: Partial<AlertCondition>) => void;
}) {
 return (
 <div className="grid max-w-4xl gap-3">
 <div className="max-w-xl border border-border p-3">
 <SectionTitle className="mb-3">Trigger settings</SectionTitle>
 <div className="grid items-start gap-3 min-[760px]:grid-cols-[150px_120px_120px]">
 <div className="grid content-start self-start gap-2">
 <FieldLabel>Match mode</FieldLabel>
 <Select className="h-9 border border-input bg-background px-3 text-sm" onChange={(event) => setCombine(event.target.value as "all" | "any")} value={combine}>
 <option value="all">All conditions</option>
 <option value="any">Any condition</option>
 </Select>
 <HelpText>`All` means every condition must match. `Any` means one matching condition is enough.</HelpText>
 </div>
 <div className="grid content-start self-start gap-2">
 <FieldLabel>Cooldown</FieldLabel>
 <Input className="h-9 max-w-[120px] text-sm" onChange={(event) => setCooldownSeconds(event.target.value)} placeholder="Cooldown seconds" title="Minimum wait time before the same workflow can trigger again." value={cooldownSeconds} />
 <HelpText>Prevents repeated alerts on every tick after the first match.</HelpText>
 </div>
 <div className="grid content-start self-start gap-2">
 <FieldLabel>Level</FieldLabel>
 <Input className="h-9 max-w-[120px] text-sm" onChange={(event) => setLevel(event.target.value)} placeholder="Level" title="Examples: info, warning, critical." value={level} />
 <HelpText>Used only for display and downstream routing emphasis.</HelpText>
 </div>
 </div>
 </div>
 <div className="grid max-w-4xl gap-3">
 {conditions.map((condition, index) => (
 <div className="border border-border p-3" key={`${condition.field}-${index}`}>
 <ConditionEditor condition={condition} index={index} removeCondition={removeCondition} updateCondition={updateCondition} />
 </div>
 ))}
 </div>
 <Button className="max-w-[180px]" onClick={addCondition} type="button">Add condition</Button>
 <div className="max-w-4xl border border-border p-3">
 <SectionTitle className="mb-3">Alert content</SectionTitle>
 <div className="grid max-w-3xl gap-3">
 <div className="grid max-w-[260px] gap-2">
 <FieldLabel>Title template</FieldLabel>
 <Input className="h-9 text-sm" onChange={(event) => setTitleTemplate(event.target.value)} placeholder="Title template" value={titleTemplate} />
 <HelpText>Supports placeholders like {"{symbol}"} and {"{ltp}"}.</HelpText>
 </div>
 <div className="grid gap-2">
 <FieldLabel>Message template</FieldLabel>
 <div className="relative max-w-[720px]" ref={messageTemplateWrapRef}>
 <Textarea
 className="min-h-[84px] w-full border border-input bg-background px-3 py-2 text-sm outline-none"
 onBlur={onMessageTemplateBlur}
 onChange={(event) => updateMessageTemplate(event.target.value, event.target.selectionStart ?? undefined, false, event.currentTarget)}
 onClick={(event) => updateMessageTemplate(event.currentTarget.value, event.currentTarget.selectionStart ?? undefined, false, event.currentTarget)}
 onKeyDown={handleMessageTemplateKeyDown}
 onKeyUp={(event) => {
 if ((event.ctrlKey || event.metaKey) && event.key === " ") return;
 if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
 updateMessageTemplate(event.currentTarget.value, event.currentTarget.selectionStart ?? undefined, false, event.currentTarget);
 }}
 onScroll={(event) => {
 if (showMessageFieldSuggestions) {
 updateMessageTemplate(event.currentTarget.value, event.currentTarget.selectionStart ?? undefined, true, event.currentTarget);
 }
 }}
 onSelect={(event) => updateMessageTemplate(event.currentTarget.value, event.currentTarget.selectionStart ?? undefined, false, event.currentTarget)}
 placeholder="Message template"
 ref={messageInputRef}
 value={messageTemplate}
 />
 {showMessageFieldSuggestions && filteredMessageFields.length ? (
 <div
 className="absolute z-30 max-h-[220px] overflow-y-auto border border-border bg-background shadow-sm"
 style={{
 left: messageFieldPosition?.left ?? 0,
 top: messageFieldPosition?.top ?? "calc(100% + 4px)",
 width: messageFieldPosition?.width ?? "100%"
 }}
 >
 <div ref={messageFieldListRef}>
 {filteredMessageFields.map((field, index) => (
 <Button
 className={`block w-full border-b border-border px-3 py-2 text-left text-sm last:border-b-0 ${index === messageFieldIndex ? "bg-secondary text-foreground" : "hover:bg-[var(--accent-glow)]"}`}
 data-active={index === messageFieldIndex}
 key={field}
 onMouseDown={(event) => {
 event.preventDefault();
 applyMessageField(field);
 }}
 variant="ghost"
 type="button"
 >
 {`{${field}}`}
 </Button>
 ))}
 </div>
 </div>
 ) : null}
 </div>
 <HelpText>Type {"{"} to insert any supported live-data or computed field, including price, volume, open-interest, account, connection, and derived change fields.</HelpText>
 </div>
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
 <div className="grid max-w-4xl gap-3 min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_88px_minmax(0,0.9fr)_96px]">
 <div className="grid min-w-0 gap-2">
 <FieldLabel>Field</FieldLabel>
 <Select className="h-9 border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { field: event.target.value })} value={condition.field}>
 {fieldOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
 </Select>
 </div>
 <div className="grid min-w-0 gap-2">
 <FieldLabel>Operator</FieldLabel>
 <Select className="h-9 border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { operator: event.target.value })} value={condition.operator}>
 {operatorOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
 </Select>
 </div>
 <div className="grid min-w-0 gap-2">
 <FieldLabel>Value</FieldLabel>
 <Input className="h-9 text-sm" onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder="Value" value={String(condition.value ?? "")} />
 </div>
 <div className="grid min-w-0 gap-2">
 <FieldLabel>Compare to</FieldLabel>
 <Select className="h-9 border border-input bg-background px-3 text-sm" onChange={(event) => updateCondition(index, { compare_to: event.target.value || null })} value={condition.compare_to ?? ""}>
 {compareOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
 </Select>
 </div>
 <div className="grid min-w-0 gap-2">
 <FieldLabel>Action</FieldLabel>
 <Button className="w-full min-w-0" onClick={() => removeCondition(index)} type="button" variant="destructive">Remove</Button>
 </div>
 </div>
 <div className="grid gap-2 text-[13px] leading-5 text-muted-foreground min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_88px_minmax(0,0.9fr)_96px]">
 <div>{fieldMeta?.help}</div>
 <div>{operatorMeta?.help}</div>
 <div />
 <div>{compareMeta?.help}</div>
 <div />
 </div>
 </div>
 );
}
