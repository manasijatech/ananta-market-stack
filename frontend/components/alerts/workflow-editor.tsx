"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileJson, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type RefObject } from "react";
import { getDataOhlc, getDataQuotes, searchDefaultBrokerInstruments } from "@/service/actions/broker";
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
    previewAlertWorkflowLlmContext,
    sendWorkflowTestNotification,
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
    AlertWorkflow,
    AlertWorkflowDsl,
    EditorMode,
    InstrumentRef,
    AlertWorkflowTargeting
} from "@/service/types/alerts";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";
import type {
    BrokerAccount,
    InstrumentSearchRow,
    JsonObject,
    LlmProvider,
    LlmProviderConfig,
    QuoteResponse
} from "@/service/types/broker";
import type { Watchlist } from "@/service/types/watchlist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogPanel,
    DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Textarea } from "@/components/ui/textarea";
import { AlertLlmMarkdown } from "@/components/alerts/llm-output-markdown";
import { WorkflowAiChatPanel } from "@/components/alerts/workflow-ai-chat-panel";
import { LlmModelPicker } from "@/components/system/llm-model-picker";
import type { OpenRouterModel } from "@/service/actions/llm-models";
import { notifyAlphaCreditWarning } from "@/lib/alpha-credit-warning";
import { formatIstDateTime } from "@/lib/datetime";
import { formatMarketCap, formatMarketCapInCrores } from "@/lib/market-cap";
import { cn } from "@/lib/utils";

type EngineAction = "validate" | "compile" | "explain" | "samples" | "deploy";

function asArray<T>(value: T[] | null | undefined): T[] {
    return Array.isArray(value) ? value : [];
}

function normalizeEditorMode(mode: EditorMode | null | undefined): EditorMode {
    return mode === "graph" ? "rule" : (mode ?? "rule");
}

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
    {
        value: "open_interest",
        label: "Open interest",
        help: "Useful for derivatives and option-chain driven workflows."
    },
    {
        value: "previous_open_interest",
        label: "Previous open interest",
        help: "Previous open interest when available."
    },
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
    {
        value: "implied_volatility",
        label: "Implied volatility",
        help: "Implied volatility when available for derivatives."
    },
    { value: "market_cap", label: "Market cap", help: "Market capitalization when provided by the broker." }
];

const operatorOptions = [
    { value: "gt", label: "Greater than", help: "Trigger when the field becomes greater than the value." },
    { value: "gte", label: "Greater than or equal", help: "Trigger when the field reaches or exceeds the value." },
    { value: "lt", label: "Less than", help: "Trigger when the field becomes lower than the value." },
    { value: "lte", label: "Less than or equal", help: "Trigger when the field reaches or falls below the value." },
    {
        value: "crosses_above",
        label: "Crosses above",
        help: "Needs live updates. Triggers only when the field moves from below to above the value."
    },
    {
        value: "crosses_below",
        label: "Crosses below",
        help: "Needs live updates. Triggers only when the field moves from above to below the value."
    },
    {
        value: "pct_change_gte",
        label: "Percent change up",
        help: "Trigger when percent change versus a reference field reaches the value."
    },
    {
        value: "pct_change_lte",
        label: "Percent change down",
        help: "Trigger when percent change versus a reference field falls below the value."
    },
    {
        value: "rolling_pct_change_gte",
        label: "Rolling percent move up",
        help: "Trigger when percent change over a rolling window reaches the value."
    },
    {
        value: "rolling_pct_change_lte",
        label: "Rolling percent move down",
        help: "Trigger when percent change over a rolling window falls below the value."
    },
    {
        value: "abs_change_gte",
        label: "Absolute move up",
        help: "Trigger when absolute change versus a reference reaches the value."
    },
    {
        value: "abs_change_lte",
        label: "Absolute move down",
        help: "Trigger when absolute change versus a reference falls below the value."
    },
    {
        value: "rolling_abs_change_gte",
        label: "Rolling absolute move up",
        help: "Trigger when absolute change over a rolling window reaches the value."
    },
    {
        value: "rolling_abs_change_lte",
        label: "Rolling absolute move down",
        help: "Trigger when absolute change over a rolling window falls below the value."
    },
    {
        value: "rolling_volume_spike_gte",
        label: "Rolling volume spike",
        help: "Trigger when current volume is a multiple of its rolling baseline volume."
    },
    {
        value: "field_gt",
        label: "Field greater than field",
        help: "Compare the selected field to another same-tick field."
    },
    {
        value: "field_gte",
        label: "Field greater/equal field",
        help: "Compare the selected field to another same-tick field."
    },
    {
        value: "field_lt",
        label: "Field less than field",
        help: "Compare the selected field to another same-tick field."
    },
    {
        value: "field_lte",
        label: "Field less/equal field",
        help: "Compare the selected field to another same-tick field."
    },
    {
        value: "breaks_day_high",
        label: "Breaks day high",
        help: "Trigger when price reaches or breaks the current day high."
    },
    {
        value: "breaks_day_low",
        label: "Breaks day low",
        help: "Trigger when price reaches or breaks the current day low."
    },
    {
        value: "gap_up_pct_gte",
        label: "Gap up percent",
        help: "Trigger when the open gaps up versus previous close by the configured percent."
    },
    {
        value: "gap_down_pct_gte",
        label: "Gap down percent",
        help: "Trigger when the open gaps down versus previous close by the configured percent."
    },
    {
        value: "volume_spike",
        label: "Volume spike",
        help: "Trigger when volume is a multiple of the reference volume."
    },
    {
        value: "relative_volume_gte",
        label: "Relative volume",
        help: "Trigger when current volume is high versus average/reference volume."
    },
    {
        value: "oi_change_gte",
        label: "Open interest increase",
        help: "Trigger when open interest increases by at least the configured value."
    },
    {
        value: "oi_change_lte",
        label: "Open interest decrease",
        help: "Trigger when open interest decreases by at least the configured value."
    },
    {
        value: "oi_change_pct_gte",
        label: "Open interest percent increase",
        help: "Trigger when open interest increases by at least the configured percent."
    },
    {
        value: "oi_change_pct_lte",
        label: "Open interest percent decrease",
        help: "Trigger when open interest decreases by at least the configured percent."
    },
    {
        value: "spread_lte",
        label: "Spread below",
        help: "Trigger when top-of-book spread stays below an absolute, percent, or bps threshold."
    },
    {
        value: "bid_ask_imbalance_gte",
        label: "Bid/ask imbalance above",
        help: "Trigger when best bid quantity divided by best ask quantity reaches the threshold."
    },
    {
        value: "bid_ask_imbalance_lte",
        label: "Bid/ask imbalance below",
        help: "Trigger when best bid quantity divided by best ask quantity falls to the threshold."
    },
    {
        value: "total_buy_sell_ratio_gte",
        label: "Total buy/sell ratio above",
        help: "Trigger when total buy quantity divided by total sell quantity reaches the threshold."
    },
    {
        value: "total_buy_sell_ratio_lte",
        label: "Total buy/sell ratio below",
        help: "Trigger when total buy quantity divided by total sell quantity falls to the threshold."
    },
    {
        value: "always",
        label: "Always",
        help: "Always match. Useful for delivery testing or staged workflow construction."
    }
];

const compareOptions = [
    { value: "", label: "Manual value", help: "Use the numeric value box directly." },
    ...fieldOptions.map((item) => ({
        value: item.value,
        label: `Compare to ${item.label.toLowerCase()}`,
        help: item.help
    }))
];

const rollingBaselineOptions = [
    { value: "oldest", label: "Oldest sample" },
    { value: "nearest_window_start", label: "Nearest window start" },
    { value: "mean", label: "Mean" },
    { value: "median", label: "Median" },
    { value: "min", label: "Minimum" },
    { value: "max", label: "Maximum" }
];

const triggerModeOptions = [
    { value: "level", label: "While true" },
    { value: "rising_edge", label: "Only when it becomes true" },
    { value: "falling_edge", label: "Only when it becomes false" },
    { value: "every_match", label: "Every raw match" }
] as const;

const spreadUnitOptions = [
    { value: "absolute", label: "Absolute price" },
    { value: "percent", label: "Percent" },
    { value: "bps", label: "Basis points" }
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
const defaultMarketDataActivePeriod = {
    enabled: true,
    timezone: "Asia/Kolkata",
    days: ["mon", "tue", "wed", "thu", "fri"],
    sessions: [{ label: "Regular market", start: "09:15", end: "15:30" }],
    exchanges: [],
    exchange_types: [],
    segments: [],
    instrument_types: []
};
const defaultAlphaFeedActivePeriod = {
    enabled: true,
    timezone: "Asia/Kolkata",
    days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    sessions: [{ label: "Always active", start: "00:00", end: "23:59" }],
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

function activePeriodDefaults(workflowType: "market_data" | "alpha_feed") {
    return workflowType === "alpha_feed" ? defaultAlphaFeedActivePeriod : defaultMarketDataActivePeriod;
}

const fallbackLlmPrompt = `Analyze why this alert triggered for {symbol}.

Trigger: @trigger.reason
Trigger evidence: @trigger.evidence
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

type PreviewSnapshot = Pick<PreviewState, "quote" | "ohlc">;

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
    kind: "field" | "operator" | "function" | "placeholder" | "config";
};

function instrumentFromSearch(row: InstrumentSearchRow): InstrumentRef {
    return {
        symbol: row.symbol,
        exchange: row.exchange ?? null,
        zerodha_instrument_token: row.identifiers.zerodha_instrument_token
            ? Number(row.identifiers.zerodha_instrument_token)
            : null,
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

function stringValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type MarketCapPresetId = "all" | "small" | "mid" | "large" | "mega";

type MarketCapPreset = {
    id: MarketCapPresetId;
    label: string;
    min?: number;
    max?: number;
};

const MARKET_CAP_RANGE_MIN = 500;
const MARKET_CAP_RANGE_MAX = 2000000;
const MARKET_CAP_SLIDER_MIN = 0;
const MARKET_CAP_SLIDER_MAX = 10000;
const MARKET_CAP_SLIDER_STEP = 1;
const MARKET_CAP_PRESETS: MarketCapPreset[] = [
    { id: "all", label: "All" },
    { id: "small", label: "Small Cap", min: 500, max: 50000 },
    { id: "mid", label: "Mid Cap", min: 50000, max: 200000 },
    { id: "large", label: "Large Cap", min: 200000, max: 500000 },
    { id: "mega", label: "Mega Cap", min: 500000, max: 2000000 }
];
const MARKET_CAP_SLIDER_LABELS = ["500 Cr", "3K", "20K", "1L", "5L", "20L Cr"];

function clampMarketCapValue(value: number): number {
    return Math.max(MARKET_CAP_RANGE_MIN, Math.min(MARKET_CAP_RANGE_MAX, value));
}

function formatMarketCapRangeValue(value: number): string {
    return formatMarketCapInCrores(value);
}

function marketCapValueToPosition(value: number): number {
    const clamped = clampMarketCapValue(value);
    const logMin = Math.log(MARKET_CAP_RANGE_MIN);
    const logMax = Math.log(MARKET_CAP_RANGE_MAX);
    return (Math.log(clamped) - logMin) / (logMax - logMin);
}

function marketCapPositionToValue(position: number): number {
    const clampedPosition = Math.max(0, Math.min(1, position));
    const logMin = Math.log(MARKET_CAP_RANGE_MIN);
    const logMax = Math.log(MARKET_CAP_RANGE_MAX);
    const raw = Math.exp(logMin + clampedPosition * (logMax - logMin));
    return snapMarketCapValue(raw);
}

function snapMarketCapValue(value: number): number {
    const clamped = clampMarketCapValue(value);
    if (clamped < 12000) return Math.round(clamped / 10) * 10;
    if (clamped < 50000) return Math.round(clamped / 100) * 100;
    if (clamped < 200000) return Math.round(clamped / 500) * 500;
    if (clamped < 500000) return Math.round(clamped / 2000) * 2000;
    if (clamped < 1000000) return Math.round(clamped / 10000) * 10000;
    return Math.round(clamped / 20000) * 20000;
}

function marketCapValueToSliderValue(value: number): number {
    return Math.round(marketCapValueToPosition(value) * MARKET_CAP_SLIDER_MAX);
}

function marketCapSliderValueToValue(value: string): number {
    const parsedValue = Number(value);
    const sliderValue = Number.isFinite(parsedValue)
        ? Math.max(MARKET_CAP_SLIDER_MIN, Math.min(MARKET_CAP_SLIDER_MAX, parsedValue))
        : MARKET_CAP_SLIDER_MIN;
    return marketCapPositionToValue(sliderValue / MARKET_CAP_SLIDER_MAX);
}

function matchMarketCapPreset(minValue: number, maxValue: number): MarketCapPresetId | null {
    const preset = MARKET_CAP_PRESETS.find(
        (item) => item.id !== "all" && item.min === minValue && item.max === maxValue
    );
    return preset?.id ?? null;
}

function displayValue(value: unknown, fallback = "-"): string {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
}

function formatSignedNumber(value: unknown, maximumFractionDigits = 2): string | null {
    const next = numeric(value);
    if (next === null) return null;
    const formatted = new Intl.NumberFormat("en-IN", {
        maximumFractionDigits,
        minimumFractionDigits: next % 1 === 0 ? 0 : Math.min(2, maximumFractionDigits)
    }).format(Math.abs(next));
    return `${next >= 0 ? "+" : "-"}${formatted}`;
}

function formatDailyMove(change: unknown, changePct: unknown): string {
    const amount = formatSignedNumber(change);
    const percent = formatSignedNumber(changePct);
    if (!amount && !percent) return "-";
    const direction = (numeric(changePct) ?? numeric(change) ?? 0) >= 0 ? "↑" : "↓";
    if (amount && percent) return `${amount} (${percent.replace(/^[+]/, "")}%) ${direction} today`;
    if (amount) return `${amount} ${direction} today`;
    return `${percent}% ${direction} today`;
}

function isPositiveMove(change: unknown, changePct: unknown): boolean | null {
    const next = numeric(changePct) ?? numeric(change);
    return next === null ? null : next >= 0;
}

function previewKey(symbol?: string | null, exchange?: string | null): string {
    return `${(symbol ?? "").trim().toUpperCase()}:${(exchange ?? "").trim().toUpperCase()}`;
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

function metadataFromSearch(row: InstrumentSearchRow, metadata?: AlphaSymbolMetadata): Record<string, unknown> {
    return {
        company_name: metadata?.company_name ?? row.name ?? null,
        logo: metadata?.logo ?? null,
        sector: metadata?.sector ?? null,
        basic_industry: metadata?.basic_industry ?? null,
        industry: metadata?.industry ?? null,
        theme: metadata?.theme ?? null,
        market_cap: metadata?.market_cap ?? null,
        scrip_code: metadata?.scrip_code ?? null,
        trading_symbol: row.trading_symbol ?? null,
        instrument_type: row.instrument_type ?? null,
        segment: row.segment ?? null,
        account_label: row.account_label ?? null
    };
}

function targetEntryFromSearch(
    row: InstrumentSearchRow,
    exchange: string,
    metadata?: AlphaSymbolMetadata
): AlertTargetEntry | null {
    const entry = buildTargetEntry(row.symbol, exchange, instrumentFromSearch(row));
    if (!entry) return null;
    return {
        ...entry,
        label: metadata?.company_name ?? row.name ?? null,
        metadata: metadataFromSearch(row, metadata)
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
        next.push({
            ...normalized,
            label: entry.label ?? normalized.label,
            tags: entry.tags ?? normalized.tags,
            metadata: entry.metadata ?? normalized.metadata
        });
    }
    return next;
}

function targetDisplay(entry: AlertTargetEntry) {
    return [entry.symbol, entry.exchange].filter(Boolean).join(" · ");
}

function announcementCategoryLabel(category: string) {
    const normalized = category
        .replace(/^AnnouncementCategory\./, "")
        .replace(/_/g, " ")
        .trim();
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

const dslIdentifierConfigKeys = new Set(["baseline", "compare_to", "field", "reference_mode", "trigger_mode", "unit"]);
const conditionTopLevelDslKeys = new Set([
    "value",
    "compare_to",
    "field",
    "window_seconds",
    "hold_seconds",
    "occurrences",
    "occurrence_window_seconds",
    "trigger_mode"
]);

function dslKeywordValue(key: string, value: unknown): string {
    if (dslIdentifierConfigKeys.has(key) && typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        return value;
    }
    return dslValue(value);
}

function hasAdvancedConditionConfig(condition: AlertCondition): boolean {
    return Boolean(
        condition.window_seconds ||
            condition.hold_seconds ||
            condition.occurrences ||
            condition.occurrence_window_seconds ||
            (condition.trigger_mode && condition.trigger_mode !== "level") ||
            Object.keys(condition.config ?? {}).some((key) => !conditionTopLevelDslKeys.has(key))
    );
}

function conditionToDsl(condition: AlertCondition): string {
    if (condition.operator === "always") return "always()";
    const field = condition.field || "ltp";
    const value = dslValue(condition.value ?? 0);
    const compareTo = condition.compare_to || "";
    const simple = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as Record<string, string>;
    if (simple[condition.operator] && !hasAdvancedConditionConfig(condition)) {
        return `${field} ${simple[condition.operator]} ${value}`;
    }
    if (condition.operator.startsWith("field_") && compareTo && !hasAdvancedConditionConfig(condition)) {
        const symbol = { field_gt: ">", field_gte: ">=", field_lt: "<", field_lte: "<=" }[condition.operator] ?? ">";
        return `${field} ${symbol} ${compareTo}`;
    }
    const args = [field];
    if (condition.value !== null && condition.value !== undefined && condition.value !== "")
        args.push(`value=${value}`);
    if (compareTo) args.push(`compare_to=${compareTo}`);
    if (condition.window_seconds) args.push(`window_seconds=${condition.window_seconds}`);
    if (condition.hold_seconds) args.push(`hold_seconds=${condition.hold_seconds}`);
    if (condition.occurrences) args.push(`occurrences=${condition.occurrences}`);
    if (condition.occurrence_window_seconds) {
        args.push(`occurrence_window_seconds=${condition.occurrence_window_seconds}`);
    }
    if (condition.trigger_mode && condition.trigger_mode !== "level") {
        args.push(`trigger_mode=${condition.trigger_mode}`);
    }
    for (const [key, configValue] of Object.entries(condition.config ?? {}).sort(([left], [right]) =>
        left.localeCompare(right)
    )) {
        if (conditionTopLevelDslKeys.has(key) || configValue === null || configValue === undefined || configValue === "") {
            continue;
        }
        args.push(`${key}=${dslKeywordValue(key, configValue)}`);
    }
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
    const operator =
        operatorOptions.find((item) => item.value === condition.operator)?.label.toLowerCase() ?? condition.operator;
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

function logicNodeToConditions(
    node: unknown
): { combine: "all" | "any"; conditions: AlertCondition[]; flattened: boolean } | null {
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
                value:
                    typeof node.value === "string" || typeof node.value === "number" || typeof node.value === "boolean"
                        ? node.value
                        : isRecord(node.config) &&
                            (typeof node.config.value === "string" ||
                                typeof node.config.value === "number" ||
                                typeof node.config.value === "boolean")
                          ? node.config.value
                        : null,
                compare_to:
                    typeof node.compare_to === "string"
                        ? node.compare_to
                        : isRecord(node.config) && typeof node.config.compare_to === "string"
                          ? node.config.compare_to
                          : null,
                window_seconds:
                    typeof node.window_seconds === "number"
                        ? node.window_seconds
                        : isRecord(node.config) && typeof node.config.window_seconds === "number"
                          ? node.config.window_seconds
                          : null,
                hold_seconds:
                    typeof node.hold_seconds === "number"
                        ? node.hold_seconds
                        : isRecord(node.config) && typeof node.config.hold_seconds === "number"
                          ? node.config.hold_seconds
                          : null,
                occurrences:
                    typeof node.occurrences === "number"
                        ? node.occurrences
                        : isRecord(node.config) && typeof node.config.occurrences === "number"
                          ? node.config.occurrences
                          : null,
                occurrence_window_seconds:
                    typeof node.occurrence_window_seconds === "number"
                        ? node.occurrence_window_seconds
                        : isRecord(node.config) && typeof node.config.occurrence_window_seconds === "number"
                          ? node.config.occurrence_window_seconds
                          : null,
                trigger_mode:
                    node.trigger_mode === "level" ||
                    node.trigger_mode === "rising_edge" ||
                    node.trigger_mode === "falling_edge" ||
                    node.trigger_mode === "every_match"
                        ? node.trigger_mode
                        : isRecord(node.config) &&
                            (node.config.trigger_mode === "level" ||
                                node.config.trigger_mode === "rising_edge" ||
                                node.config.trigger_mode === "falling_edge" ||
                                node.config.trigger_mode === "every_match")
                          ? node.config.trigger_mode
                          : "level",
                config: isRecord(node.config)
                    ? Object.fromEntries(
                          Object.entries(node.config).filter(([key]) => !conditionTopLevelDslKeys.has(key))
                      )
                    : {}
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
        const config: Record<string, unknown> = {};
        for (const [index, arg] of args.entries()) {
            const equalsIndex = arg.indexOf("=");
            if (equalsIndex > 0) {
                const key = arg.slice(0, equalsIndex).trim();
                const value = parseDslLiteral(arg.slice(equalsIndex + 1));
                if (key === "value") condition.value = value;
                if (key === "compare_to") condition.compare_to = value;
                if (key === "field") condition.field = value;
                if (key === "window_seconds") condition.window_seconds = Number(value);
                if (key === "hold_seconds") condition.hold_seconds = Number(value);
                if (key === "occurrences") condition.occurrences = Number(value);
                if (key === "occurrence_window_seconds") condition.occurrence_window_seconds = Number(value);
                if (key === "trigger_mode") condition.trigger_mode = value;
                if (!conditionTopLevelDslKeys.has(key)) config[key] = value;
                continue;
            }
            if (index === 0) condition.field = arg.trim();
        }
        if (Object.keys(config).length) condition.config = config;
        if (!condition.field && name !== "always") condition.field = "ltp";
        return condition;
    }
    const compareMatch = expression.match(
        /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|>|<)\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)$/
    );
    if (compareMatch) {
        const [, field, symbol, rawRight] = compareMatch;
        const operatorMap: Record<string, string> = { ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" };
        const parsedRight = parseDslLiteral(rawRight);
        const isFieldCompare =
            typeof parsedRight === "string" && fieldOptions.some((item) => item.value === parsedRight);
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

const apiCreditPlaceholderNames = new Set(["news", "announcements", "earnings", "concalls"]);

function buildContextCreditReason(prompt: string) {
    const placeholders = parseLlmPromptPlaceholders(prompt);
    const apiPlaceholders = Array.from(
        new Set(
            placeholders
                .filter(
                    (placeholder) =>
                        typeof placeholder.name === "string" && apiCreditPlaceholderNames.has(placeholder.name)
                )
                .map((placeholder) => String(placeholder.raw))
        )
    );
    if (apiPlaceholders.length) {
        return `Reason: this prompt includes API-backed context placeholders (${apiPlaceholders.join(", ")}), so previewing has to fetch that context.`;
    }
    if (placeholders.length) {
        return `Reason: this prompt only shows local/runtime placeholders (${placeholders.map((placeholder) => String(placeholder.raw)).join(", ")}), so it should not spend Drishti API credits unless the saved workflow prompt is different.`;
    }
    return "Reason: this prompt does not include context placeholders, so it should not spend Drishti API credits unless the saved workflow prompt is different.";
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

function hasPositiveNumber(...values: unknown[]): boolean {
    return values.some((value) => {
        const next = numeric(value);
        return next !== null && next > 0;
    });
}

function isUsableQuote(quote: QuoteResponse | null): quote is QuoteResponse {
    if (!quote) return false;
    const detail = (quote.detail as JsonObject | undefined) ?? {};
    const raw = (detail.raw as JsonObject | undefined) ?? {};
    const rawOhlc = (raw.ohlc as JsonObject | undefined) ?? {};
    const depth = (raw.depth as JsonObject | undefined) ?? {};
    const hasDepth =
        (Array.isArray(depth.buy) && depth.buy.length > 0) || (Array.isArray(depth.sell) && depth.sell.length > 0);
    return (
        hasDepth ||
        hasPositiveNumber(
            quote.ltp,
            raw.last_price,
            raw.volume,
            raw.total_buy_quantity,
            raw.total_sell_quantity,
            raw.open,
            raw.high,
            raw.low,
            raw.close,
            rawOhlc.open,
            rawOhlc.high,
            rawOhlc.low,
            rawOhlc.close
        )
    );
}

function isUsableOhlc(row: JsonObject | null): row is JsonObject {
    if (!row) return false;
    const raw = (row.raw as JsonObject | undefined) ?? {};
    const rawOhlc = (raw.ohlc as JsonObject | undefined) ?? {};
    return hasPositiveNumber(
        row.open,
        row.high,
        row.low,
        row.close,
        raw.open,
        raw.high,
        raw.low,
        raw.close,
        rawOhlc.open,
        rawOhlc.high,
        rawOhlc.low,
        rawOhlc.close,
        raw.volume
    );
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
        const weekday = parts
            .find((part) => part.type === "weekday")
            ?.value.slice(0, 3)
            .toLowerCase();
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
        return targeting.preset_label || targeting.preset_id || "Watchlist universe";
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
    return remainder > 0
        ? `${entries.length} targets · ${preview} +${remainder} more`
        : `${entries.length} targets · ${preview}`;
}

function HelpText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={["text-[13px] leading-5 text-muted-foreground", className].filter(Boolean).join(" ")}>
            {children}
        </div>
    );
}

function FieldLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <span className={["text-sm font-semibold leading-5 text-foreground", className].filter(Boolean).join(" ")}>
            {children}
        </span>
    );
}

function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <h3 className={["text-base font-semibold leading-5 text-foreground", className].filter(Boolean).join(" ")}>
            {children}
        </h3>
    );
}

function StepHeader({
    step,
    title,
    description,
    action,
    className = "mb-4"
}: {
    step: string;
    title: string;
    description: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
            <div className="max-w-[760px]">
                <div className="type-step-eyebrow">{step}</div>
                <h2 className="mt-1 text-xl font-heading font-semibold leading-6 tracking-tight text-foreground">{title}</h2>
                <HelpText className="mt-1.5">{description}</HelpText>
            </div>
            {action}
        </div>
    );
}

export function WorkflowEditor({
    accounts: rawAccounts,
    announcementCategories: rawAnnouncementCategories = [],
    initialWorkflow,
    llmProviders: rawLlmProviders = [],
    openRouterModels: rawOpenRouterModels = [],
    presets: rawPresets = [],
    watchlists: rawWatchlists = []
}: {
    accounts?: BrokerAccount[];
    announcementCategories?: string[];
    initialWorkflow?: AlertWorkflow | null;
    llmProviders?: LlmProviderConfig[];
    openRouterModels?: OpenRouterModel[];
    presets?: Array<Record<string, unknown>>;
    watchlists?: Watchlist[];
}) {
    const router = useRouter();
    const accounts = asArray(rawAccounts);
    const announcementCategories = asArray(rawAnnouncementCategories);
    const llmProviders = asArray(rawLlmProviders);
    const openRouterModels = asArray(rawOpenRouterModels);
    const presets = asArray(rawPresets);
    const watchlists = asArray(rawWatchlists);
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [matchPreview, setMatchPreview] = useState("");
    const [chatWorkflow, setChatWorkflow] = useState<AlertWorkflow | null>(null);
    const [editorMode, setEditorMode] = useState<EditorMode>(normalizeEditorMode(initialWorkflow?.editor_mode));
    const initialWorkflowType = initialWorkflow?.workflow_dsl.workflow_type ?? "market_data";
    const [workflowType, setWorkflowType] = useState<"market_data" | "alpha_feed">(initialWorkflowType);
    const [name, setName] = useState(initialWorkflow?.name ?? "");
    const [description, setDescription] = useState(initialWorkflow?.description ?? "");
    const [accountId, setAccountId] = useState(initialWorkflow?.account_id ?? accounts[0]?.id ?? "");
    const [brokerCode, setBrokerCode] = useState(initialWorkflow?.broker_code ?? "");
    const [symbol, setSymbol] = useState(initialWorkflow?.symbol ?? "");
    const [symbolSearch, setSymbolSearch] = useState(initialWorkflow?.symbol ?? "");
    const [committedSymbolSearch, setCommittedSymbolSearch] = useState(initialWorkflow?.symbol ?? "");
    const [exchange, setExchange] = useState(initialWorkflow?.exchange ?? "NSE");
    const [instrumentRef, setInstrumentRef] = useState<InstrumentRef>(initialWorkflow?.instrument_ref ?? {});
    const initialTargeting = initialWorkflow?.workflow_dsl.targeting ?? {
        mode: "single_symbol",
        entries: initialWorkflow?.symbol
            ? [
                  buildTargetEntry(
                      initialWorkflow.symbol,
                      initialWorkflow.exchange ?? "NSE",
                      initialWorkflow.instrument_ref
                  )!
              ].filter(Boolean)
            : [],
        preset_id: null,
        preset_label: null,
        filters: {}
    };
    const initialAst = initialWorkflow?.workflow_dsl.workflow_ast as JsonObject | null | undefined;
    const initialUniverse = (initialAst?.target_universe as JsonObject | undefined) ?? {};
    const initialTargetMode =
        initialUniverse.kind && initialUniverse.kind !== "static_symbols" ? "preset_universe" : initialTargeting.mode;
    const [targetMode, setTargetMode] = useState<AlertWorkflowTargeting["mode"]>(
        initialTargetMode as AlertWorkflowTargeting["mode"]
    );
    const [selectedWatchlistId, setSelectedWatchlistId] = useState(
        String(initialUniverse.watchlist_id ?? watchlists[0]?.id ?? "")
    );
    const [targetEntries, setTargetEntries] = useState<AlertTargetEntry[]>(normalizeTargets(initialTargeting.entries));
    const [bulkTargets, setBulkTargets] = useState("");
    const initialEditableStatus = initialWorkflow?.status === "inactive" ? "inactive" : "active";
    const [status, setStatus] = useState<"active" | "inactive">(initialEditableStatus);
    const [combine, setCombine] = useState<"all" | "any">(initialWorkflow?.workflow_dsl.combine ?? "all");
    const [cooldownSeconds, setCooldownSeconds] = useState(
        String(initialWorkflow?.workflow_dsl.cooldown_seconds ?? 300)
    );
    const initialActivePeriodDefaults = activePeriodDefaults(initialWorkflowType);
    const initialActivePeriod = {
        ...initialActivePeriodDefaults,
        ...(initialWorkflow?.workflow_dsl.active_period ?? {})
    };
    const [activePeriodEnabled, setActivePeriodEnabled] = useState(initialActivePeriod.enabled);
    const [activeTimezone, setActiveTimezone] = useState(initialActivePeriod.timezone);
    const [activeDays, setActiveDays] = useState<string[]>(
        initialActivePeriod.days.length ? initialActivePeriod.days : initialActivePeriodDefaults.days
    );
    const [activeSessionLabel, setActiveSessionLabel] = useState(
        initialActivePeriod.sessions[0]?.label ?? "Regular market"
    );
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
    const [titleTemplate, setTitleTemplate] = useState(
        initialWorkflow?.workflow_dsl.notification.title_template ?? "{symbol} alert"
    );
    const [messageTemplate, setMessageTemplate] = useState(
        initialWorkflow?.workflow_dsl.notification.message_template ?? "{symbol} matched workflow"
    );
    const initialLlm = initialWorkflow?.workflow_dsl.llm_analysis;
    const enabledLlmProviders = llmProviders.filter((provider) => provider.has_api_key && provider.is_enabled);
    const firstLlmProvider = enabledLlmProviders[0];
    const firstLlmModel = firstLlmProvider?.models.find((model) => model.is_enabled);
    const [llmEnabled, setLlmEnabled] = useState(Boolean(initialLlm?.enabled));
    const [llmProvider, setLlmProvider] = useState<LlmProvider | "">(
        initialLlm?.provider ?? firstLlmProvider?.provider ?? ""
    );
    const [llmModelId, setLlmModelId] = useState(initialLlm?.model_id ?? firstLlmModel?.model_id ?? "");
    const [llmPromptTemplate, setLlmPromptTemplate] = useState(initialLlm?.prompt_template || fallbackLlmPrompt);
    const [llmTemperature, setLlmTemperature] = useState(String(initialLlm?.temperature ?? 0.2));
    const [llmMaxTokens, setLlmMaxTokens] = useState(String(initialLlm?.max_completion_tokens ?? 500));
    const [llmTimeout, setLlmTimeout] = useState(String(initialLlm?.timeout_seconds ?? 25));
    const initialFeedTrigger = initialWorkflow?.workflow_dsl.feed_trigger;
    const [feedProducts, setFeedProducts] = useState<string[]>(initialFeedTrigger?.products ?? ["news"]);
    const [feedAnnouncementCategories, setFeedAnnouncementCategories] = useState<string[]>(
        initialFeedTrigger?.announcement_categories ?? []
    );
    const [feedCategoryFilterEnabled, setFeedCategoryFilterEnabled] = useState(
        Boolean(initialFeedTrigger?.announcement_categories?.length)
    );
    const [feedIncludeRelatedCategories, setFeedIncludeRelatedCategories] = useState(
        initialFeedTrigger?.include_related_categories ?? true
    );
    const [feedCategoryQuery, setFeedCategoryQuery] = useState("");
    const [feedConditionPrompt, setFeedConditionPrompt] = useState(initialFeedTrigger?.condition_prompt ?? "");
    const [feedSourceScope, setFeedSourceScope] = useState(
        initialFeedTrigger?.source_scope ?? "current_alpha_subscription"
    );
    const [feedWatchlistIds, setFeedWatchlistIds] = useState<string[]>(initialFeedTrigger?.watchlist_ids ?? []);
    const [feedPresetIds, setFeedPresetIds] = useState<string[]>(initialFeedTrigger?.preset_ids ?? []);
    const [feedIncludeAllWatchlists, setFeedIncludeAllWatchlists] = useState(
        Boolean(initialFeedTrigger?.include_all_watchlists)
    );
    const [feedTriggerLlmEnabled, setFeedTriggerLlmEnabled] = useState(
        Boolean(initialFeedTrigger?.condition_prompt || initialFeedTrigger?.provider || initialFeedTrigger?.model_id)
    );
    const [feedProvider, setFeedProvider] = useState<LlmProvider | "">(initialFeedTrigger?.provider ?? "");
    const [feedModelId, setFeedModelId] = useState(initialFeedTrigger?.model_id ?? "");
    const [feedTemperature, setFeedTemperature] = useState(String(initialFeedTrigger?.temperature ?? 0.1));
    const [feedMaxTokens, setFeedMaxTokens] = useState(String(initialFeedTrigger?.max_completion_tokens ?? 400));
    const [feedTimeout, setFeedTimeout] = useState(String(initialFeedTrigger?.timeout_seconds ?? 25));
    const initialMarketCapFilter = initialWorkflow?.workflow_dsl.market_cap_filter;
    const [marketCapMode, setMarketCapMode] = useState<"all" | "custom">(initialMarketCapFilter?.mode ?? "all");
    const [marketCapMin, setMarketCapMin] = useState(
        initialMarketCapFilter?.min_value != null ? String(initialMarketCapFilter.min_value) : ""
    );
    const [marketCapMax, setMarketCapMax] = useState(
        initialMarketCapFilter?.max_value != null ? String(initialMarketCapFilter.max_value) : ""
    );
    const [llmPromptTab, setLlmPromptTab] = useState<"prompt" | "preview">("prompt");
    const [llmFeedback, setLlmFeedback] = useState("");
    const [llmDetails, setLlmDetails] = useState<Record<string, unknown> | null>(null);
    const [llmCreditAction, setLlmCreditAction] = useState<"preview" | "test" | null>(null);
    const [llmSuggestionQuery, setLlmSuggestionQuery] = useState("");
    const [llmSuggestionRange, setLlmSuggestionRange] = useState<{ start: number; end: number } | null>(null);
    const [llmSuggestionPosition, setLlmSuggestionPosition] = useState<{
        top: number;
        left: number;
        width: number;
    } | null>(null);
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
    const [runningEngineAction, setRunningEngineAction] = useState<EngineAction | null>(null);
    const [lastEngineAction, setLastEngineAction] = useState<EngineAction | null>(null);
    const [hoveredSymbolKey, setHoveredSymbolKey] = useState("");
    const [hoverQuote, setHoverQuote] = useState<QuoteResponse | null>(null);
    const [hoverQuoteLoading, setHoverQuoteLoading] = useState(false);
    const [conditionRegistry, setConditionRegistry] = useState<AlertConditionRegistry | null>(null);
    const [dslSuggestionQuery, setDslSuggestionQuery] = useState("");
    const [dslSuggestionRange, setDslSuggestionRange] = useState<{ start: number; end: number } | null>(null);
    const [showDslSuggestions, setShowDslSuggestions] = useState(false);
    const [inheritDefaults, setInheritDefaults] = useState(initialWorkflow?.channel_override?.inherit_defaults ?? true);
    const [channelInApp, setChannelInApp] = useState(
        initialWorkflow?.workflow_dsl.channels.enabled.includes("in_app") ?? true
    );
    const [channelDiscord, setChannelDiscord] = useState(
        initialWorkflow?.workflow_dsl.channels.enabled.includes("discord") ?? false
    );
    const [channelTelegram, setChannelTelegram] = useState(
        initialWorkflow?.workflow_dsl.channels.enabled.includes("telegram") ?? false
    );
    const [channelDesktopAudio, setChannelDesktopAudio] = useState(
        initialWorkflow?.workflow_dsl.channels.enabled.includes("desktop_audio") ?? false
    );
    const [suggestions, setSuggestions] = useState<InstrumentSearchRow[]>([]);
    const [suggestionMetadata, setSuggestionMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [selectedSymbolMetadata, setSelectedSymbolMetadata] = useState<AlphaSymbolMetadata | null>(null);
    const [targetMetadata, setTargetMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [universeMetadata, setUniverseMetadata] = useState<Record<string, AlphaSymbolMetadata>>({});
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedSearchLabel, setSelectedSearchLabel] = useState("");
    const [preview, setPreview] = useState<PreviewState>({ quote: null, ohlc: null, loading: false, error: "" });
    const [previewDataKey, setPreviewDataKey] = useState("");
    const [previewMode, setPreviewMode] = useState<"summary" | "raw">("summary");
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [messageFieldQuery, setMessageFieldQuery] = useState("");
    const [messageFieldPosition, setMessageFieldPosition] = useState<{
        top: number;
        left: number;
        width: number;
    } | null>(null);
    const [messageFieldIndex, setMessageFieldIndex] = useState(0);
    const [showMessageFieldSuggestions, setShowMessageFieldSuggestions] = useState(false);
    const symbolWrapRef = useRef<HTMLDivElement | null>(null);
    const previewCacheRef = useRef<Record<string, PreviewSnapshot>>({});
    const messageTemplateWrapRef = useRef<HTMLDivElement | null>(null);
    const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
    const messageFieldListRef = useRef<HTMLDivElement | null>(null);
    const llmPromptWrapRef = useRef<HTMLDivElement | null>(null);
    const llmPromptInputRef = useRef<HTMLTextAreaElement | null>(null);
    const llmSuggestionListRef = useRef<HTMLDivElement | null>(null);
    const suppressLlmAutocompleteRef = useRef(false);
    const suppressMessageAutocompleteRef = useRef(false);

    const persistedWorkflow = chatWorkflow ?? initialWorkflow ?? null;
    const persistedWorkflowId = persistedWorkflow?.id ?? "";
    const selectedAccount = accounts.find((item) => item.id === accountId);
    const selectedWatchlist = watchlists.find((item) => item.id === selectedWatchlistId) ?? null;
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
            ...Array.from(
                new Map(
                    (conditionRegistry?.operators ?? [])
                        .flatMap((item) => item.config_fields ?? [])
                        .map((item) => [item.name, item] as const)
                ).values()
            ).map((item) => ({
                value: `${item.name}=`,
                label: `${item.name}=`,
                description: item.description || "Operator configuration parameter.",
                kind: "config" as const
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
            .filter(
                (item) => !query || item.label.toLowerCase().includes(query) || item.value.toLowerCase().includes(query)
            )
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
        return {
            kind: "watchlist",
            watchlist_id: selectedWatchlistId,
            label: selectedWatchlist?.name ?? selectedWatchlistId
        };
    }, [selectedWatchlist?.name, selectedWatchlistId]);
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
            return [
                {
                    symbol: symbol.trim().toUpperCase(),
                    exchange,
                    instrument_ref: activeInstrument,
                    source_type: "single_symbol"
                }
            ];
        }
        if (targetMode !== "preset_universe") return [];
        return (selectedWatchlist?.items ?? []).map((item) => ({
            symbol: item.symbol,
            exchange: item.exchange,
            instrument_ref: item.instrument_ref,
            source_label: selectedWatchlist?.name,
            source_type: "watchlist"
        }));
    }, [activeInstrument, exchange, selectedWatchlist, symbol, targetEntries, targetMode]);
    const universeSymbolKey = useMemo(
        () =>
            universeSymbols
                .map((item) => item.symbol.trim().toUpperCase())
                .filter(Boolean)
                .sort()
                .join("|"),
        [universeSymbols]
    );
    const previewTargetKey = previewKey(symbol, exchange);
    const hasCurrentPreview = Boolean(
        activeInstrument.symbol && previewDataKey === previewTargetKey && (preview.quote || preview.ohlc)
    );

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
        function handlePointerDown(event: MouseEvent) {
            if (symbolWrapRef.current && !symbolWrapRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        }
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, []);

    useEffect(() => {
        if (
            symbolSearch.trim().length < 1 ||
            symbolSearch.trim().toUpperCase() === committedSymbolSearch.trim().toUpperCase()
        ) {
            setSuggestions([]);
            setSuggestionMetadata({});
            setActiveSuggestionIndex(-1);
            return;
        }
        let cancelled = false;
        const handle = window.setTimeout(() => {
            setSearchLoading(true);
            startTransition(async () => {
                try {
                    const result = await searchDefaultBrokerInstruments({
                        q: symbolSearch.trim(),
                        exchange: exchange.trim() || undefined,
                        limit: 20
                    });
                    if (cancelled) return;
                    setSuggestions(result);
                    setActiveSuggestionIndex(result.length ? 0 : -1);
                    setShowSuggestions(true);
                    const symbols = Array.from(
                        new Set(result.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))
                    ).slice(0, 20);
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
                    } catch (caught) {
                        notifyAlphaCreditWarning(caught);
                        if (!cancelled) setSuggestionMetadata({});
                    }
                } catch {
                    if (cancelled) return;
                    setSuggestions([]);
                    setSuggestionMetadata({});
                    setActiveSuggestionIndex(-1);
                } finally {
                    if (!cancelled) setSearchLoading(false);
                }
            });
        }, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [committedSymbolSearch, exchange, startTransition, symbolSearch]);

    useEffect(() => {
        const symbols = Array.from(
            new Set(targetEntries.map((entry) => entry.symbol.trim().toUpperCase()).filter(Boolean))
        );
        if (!symbols.length) {
            setTargetMetadata({});
            return;
        }
        let cancelled = false;
        startTransition(async () => {
            try {
                const metadata = await getAlphaSymbolMetadata(symbols);
                if (cancelled) return;
                setTargetMetadata(
                    metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
                        acc[item.symbol.trim().toUpperCase()] = item;
                        return acc;
                    }, {})
                );
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                if (!cancelled) setTargetMetadata({});
            }
        });
        return () => {
            cancelled = true;
        };
    }, [startTransition, targetEntries]);

    useEffect(() => {
        const symbols = universeSymbolKey ? universeSymbolKey.split("|") : [];
        if (!symbols.length) {
            setUniverseMetadata({});
            return;
        }
        let cancelled = false;
        startTransition(async () => {
            try {
                const metadata = await getAlphaSymbolMetadata(symbols.slice(0, 80));
                if (cancelled) return;
                setUniverseMetadata(
                    metadata.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
                        acc[item.symbol.trim().toUpperCase()] = item;
                        return acc;
                    }, {})
                );
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                if (!cancelled) setUniverseMetadata({});
            }
        });
        return () => {
            cancelled = true;
        };
    }, [startTransition, universeSymbolKey]);

    useEffect(() => {
        const selectedSymbol = symbol.trim().toUpperCase();
        if (!selectedSymbol) {
            setSelectedSymbolMetadata(null);
            return;
        }
        const suggestedMetadata = suggestionMetadata[selectedSymbol];
        if (suggestedMetadata) {
            setSelectedSymbolMetadata(suggestedMetadata);
            return;
        }
        let cancelled = false;
        startTransition(async () => {
            try {
                const [metadata] = await getAlphaSymbolMetadata([selectedSymbol]);
                if (!cancelled) setSelectedSymbolMetadata(metadata ?? null);
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                if (!cancelled) setSelectedSymbolMetadata(null);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [startTransition, suggestionMetadata, symbol]);

    useEffect(() => {
        const account = selectedAccount;
        if (!account || !activeInstrument.symbol) {
            setPreview({ quote: null, ohlc: null, loading: false, error: "" });
            setPreviewDataKey("");
            return;
        }
        if (!livePreviewAllowed) {
            setPreview({
                quote: null,
                ohlc: null,
                loading: false,
                error: "Live broker preview is paused outside this workflow's active market period."
            });
            setPreviewDataKey("");
            return;
        }
        const accountIdForFetch = account.id;
        const requestedKey = previewKey(activeInstrument.symbol, activeInstrument.exchange ?? exchange);
        let cancelled = false;
        async function load(replace = false) {
            const cached = previewCacheRef.current[requestedKey];
            if (replace && cached) {
                setPreview({ ...cached, loading: true, error: "" });
                setPreviewDataKey(requestedKey);
            } else if (replace && !cached) {
                setPreview({ quote: null, ohlc: null, loading: true, error: "" });
            } else {
                setPreview((current) => ({ ...current, loading: false, error: "" }));
            }
            try {
                const [quotes, ohlcRows] = await Promise.all([
                    getDataQuotes(accountIdForFetch, { instruments: [activeInstrument] }),
                    getDataOhlc(accountIdForFetch, { instruments: [activeInstrument] })
                ]);
                if (cancelled) return;
                const nextQuote = quotes[0] ?? null;
                const nextOhlc = (ohlcRows[0] as JsonObject | undefined) ?? null;
                const usableQuote = isUsableQuote(nextQuote);
                const usableOhlc = isUsableOhlc(nextOhlc);
                const nextSnapshot = {
                    quote: usableQuote ? nextQuote : null,
                    ohlc: usableOhlc ? nextOhlc : null
                };
                if (nextSnapshot.quote || nextSnapshot.ohlc) {
                    previewCacheRef.current = { ...previewCacheRef.current, [requestedKey]: nextSnapshot };
                    setPreviewDataKey(requestedKey);
                    setPreview({
                        ...nextSnapshot,
                        loading: false,
                        error: ""
                    });
                } else {
                    setPreview((current) => ({
                        ...current,
                        loading: false,
                        error: ""
                    }));
                }
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                if (cancelled) return;
                setPreview((current) => ({
                    ...current,
                    loading: false,
                    error: caught instanceof Error ? caught.message : "Could not fetch live preview."
                }));
            }
        }
        void load(true);
        const timer = window.setInterval(() => void load(false), 2000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [activeInstrument, exchange, livePreviewAllowed, selectedAccount]);

    function loadPreviewNow(instrument: InstrumentRef) {
        const account = selectedAccount;
        if (!account || !instrument.symbol || !livePreviewAllowed) {
            setPreview({ quote: null, ohlc: null, loading: false, error: "" });
            setPreviewDataKey("");
            return;
        }
        const requestedInstrument = {
            ...instrument,
            symbol: instrument.symbol,
            exchange: instrument.exchange ?? exchange
        };
        const requestedKey = previewKey(requestedInstrument.symbol, requestedInstrument.exchange);
        const cached = previewCacheRef.current[requestedKey];
        if (cached) {
            setPreview({ ...cached, loading: true, error: "" });
            setPreviewDataKey(requestedKey);
        } else {
            setPreview({ quote: null, ohlc: null, loading: true, error: "" });
        }
        startTransition(async () => {
            try {
                const [quotes, ohlcRows] = await Promise.all([
                    getDataQuotes(account.id, { instruments: [requestedInstrument] }),
                    getDataOhlc(account.id, { instruments: [requestedInstrument] })
                ]);
                const nextQuote = quotes[0] ?? null;
                const nextOhlc = (ohlcRows[0] as JsonObject | undefined) ?? null;
                const nextSnapshot = {
                    quote: isUsableQuote(nextQuote) ? nextQuote : null,
                    ohlc: isUsableOhlc(nextOhlc) ? nextOhlc : null
                };
                if (nextSnapshot.quote || nextSnapshot.ohlc) {
                    previewCacheRef.current = { ...previewCacheRef.current, [requestedKey]: nextSnapshot };
                    setPreviewDataKey(requestedKey);
                    setPreview({
                        ...nextSnapshot,
                        loading: false,
                        error: ""
                    });
                } else {
                    setPreview((current) => ({ ...current, loading: false, error: "" }));
                }
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                setPreview((current) => ({
                    ...current,
                    loading: false,
                    error: caught instanceof Error ? caught.message : "Could not fetch live preview."
                }));
            }
        });
    }

    useEffect(() => {
        if (targetMode === "symbol_list") {
            if (!targetEntries.length) {
                if (symbol || Object.keys(instrumentRef).length) {
                    setSymbol("");
                    setInstrumentRef({});
                    setSelectedSearchLabel("");
                    setSymbolSearch("");
                    setCommittedSymbolSearch("");
                }
                return;
            }
            const selectedStillExists = targetEntries.some(
                (entry) => `${entry.symbol}:${entry.exchange ?? ""}` === previewTargetKey
            );
            if (!selectedStillExists) {
                const [firstTarget] = targetEntries;
                setSymbol(firstTarget.symbol);
                setExchange(firstTarget.exchange ?? "NSE");
                setInstrumentRef(firstTarget.instrument_ref);
                setSelectedSearchLabel(targetDisplay(firstTarget));
                setSymbolSearch("");
                setCommittedSymbolSearch("");
                setCommittedSymbolSearch("");
            }
            return;
        }

        if (targetMode === "preset_universe") {
            if (!universeSymbols.length) {
                if (symbol || Object.keys(instrumentRef).length) {
                    setSymbol("");
                    setInstrumentRef({});
                    setSelectedSearchLabel("");
                    setSymbolSearch("");
                    setCommittedSymbolSearch("");
                }
                return;
            }
            const selectedStillExists = universeSymbols.some(
                (item) => `${item.symbol}:${item.exchange ?? ""}` === previewTargetKey
            );
            if (!selectedStillExists) {
                const [firstSymbol] = universeSymbols;
                setSymbol(firstSymbol.symbol);
                setExchange(firstSymbol.exchange ?? "NSE");
                setInstrumentRef({
                    ...(firstSymbol.instrument_ref ?? {}),
                    symbol: firstSymbol.symbol,
                    exchange: firstSymbol.exchange ?? "NSE"
                });
                setSelectedSearchLabel([firstSymbol.symbol, firstSymbol.exchange].filter(Boolean).join(" · "));
                setSymbolSearch("");
                setCommittedSymbolSearch("");
            }
        }
    }, [instrumentRef, previewTargetKey, symbol, targetEntries, targetMode, universeSymbols]);

    function selectSuggestion(row: InstrumentSearchRow) {
        const nextExchange = row.exchange ?? exchange;
        const nextInstrument = instrumentFromSearch(row);
        const metadata = suggestionMetadata[row.symbol.trim().toUpperCase()];
        if (targetMode === "symbol_list") {
            const entry = targetEntryFromSearch(row, nextExchange, metadata);
            if (entry) {
                setTargetEntries((current) => normalizeTargets([...current, entry]));
                setSymbol(entry.symbol);
                setInstrumentRef(entry.instrument_ref);
                setSelectedSearchLabel(targetDisplay(entry));
                setSymbolSearch("");
                setCommittedSymbolSearch("");
                loadPreviewNow(entry.instrument_ref);
            }
        } else {
            setSymbol(row.symbol);
            setSymbolSearch(row.symbol);
            setCommittedSymbolSearch(row.symbol);
            setInstrumentRef(nextInstrument);
            setSelectedSearchLabel(
                [row.symbol, metadata?.company_name ?? row.name, row.exchange, row.instrument_type]
                    .filter(Boolean)
                    .join(" · ")
            );
            loadPreviewNow({ ...nextInstrument, symbol: row.symbol, exchange: nextExchange });
        }
        setExchange(nextExchange);
        setSuggestions([]);
        setActiveSuggestionIndex(-1);
        setShowSuggestions(false);
    }

    function handleSymbolSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") {
            setShowSuggestions(false);
            return;
        }
        if (!suggestions.length) {
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setShowSuggestions(true);
            setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setShowSuggestions(true);
            setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const row = suggestions[Math.max(activeSuggestionIndex, 0)];
            if (row) selectSuggestion(row);
        }
    }

    function clearScriptIfVisualLogicChanged(nextCombine: "all" | "any", nextConditions: AlertCondition[]) {
        const nextDsl = conditionsToDsl(nextCombine, nextConditions);
        if (dslText.trim() && dslText.trim() !== nextDsl) {
            setDslText("");
            setEngineFeedback(
                "Advanced script cleared because the visual conditions were edited. The saved workflow will now use the visible rule builder."
            );
        }
    }

    function updateCombine(nextCombine: "all" | "any") {
        clearScriptIfVisualLogicChanged(nextCombine, conditions);
        setCombine(nextCombine);
    }

    function updateCondition(index: number, patch: Partial<AlertCondition>) {
        const nextConditions = conditions.map((item, itemIndex) =>
            itemIndex === index ? { ...item, ...patch } : item
        );
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
            channelTelegram ? "telegram" : null,
            channelDesktopAudio ? "desktop_audio" : null
        ].filter(Boolean) as AlertChannelType[];
        return {
            inherit_defaults: inheritDefaults,
            enabled: enabled.length ? enabled : ["in_app"]
        };
    }

    function toggleActiveDay(day: string, checked: boolean) {
        setActiveDays((current) =>
            checked ? Array.from(new Set([...current, day])) : current.filter((item) => item !== day)
        );
    }

    function applyActivePeriodDefaults(nextType: "market_data" | "alpha_feed") {
        const defaults = activePeriodDefaults(nextType);
        setActivePeriodEnabled(defaults.enabled);
        setActiveTimezone(defaults.timezone);
        setActiveDays(defaults.days);
        setActiveSessionLabel(defaults.sessions[0]?.label ?? "Regular market");
        setActiveSessionStart(defaults.sessions[0]?.start ?? "09:15");
        setActiveSessionEnd(defaults.sessions[0]?.end ?? "15:30");
        setActiveExchanges(listCsv(defaults.exchanges));
        setActiveExchangeTypes(listCsv(defaults.exchange_types));
        setActiveSegments(listCsv(defaults.segments));
        setActiveInstrumentTypes(listCsv(defaults.instrument_types));
        setShowAdvancedMarketScope(false);
    }

    function marketCapFilterPayload() {
        const minValue = numeric(marketCapMin);
        const maxValue = numeric(marketCapMax);
        if (marketCapMode !== "custom") {
            return {
                mode: "all" as const,
                min_value: null,
                max_value: null
            };
        }
        return {
            mode: "custom" as const,
            min_value: minValue,
            max_value: maxValue
        };
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
                channels: channelSelection(),
                market_cap_filter: marketCapFilterPayload()
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
            channels: channelSelection(),
            market_cap_filter: marketCapFilterPayload()
        };
    }

    function llmAnalysisPayload(): AlertWorkflowDsl["llm_analysis"] {
        return {
            enabled: llmEnabled,
            provider: llmProvider || null,
            model_id: llmModelId || null,
            prompt_template: llmPromptTemplate,
            context_placeholders: parseLlmPromptPlaceholders(llmPromptTemplate),
            temperature: Number(llmTemperature || 0.2),
            max_completion_tokens: Number(llmMaxTokens || 500),
            timeout_seconds: Number(llmTimeout || 25)
        };
    }

    function workflowPayload() {
        const targeting = workflowTargetingPayload();
        const primaryTarget = targeting.entries[0];
        let effectiveConditions =
            workflowType === "alpha_feed" ? [{ operator: "always", field: "event" }] : conditions;
        let effectiveCombine = combine;
        let effectiveWorkflowAst = workflowAstPayload(targeting, effectiveConditions) as Record<string, unknown>;
        if (workflowType !== "alpha_feed" && dslText.trim()) {
            const parsedAst = compileLocalDslToAst(
                dslText,
                effectiveWorkflowAst as unknown as Record<string, unknown>
            );
            const parsedLogic = parsedAst ? logicNodeToConditions(parsedAst.logic) : null;
            if (parsedAst) {
                effectiveWorkflowAst = parsedAst;
            }
            if (parsedLogic) {
                effectiveCombine = parsedLogic.combine;
                if (parsedLogic.conditions.length) {
                    effectiveConditions = parsedLogic.conditions;
                }
            }
        }
        const workflowDsl: AlertWorkflowDsl = {
            version: 2,
            workflow_type: workflowType,
            combine: effectiveCombine,
            cooldown_seconds: Number(cooldownSeconds || 0),
            conditions: effectiveConditions,
            targeting,
            notification: {
                level,
                title_template: titleTemplate,
                message_template: messageTemplate
            },
            channels: channelSelection(),
            llm_analysis: llmAnalysisPayload(),
            feed_trigger: {
                enabled: workflowType === "alpha_feed",
                products: feedProducts as AlertWorkflowDsl["feed_trigger"]["products"],
                announcement_categories:
                    announcementsEnabled && feedCategoryFilterEnabled ? feedAnnouncementCategories : [],
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
            market_cap_filter: marketCapFilterPayload(),
            active_period: {
                enabled: activePeriodEnabled,
                timezone: activeTimezone.trim() || "Asia/Kolkata",
                days: activeDays.length ? activeDays : activePeriodDefaults(workflowType).days,
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
            workflow_ast: effectiveWorkflowAst,
            validation_status: "unknown",
            compiled_summary: {}
        };

        return {
            template_id: chatWorkflow?.template_id ?? initialWorkflow?.template_id ?? null,
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

    function updateMessageTemplate(
        nextValue: string,
        caretPosition?: number,
        force = false,
        textarea?: HTMLTextAreaElement
    ) {
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
        if (input && (force || (openIndex >= 0 && openIndex > closeIndex))) {
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
            const query = beforeCursor
                .slice(openIndex + 1)
                .trim()
                .toLowerCase();
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
                setMessageFieldIndex(
                    (current) => (current - 1 + filteredMessageFields.length) % filteredMessageFields.length
                );
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
            updateMessageTemplate(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                true,
                event.currentTarget
            );
        }
    }

    function updateLlmPromptAutocomplete(
        nextValue: string,
        caretPosition: number,
        force = false,
        textarea?: HTMLTextAreaElement
    ) {
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
            setEngineFeedback(
                "Script compiled. The visual builder was updated with supported conditions; nested or inverted groups remain represented by the script."
            );
        } else {
            setEngineFeedback("Script compiled and the visual rule builder was updated.");
        }
        return true;
    }

    function applyWorkflowToEditor(workflow: AlertWorkflow) {
        const dsl = workflow.workflow_dsl;
        const ast = dsl.workflow_ast as JsonObject | null | undefined;
        const targetUniverse = (ast?.target_universe as JsonObject | undefined) ?? {};
        const targeting = dsl.targeting;
        const astSymbols = Array.isArray(targetUniverse.symbols) ? targetUniverse.symbols : [];
        const astEntries = normalizeTargets(
            astSymbols
                .map((item) => {
                    if (!isRecord(item)) return null;
                    const nextSymbol = String(item.symbol ?? "").trim().toUpperCase();
                    if (!nextSymbol) return null;
                    const nextExchange = typeof item.exchange === "string" ? item.exchange : workflow.exchange ?? "NSE";
                    return buildTargetEntry(nextSymbol, nextExchange, {
                        ...(isRecord(item.instrument_ref) ? item.instrument_ref : {}),
                        symbol: nextSymbol,
                        exchange: nextExchange
                    });
                })
                .filter(Boolean) as AlertTargetEntry[]
        );
        const nextTargetEntries = normalizeTargets(
            astEntries.length ? astEntries : targeting?.entries?.length ? targeting.entries : []
        );
        const primaryTarget = nextTargetEntries[0];
        const nextSymbol = primaryTarget?.symbol ?? workflow.symbol ?? "";
        const nextExchange = primaryTarget?.exchange ?? workflow.exchange ?? "NSE";
        const nextInstrument = primaryTarget?.instrument_ref ?? workflow.instrument_ref ?? {};
        const nextWorkflowType = dsl.workflow_type ?? "market_data";
        const nextActivePeriodDefaults = activePeriodDefaults(nextWorkflowType);
        const nextActivePeriod = {
            ...nextActivePeriodDefaults,
            ...(dsl.active_period ?? {})
        };
        const nextChannels = dsl.channels ?? { inherit_defaults: true, enabled: ["in_app" as AlertChannelType] };
        const nextEnabledChannels = workflow.channel_override?.enabled ?? nextChannels.enabled ?? ["in_app"];
        const nextLogic = ast?.logic ? logicNodeToConditions(ast.logic) : null;
        const nextConditions =
            nextLogic?.conditions.length
                ? nextLogic.conditions
                : dsl.conditions?.length
                  ? dsl.conditions
                  : [{ field: "ltp", operator: "crosses_above", value: 3000 }];
        const nextCombine = nextLogic?.combine ?? dsl.combine ?? "all";
        const llm = dsl.llm_analysis;
        const feed = dsl.feed_trigger;
        const marketCap = dsl.market_cap_filter;

        setChatWorkflow(workflow);
        setName(workflow.name ?? "");
        setDescription(workflow.description ?? "");
        setAccountId(workflow.account_id ?? accounts[0]?.id ?? "");
        setBrokerCode(workflow.broker_code ?? "");
        setWorkflowType(nextWorkflowType);
        setSymbol(nextSymbol);
        setExchange(nextExchange);
        setInstrumentRef(nextInstrument);
        setSymbolSearch(nextTargetEntries.length === 1 ? nextSymbol : "");
        setCommittedSymbolSearch(nextTargetEntries.length === 1 ? nextSymbol : "");
        setSelectedSearchLabel(nextTargetEntries.length === 1 ? targetDisplay(nextTargetEntries[0]) : "");
        setEditorMode(normalizeEditorMode(workflow.editor_mode));
        setStatus(workflow.status === "active" ? "active" : "inactive");
        setTargetEntries(nextTargetEntries);
        setBulkTargets("");
        if (targetUniverse.kind === "watchlist") {
            setTargetMode("preset_universe");
            setSelectedWatchlistId(String(targetUniverse.watchlist_id ?? selectedWatchlistId));
        } else if (targeting?.mode) {
            setTargetMode(targeting.mode);
        } else {
            setTargetMode(nextTargetEntries.length > 1 ? "symbol_list" : "single_symbol");
        }
        setCombine(nextCombine);
        setConditions(nextConditions);
        setCooldownSeconds(String(dsl.cooldown_seconds ?? 300));
        setLevel(dsl.notification?.level ?? "info");
        setTitleTemplate(dsl.notification?.title_template ?? "{symbol} alert");
        setMessageTemplate(dsl.notification?.message_template ?? "{symbol} matched workflow");
        setDslText(dsl.dsl_text ?? "");
        setInheritDefaults(workflow.channel_override?.inherit_defaults ?? nextChannels.inherit_defaults ?? true);
        setChannelInApp(nextEnabledChannels.includes("in_app"));
        setChannelDiscord(nextEnabledChannels.includes("discord"));
        setChannelTelegram(nextEnabledChannels.includes("telegram"));
        setChannelDesktopAudio(nextEnabledChannels.includes("desktop_audio"));
        setLlmEnabled(Boolean(llm?.enabled));
        setLlmProvider(llm?.provider ?? firstLlmProvider?.provider ?? "");
        setLlmModelId(llm?.model_id ?? firstLlmModel?.model_id ?? "");
        setLlmPromptTemplate(llm?.prompt_template || fallbackLlmPrompt);
        setLlmTemperature(String(llm?.temperature ?? 0.2));
        setLlmMaxTokens(String(llm?.max_completion_tokens ?? 500));
        setLlmTimeout(String(llm?.timeout_seconds ?? 25));
        setFeedProducts(feed?.products ?? ["news"]);
        setFeedAnnouncementCategories(feed?.announcement_categories ?? []);
        setFeedCategoryFilterEnabled(Boolean(feed?.announcement_categories?.length));
        setFeedIncludeRelatedCategories(feed?.include_related_categories ?? true);
        setFeedConditionPrompt(feed?.condition_prompt ?? "");
        setFeedSourceScope(feed?.source_scope ?? "current_alpha_subscription");
        setFeedWatchlistIds(feed?.watchlist_ids ?? []);
        setFeedPresetIds(feed?.preset_ids ?? []);
        setFeedIncludeAllWatchlists(Boolean(feed?.include_all_watchlists));
        setFeedTriggerLlmEnabled(Boolean(feed?.condition_prompt || feed?.provider || feed?.model_id));
        setFeedProvider(feed?.provider ?? "");
        setFeedModelId(feed?.model_id ?? "");
        setFeedTemperature(String(feed?.temperature ?? 0.1));
        setFeedMaxTokens(String(feed?.max_completion_tokens ?? 400));
        setFeedTimeout(String(feed?.timeout_seconds ?? 25));
        setMarketCapMode(marketCap?.mode ?? "all");
        setMarketCapMin(marketCap?.min_value != null ? String(marketCap.min_value) : "");
        setMarketCapMax(marketCap?.max_value != null ? String(marketCap.max_value) : "");
        setActivePeriodEnabled(nextActivePeriod.enabled);
        setActiveTimezone(nextActivePeriod.timezone);
        setActiveDays(nextActivePeriod.days.length ? nextActivePeriod.days : nextActivePeriodDefaults.days);
        setActiveSessionLabel(nextActivePeriod.sessions[0]?.label ?? "Regular market");
        setActiveSessionStart(nextActivePeriod.sessions[0]?.start ?? "09:15");
        setActiveSessionEnd(nextActivePeriod.sessions[0]?.end ?? "15:30");
        setActiveExchanges(listCsv(nextActivePeriod.exchanges));
        setActiveExchangeTypes(listCsv(nextActivePeriod.exchange_types));
        setActiveSegments(listCsv(nextActivePeriod.segments));
        setActiveInstrumentTypes(listCsv(nextActivePeriod.instrument_types));
        setShowAdvancedMarketScope(
            Boolean(
                nextActivePeriod.exchanges.length ||
                    nextActivePeriod.exchange_types.length ||
                    nextActivePeriod.segments.length ||
                    nextActivePeriod.instrument_types.length
            )
        );
        setEngineDetails(null);
        setEngineFeedback("Workflow AI Chat applied this workflow state to the editor.");
        setNotice("Workflow draft loaded from chat snapshot.");
    }

    useEffect(() => {
        if (!dslText.trim()) return;
        const targeting = workflowTargetingPayload();
        const localAst = compileLocalDslToAst(
            dslText,
            workflowAstPayload(targeting) as unknown as Record<string, unknown>
        );
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
                const workflow = persistedWorkflowId
                    ? await updateAlertWorkflow(persistedWorkflowId, payload)
                    : await createAlertWorkflow(payload);
                setChatWorkflow(workflow);
                setNotice(persistedWorkflowId ? "Workflow saved." : "Workflow created.");
                if (persistedWorkflowId) {
                    if (!initialWorkflow?.id) {
                        router.push(`/alerts-workspace/workflows/${workflow.id}`);
                    }
                    router.refresh();
                } else {
                    router.push(`/alerts-workspace/workflows/${workflow.id}`);
                    router.refresh();
                }
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
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
            const minValue = numeric(marketCapMin);
            const maxValue = numeric(marketCapMax);
            if (marketCapMode === "custom") {
                if (minValue === null && maxValue === null) {
                    return "Enter at least one market cap boundary, or switch the filter back to all market caps.";
                }
                if (minValue !== null && maxValue !== null && minValue > maxValue) {
                    return "Market cap `from` cannot be greater than `to`.";
                }
            }
            return null;
        }
        if (targetMode === "single_symbol") {
            return symbol.trim() ? null : "Select a symbol target before creating this workflow.";
        }
        if (targetMode === "symbol_list") {
            return targetEntries.length > 0
                ? null
                : "Add at least one symbol to the target list before creating this workflow.";
        }
        const minValue = numeric(marketCapMin);
        const maxValue = numeric(marketCapMax);
        if (marketCapMode === "custom") {
            if (minValue === null && maxValue === null) {
                return "Enter at least one market cap boundary, or switch the filter back to all market caps.";
            }
            if (minValue !== null && maxValue !== null && minValue > maxValue) {
                return "Market cap `from` cannot be greater than `to`.";
            }
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
        const openValue =
            numeric(preview.ohlc?.open) ??
            numeric(rawOhlc.open) ??
            numeric(quoteOhlc.open) ??
            numeric(quoteRaw.open) ??
            0;
        const closeValue =
            numeric(preview.ohlc?.close) ??
            numeric(rawOhlc.close) ??
            numeric(quoteOhlc.close) ??
            numeric(quoteRaw.close) ??
            0;
        const highValue =
            numeric(preview.ohlc?.high) ??
            numeric(rawOhlc.high) ??
            numeric(quoteOhlc.high) ??
            numeric(quoteRaw.high) ??
            0;
        const lowValue =
            numeric(preview.ohlc?.low) ?? numeric(rawOhlc.low) ?? numeric(quoteOhlc.low) ?? numeric(quoteRaw.low) ?? 0;
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
        const changePct =
            referenceValue && referenceValue !== 0
                ? Number((((ltp - referenceValue) / referenceValue) * 100).toFixed(2))
                : numeric(quoteRaw.day_change_perc);
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

    function sendTestAlert() {
        if (!persistedWorkflowId) return;
        setError("");
        setMatchPreview("");
        startTransition(async () => {
            try {
                const result = await sendWorkflowTestNotification(persistedWorkflowId, buildPreviewTick());
                setMatchPreview(`${result.message} Notification id: ${result.notification_id}`);
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                setError(caught instanceof Error ? caught.message : "Could not send test alert.");
            }
        });
    }

    function requestLlmCreditConfirmation(action: "preview" | "test") {
        if (!persistedWorkflowId) return;
        setLlmCreditAction(action);
    }

    function runPreviewLlmContext() {
        if (!persistedWorkflowId) return;
        setError("");
        setLlmFeedback("");
        setLlmDetails(null);
        startTransition(async () => {
            try {
                const result = await previewAlertWorkflowLlmContext(
                    persistedWorkflowId,
                    buildPreviewTick(),
                    llmAnalysisPayload()
                );
                setLlmFeedback(
                    `Resolved ${Object.keys(result.placeholders ?? {}).length} placeholder context block${Object.keys(result.placeholders ?? {}).length === 1 ? "" : "s"} for ${result.symbol}.`
                );
                setLlmDetails(result as unknown as Record<string, unknown>);
                setLlmPromptTab("preview");
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                setError(caught instanceof Error ? caught.message : "Could not preview LLM context.");
            }
        });
    }

    function runTestLlmAnalysis() {
        if (!persistedWorkflowId) return;
        setError("");
        setLlmFeedback("");
        setLlmDetails(null);
        startTransition(async () => {
            try {
                const result = await testAlertWorkflowLlm(persistedWorkflowId, buildPreviewTick(), llmAnalysisPayload());
                const analysis = result.llm_analysis ?? {};
                setLlmFeedback(String(analysis.output || analysis.error || analysis.status || "LLM test completed."));
                setLlmDetails(result as unknown as Record<string, unknown>);
                setLlmPromptTab("preview");
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                setError(caught instanceof Error ? caught.message : "Could not run LLM test.");
            }
        });
    }

    function confirmLlmCreditAction() {
        const action = llmCreditAction;
        setLlmCreditAction(null);
        if (action === "preview") runPreviewLlmContext();
        if (action === "test") runTestLlmAnalysis();
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
        if (!persistedWorkflowId || typeof window === "undefined") return;
        if (
            !window.confirm(
                `Delete workflow "${persistedWorkflow?.name ?? name}"? This removes its live subscription and history remains only in past notifications.`
            )
        ) {
            return;
        }
        setError("");
        startTransition(async () => {
            try {
                await deleteAlertWorkflow(persistedWorkflowId);
                router.push("/alerts-workspace/workflows");
                router.refresh();
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                setError(caught instanceof Error ? caught.message : "Could not delete workflow.");
            }
        });
    }

    function removeTarget(index: number) {
        const removed = targetEntries[index];
        const next = targetEntries.filter((_, currentIndex) => currentIndex !== index);
        setTargetEntries(next);
        if (removed && removed.symbol === symbol && (removed.exchange ?? "") === (exchange || "")) {
            const fallback = next[index] ?? next[index - 1] ?? next[0];
            if (fallback) {
                setSymbol(fallback.symbol);
                setExchange(fallback.exchange ?? "NSE");
                setInstrumentRef(fallback.instrument_ref);
                setSelectedSearchLabel(targetDisplay(fallback));
                setSymbolSearch("");
                setCommittedSymbolSearch("");
            } else {
                setSymbol("");
                setInstrumentRef({});
                setSelectedSearchLabel("");
                setSymbolSearch("");
                setCommittedSymbolSearch("");
            }
        }
    }

    function loadTarget(entry: AlertTargetEntry) {
        setSymbol(entry.symbol);
        setExchange(entry.exchange ?? "NSE");
        setInstrumentRef(entry.instrument_ref);
        setSelectedSearchLabel(targetDisplay(entry));
        setSymbolSearch(targetMode === "single_symbol" ? entry.symbol : "");
        setCommittedSymbolSearch(targetMode === "single_symbol" ? entry.symbol : "");
        loadPreviewNow(entry.instrument_ref);
    }

    function loadUniverseTarget(item: UniverseSymbolPreview) {
        setSymbol(item.symbol);
        setExchange(item.exchange ?? "NSE");
        setInstrumentRef({
            ...(item.instrument_ref ?? {}),
            symbol: item.symbol,
            exchange: item.exchange ?? "NSE"
        });
        setSelectedSearchLabel([item.symbol, item.exchange].filter(Boolean).join(" · "));
        setSymbolSearch("");
        setCommittedSymbolSearch("");
        loadPreviewNow({
            ...(item.instrument_ref ?? {}),
            symbol: item.symbol,
            exchange: item.exchange ?? "NSE"
        });
    }

    function importBulkTargets() {
        const imported = parseBulkTargets(bulkTargets, exchange);
        if (!imported.length) {
            return;
        }
        setTargetEntries((current) => normalizeTargets([...current, ...imported]));
        const [firstImported] = imported;
        setSymbol(firstImported.symbol);
        setExchange(firstImported.exchange ?? "NSE");
        setInstrumentRef(firstImported.instrument_ref);
        setSelectedSearchLabel(targetDisplay(firstImported));
        setSymbolSearch("");
        setCommittedSymbolSearch("");
        setBulkTargets("");
    }

    function clearTargets() {
        setTargetEntries([]);
        setSymbol("");
        setInstrumentRef({});
        setSelectedSearchLabel("");
        setSymbolSearch("");
        setCommittedSymbolSearch("");
    }

    function runEngineAction(action: EngineAction) {
        if (!persistedWorkflowId) return;
        setError("");
        setEngineFeedback("");
        setEngineDetails(null);
        setRunningEngineAction(action);
        setLastEngineAction(action);
        startTransition(async () => {
            try {
                let result: Record<string, unknown>;
                if (action === "validate") {
                    result = (await validateAlertWorkflow(persistedWorkflowId)) as unknown as Record<string, unknown>;
                    setEngineFeedback(
                        (result.valid as boolean) ? "Workflow validation passed." : "Workflow validation failed."
                    );
                    if (result.valid && result.workflow_ast) {
                        syncVisualBuilderFromAst(result.workflow_ast);
                    }
                } else if (action === "compile") {
                    result = (await compilePreviewAlertWorkflow(persistedWorkflowId)) as unknown as Record<
                        string,
                        unknown
                    >;
                    setEngineFeedback(
                        (result.valid as boolean) ? "Compile preview is valid." : "Compile preview has errors."
                    );
                    if (result.valid && result.workflow_ast) {
                        syncVisualBuilderFromAst(result.workflow_ast);
                    }
                } else if (action === "explain") {
                    result = await explainAlertWorkflow(persistedWorkflowId);
                    setEngineFeedback(String(result.summary ?? "Workflow explanation generated."));
                } else if (action === "samples") {
                    result = await getWorkflowSampleAlerts(persistedWorkflowId);
                    setEngineFeedback("Sample alert payload generated.");
                } else {
                    const deployed = await deployAlertWorkflow(persistedWorkflowId);
                    setChatWorkflow(deployed);
                    result = deployed as unknown as Record<string, unknown>;
                    setEngineFeedback(`Workflow deployed as version ${deployed.deploy_version ?? 0}.`);
                    router.refresh();
                }
                setEngineDetails(result);
            } catch (caught) {
                notifyAlphaCreditWarning(caught);
                setError(caught instanceof Error ? caught.message : "Workflow engine action failed.");
            } finally {
                setRunningEngineAction(null);
            }
        });
    }

    const engineActions: Array<{ action: EngineAction; label: string; variant: "default" | "secondary" }> = [
        { action: "validate", label: "Validate", variant: "secondary" },
        { action: "compile", label: "Compile", variant: "secondary" },
        { action: "explain", label: "Explain", variant: "secondary" },
        { action: "samples", label: "Samples", variant: "secondary" },
        { action: "deploy", label: "Deploy", variant: "default" }
    ];
    const engineFeedbackTone =
        engineFeedback.toLowerCase().includes("fail") || engineFeedback.toLowerCase().includes("error")
            ? "error"
            : "success";
    const engineDetailsLabel = lastEngineAction
        ? `${engineActions.find((item) => item.action === lastEngineAction)?.label ?? "Engine"} output`
        : "Engine output";

    const currentTemplatesMatchSuggestion =
        titleTemplate === suggestedCopy.title && messageTemplate === suggestedCopy.message;
    const selectedLlmProvider = llmProviders.find((item) => item.provider === llmProvider);
    const selectedLlmModels = selectedLlmProvider?.models.filter((model) => model.is_enabled) ?? [];
    const llmCreditActionLabel = llmCreditAction === "test" ? "Test LLM" : "Preview context";
    const llmCreditReason = buildContextCreditReason(llmPromptTemplate);
    const llmProviderCreditLabel = [llmProvider, llmModelId].filter(Boolean).join(" / ");
    const selectedFeedProvider = llmProviders.find((item) => item.provider === feedProvider);
    const selectedFeedModels = selectedFeedProvider?.models.filter((model) => model.is_enabled) ?? [];
    let visibleStepIndex = 1;
    const nextStep = () => `Step ${visibleStepIndex++}`;
    const workflowBasicsStep = nextStep();
    const marketWindowStep = workflowType === "market_data" ? nextStep() : "";
    const feedWindowStep = workflowType === "alpha_feed" ? nextStep() : "";
    const feedTriggerStep = workflowType === "alpha_feed" ? nextStep() : "";
    const targetStep = workflowType === "market_data" ? nextStep() : "";
    const marketCapStep = nextStep();
    const buildTriggerStep = nextStep();
    const optionalAnalysisStep = nextStep();
    const advancedDeploymentStep = nextStep();
    const deliveryLifecycleStep = nextStep();
    const cachedPreview = previewCacheRef.current[previewTargetKey];
    const displayedPreview: PreviewState = hasCurrentPreview
        ? preview
        : cachedPreview
          ? { ...cachedPreview, loading: false, error: preview.error }
          : previewDataKey === previewTargetKey
            ? preview
            : { quote: null, ohlc: null, loading: preview.loading, error: preview.error };
    const hasSelectedPreviewTarget = Boolean(
        activeInstrument.symbol &&
        (targetMode !== "single_symbol" || selectedSearchLabel || hasCurrentPreview || cachedPreview)
    );
    const hasPreviewTarget = workflowType === "market_data" && hasSelectedPreviewTarget;

    function toggleFeedProduct(product: string, checked: boolean) {
        setFeedProducts((current) =>
            checked ? Array.from(new Set([...current, product])) : current.filter((item) => item !== product)
        );
    }

    function toggleFeedAnnouncementCategory(category: string, checked: boolean) {
        setFeedAnnouncementCategories((current) =>
            checked ? Array.from(new Set([...current, category])) : current.filter((item) => item !== category)
        );
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
        setFeedWatchlistIds((current) =>
            checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id)
        );
    }

    function toggleFeedPreset(id: string, checked: boolean) {
        setFeedPresetIds((current) =>
            checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id)
        );
    }

    const marketCapMinNumber = numeric(marketCapMin);
    const marketCapMaxNumber = numeric(marketCapMax);
    const displayedMarketCapMin = marketCapMode === "custom" ? marketCapMinNumber : MARKET_CAP_RANGE_MIN;
    const displayedMarketCapMax = marketCapMode === "custom" ? marketCapMaxNumber : MARKET_CAP_RANGE_MAX;
    const marketCapSliderLower = clampMarketCapValue(displayedMarketCapMin ?? MARKET_CAP_RANGE_MIN);
    const marketCapSliderUpper = clampMarketCapValue(displayedMarketCapMax ?? MARKET_CAP_RANGE_MAX);
    const marketCapRangeStart = Math.min(marketCapSliderLower, marketCapSliderUpper);
    const marketCapRangeEnd = Math.max(marketCapSliderLower, marketCapSliderUpper);
    const marketCapRangeStartSliderValue = marketCapValueToSliderValue(marketCapRangeStart);
    const marketCapRangeEndSliderValue = marketCapValueToSliderValue(marketCapRangeEnd);
    const marketCapRangeStartPercent = marketCapValueToPosition(marketCapRangeStart) * 100;
    const marketCapRangeEndPercent = marketCapValueToPosition(marketCapRangeEnd) * 100;
    const marketCapRangeSummary =
        marketCapMode === "custom"
            ? `${formatMarketCapRangeValue(marketCapRangeStart)} to ${formatMarketCapRangeValue(marketCapRangeEnd)}`
            : "All market caps";
    const activeMarketCapPreset =
        marketCapMode === "custom" ? matchMarketCapPreset(marketCapRangeStart, marketCapRangeEnd) : "all";
    const marketCapRangeTrackStyle = {
        background: `linear-gradient(to right, var(--border) 0%, var(--border) ${marketCapRangeStartPercent}%, var(--primary) ${marketCapRangeStartPercent}%, var(--primary) ${marketCapRangeEndPercent}%, var(--border) ${marketCapRangeEndPercent}%, var(--border) 100%)`
    };

    function chooseMarketCapPreset(preset: MarketCapPreset) {
        if (preset.id === "all") {
            setMarketCapMode("all");
            return;
        }
        setMarketCapMode("custom");
        setMarketCapMin(String(preset.min ?? MARKET_CAP_RANGE_MIN));
        setMarketCapMax(String(preset.max ?? MARKET_CAP_RANGE_MAX));
    }

    function updateMarketCapSlider(boundary: "min" | "max", value: string) {
        const nextValue = marketCapSliderValueToValue(value);
        if (boundary === "min") {
            const upper = marketCapMaxNumber ?? MARKET_CAP_RANGE_MAX;
            setMarketCapMin(String(Math.min(nextValue, upper)));
            return;
        }
        const lower = marketCapMinNumber ?? MARKET_CAP_RANGE_MIN;
        setMarketCapMax(String(Math.max(nextValue, lower)));
    }

    function updateMarketCapInput(boundary: "min" | "max", value: string) {
        if (value === "") {
            if (boundary === "min") setMarketCapMin("");
            else setMarketCapMax("");
            return;
        }
        const nextValue = numeric(value);
        if (nextValue === null) return;
        const cleanValue = String(Math.max(0, nextValue));
        if (boundary === "min") setMarketCapMin(cleanValue);
        else setMarketCapMax(cleanValue);
    }

    function normalizeMarketCapInput(boundary: "min" | "max") {
        const lower = numeric(marketCapMin);
        const upper = numeric(marketCapMax);
        if (boundary === "min" && lower !== null) {
            const nextLower = clampMarketCapValue(lower);
            setMarketCapMin(String(upper !== null ? Math.min(nextLower, upper) : nextLower));
        }
        if (boundary === "max" && upper !== null) {
            const nextUpper = clampMarketCapValue(upper);
            setMarketCapMax(String(lower !== null ? Math.max(nextUpper, lower) : nextUpper));
        }
    }

    return (
        <div className="grid max-w-[1500px] gap-4">
            <Dialog
                open={llmCreditAction !== null}
                onOpenChange={(open) => {
                    if (!open) setLlmCreditAction(null);
                }}
            >
                <DialogContent className="max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>API credits may be used</DialogTitle>
                        <DialogDescription>
                            {llmCreditActionLabel} resolves the saved workflow prompt context before showing the
                            preview.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogPanel>
                        <div className="grid gap-3 text-sm text-muted-foreground">
                            <div className="rounded-lg border border-border bg-secondary/20 p-3 text-foreground">
                                <div className="type-step-eyebrow mb-2">Prompt check</div>
                                <p className="break-words leading-6">{llmCreditReason}</p>
                            </div>
                            {llmCreditAction === "test" ? (
                                <p className="leading-6">
                                    This will also call the selected LLM
                                    {llmProviderCreditLabel ? ` (${llmProviderCreditLabel})` : ""}, which may consume
                                    provider credits.
                                </p>
                            ) : null}
                            <p className="leading-6">
                                Review the prompt before continuing. This run uses the current draft prompt and LLM settings
                                without saving the workflow.
                            </p>
                        </div>
                    </DialogPanel>
                    <DialogFooter>
                        <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
                        <Button onClick={confirmLlmCreditAction} type="button">
                            Continue
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {error ? (
                <div className="max-w-5xl border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">
                    {error}
                </div>
            ) : null}
            {notice ? (
                <div className="max-w-5xl rounded-lg border-l-2 border-primary bg-secondary/30 px-4 py-3 text-sm text-foreground">
                    {notice}
                </div>
            ) : null}
            {isTemplateDraft ? (
                <div className="max-w-5xl rounded-lg border-l-2 border-primary bg-secondary/30 px-4 py-3 text-sm text-foreground">
                    Template loaded as a new workflow draft. Saving creates your own workflow and leaves the system
                    template unchanged.
                </div>
            ) : null}
            {matchPreview ? (
                <div className="type-body max-w-5xl rounded-lg border border-border px-4 py-3 text-muted-foreground">
                    {matchPreview}
                </div>
            ) : null}

            <div className="grid gap-4">
                <div className="grid gap-4">
                    <div className="max-w-5xl rounded-lg border border-border p-3">
                        <StepHeader
                            step={workflowBasicsStep}
                            title="Workflow basics"
                            description={
                                workflowType === "alpha_feed"
                                    ? "Set the workflow identity first so the trigger mode and naming are clear before you configure the feed source."
                                    : "Set the workflow identity first so the trigger mode and naming are clear before you configure the market window or targets."
                            }
                        />
                        <div className="grid max-w-3xl items-start gap-3 min-[760px]:grid-cols-[220px_minmax(0,360px)]">
                            <Label className="grid content-start self-start gap-2 text-sm">
                                <FieldLabel>Workflow type</FieldLabel>
                                <SimpleSelect
                                    className="h-9 max-w-full border border-input bg-background px-3 text-sm"
                                    onValueChange={(nextType) => {
                                        const typedType = nextType as "market_data" | "alpha_feed";
                                        setWorkflowType(typedType);
                                        applyActivePeriodDefaults(typedType);
                                    }}
                                    options={[
                                        { value: "market_data", label: "Broker market data trigger" },
                                        { value: "alpha_feed", label: "Ananta websocket feed trigger" }
                                    ]}
                                    value={workflowType}
                                />
                                <HelpText>
                                    {workflowType === "alpha_feed"
                                        ? "This workflow analyzes stored Ananta websocket items from your configured feed symbols, watchlists, presets, or full-market tier."
                                        : "This workflow evaluates broker quote ticks first, then optionally runs LLM analysis after a trigger."}
                                </HelpText>
                            </Label>
                            <Label className="grid content-start self-start gap-2 text-sm">
                                <FieldLabel>Workflow name</FieldLabel>
                                <Input
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder="Workflow name"
                                    title="Use a short trading-oriented name. Example: RELIANCE breakout above 1430."
                                    value={name}
                                />
                                <HelpText>This is the name shown in workflow lists and alert history.</HelpText>
                            </Label>
                        </div>
                        <Label className="mt-3 grid max-w-2xl gap-2 text-sm">
                            <FieldLabel>Description</FieldLabel>
                            <Input
                                onChange={(event) => setDescription(event.target.value)}
                                placeholder="Description"
                                title="Optional human note about why this workflow exists."
                                value={description}
                            />
                            <HelpText>Use this for strategy intent, not execution logic.</HelpText>
                        </Label>
                    </div>

                    {workflowType === "market_data" ? (
                        <div className="max-w-5xl rounded-lg border border-border p-3">
                            <StepHeader
                                step={marketWindowStep}
                                title="Market window"
                                description="Broker market-data workflows ignore ticks outside this window, preventing stale post-close quotes from creating alerts."
                                action={
                                    <Label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={activePeriodEnabled}
                                            onCheckedChange={(checked) => setActivePeriodEnabled(Boolean(checked))}
                                        />
                                        Enforce active period
                                    </Label>
                                }
                            />
                            <div className="grid max-w-2xl items-start gap-3 min-[760px]:grid-cols-[minmax(0,280px)_100px_100px]">
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>Timezone</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveTimezone(event.target.value)}
                                        placeholder="Asia/Kolkata"
                                        value={activeTimezone}
                                    />
                                    <HelpText>Default is `Asia/Kolkata` for NSE/BSE market hours.</HelpText>
                                </Label>
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>Start</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveSessionStart(event.target.value)}
                                        placeholder="09:15"
                                        value={activeSessionStart}
                                    />
                                    <HelpText>Session start time.</HelpText>
                                </Label>
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>End</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveSessionEnd(event.target.value)}
                                        placeholder="15:30"
                                        value={activeSessionEnd}
                                    />
                                    <HelpText>Session end time.</HelpText>
                                </Label>
                            </div>
                            <div className="mt-3 grid max-w-3xl items-start gap-3 min-[760px]:grid-cols-[minmax(0,280px)_1fr]">
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>Session label</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveSessionLabel(event.target.value)}
                                        placeholder="Regular market"
                                        value={activeSessionLabel}
                                    />
                                    <HelpText>Saved with runtime evaluation metadata.</HelpText>
                                </Label>
                                <div className="grid content-start self-start gap-2">
                                    <FieldLabel>Days</FieldLabel>
                                    <div className="flex flex-wrap gap-3">
                                        {dayOptions.map(([day, label]) => (
                                            <Label className="flex items-center gap-1.5 text-sm" key={day}>
                                                <Checkbox
                                                    checked={activeDays.includes(day)}
                                                    onCheckedChange={(checked) =>
                                                        toggleActiveDay(day, Boolean(checked))
                                                    }
                                                />
                                                {label}
                                            </Label>
                                        ))}
                                    </div>
                                    <HelpText>Common default is Monday-Friday.</HelpText>
                                </div>
                            </div>
                            <div className="mt-3 rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <SectionTitle>Advanced scope</SectionTitle>
                                        <HelpText>
                                            Optional filters for restricting the active period to specific markets and
                                            instruments.
                                        </HelpText>
                                    </div>
                                    <Button
                                        onClick={() => setShowAdvancedMarketScope((current) => !current)}
                                        size="sm"
                                        type="button"
                                        variant="secondary"
                                    >
                                        {showAdvancedMarketScope
                                            ? "Hide optional scope"
                                            : `Show optional scope${advancedMarketScopeCount ? ` (${advancedMarketScopeCount})` : ""}`}
                                    </Button>
                                </div>
                                {showAdvancedMarketScope ? (
                                    <div className="mt-3 grid gap-3 min-[980px]:grid-cols-2">
                                        <Label className="grid gap-2 text-sm">
                                            <FieldLabel>Exchanges</FieldLabel>
                                            <Input
                                                className="font-mono uppercase"
                                                onChange={(event) =>
                                                    setActiveExchanges(event.target.value.toUpperCase())
                                                }
                                                placeholder="NSE, BSE"
                                                value={activeExchanges}
                                            />
                                            <HelpText>Optional exchange scope.</HelpText>
                                        </Label>
                                        <Label className="grid gap-2 text-sm">
                                            <FieldLabel>Exchange types</FieldLabel>
                                            <Input
                                                className="font-mono uppercase"
                                                onChange={(event) =>
                                                    setActiveExchangeTypes(event.target.value.toUpperCase())
                                                }
                                                placeholder="NSE, BSE, NFO"
                                                value={activeExchangeTypes}
                                            />
                                            <HelpText>Optional exchange-type scope.</HelpText>
                                        </Label>
                                        <Label className="grid gap-2 text-sm">
                                            <FieldLabel>Segments</FieldLabel>
                                            <Input
                                                className="font-mono uppercase"
                                                onChange={(event) =>
                                                    setActiveSegments(event.target.value.toUpperCase())
                                                }
                                                placeholder="NSE, NFO-OPT"
                                                value={activeSegments}
                                            />
                                            <HelpText>Optional broker segment scope from synced instruments.</HelpText>
                                        </Label>
                                        <Label className="grid gap-2 text-sm">
                                            <FieldLabel>Instrument types</FieldLabel>
                                            <Input
                                                className="font-mono uppercase"
                                                onChange={(event) =>
                                                    setActiveInstrumentTypes(event.target.value.toUpperCase())
                                                }
                                                placeholder="EQ, FUT, CE, PE"
                                                value={activeInstrumentTypes}
                                            />
                                            <HelpText>Optional instrument-type scope.</HelpText>
                                        </Label>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {workflowType === "alpha_feed" ? (
                        <div className="max-w-5xl rounded-lg border border-border p-3">
                            <StepHeader
                                step={feedWindowStep}
                                title="Feed window"
                                description="Websocket feed workflows only evaluate items inside this window, so category filters, trigger LLM usage, and notifications are skipped outside your chosen times."
                                action={
                                    <Label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={activePeriodEnabled}
                                            onCheckedChange={(checked) => setActivePeriodEnabled(Boolean(checked))}
                                        />
                                        Enforce active period
                                    </Label>
                                }
                            />
                            <div className="grid max-w-2xl items-start gap-3 min-[760px]:grid-cols-[minmax(0,280px)_100px_100px]">
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>Timezone</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveTimezone(event.target.value)}
                                        placeholder="Asia/Kolkata"
                                        value={activeTimezone}
                                    />
                                    <HelpText>
                                        Feed workflows default to always-on timing in `Asia/Kolkata`, but you can narrow
                                        the window if needed.
                                    </HelpText>
                                </Label>
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>Start</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveSessionStart(event.target.value)}
                                        placeholder="00:00"
                                        value={activeSessionStart}
                                    />
                                    <HelpText>Window start time.</HelpText>
                                </Label>
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>End</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveSessionEnd(event.target.value)}
                                        placeholder="23:59"
                                        value={activeSessionEnd}
                                    />
                                    <HelpText>Window end time.</HelpText>
                                </Label>
                            </div>
                            <div className="mt-3 grid max-w-3xl items-start gap-3 min-[760px]:grid-cols-[minmax(0,280px)_1fr]">
                                <Label className="grid content-start self-start gap-2 text-sm">
                                    <FieldLabel>Session label</FieldLabel>
                                    <Input
                                        onChange={(event) => setActiveSessionLabel(event.target.value)}
                                        placeholder="Always active"
                                        value={activeSessionLabel}
                                    />
                                    <HelpText>Saved with runtime evaluation metadata.</HelpText>
                                </Label>
                                <div className="grid content-start self-start gap-2">
                                    <FieldLabel>Days</FieldLabel>
                                    <div className="flex flex-wrap gap-3">
                                        {dayOptions.map(([day, label]) => (
                                            <Label className="flex items-center gap-1.5 text-sm" key={day}>
                                                <Checkbox
                                                    checked={activeDays.includes(day)}
                                                    onCheckedChange={(checked) =>
                                                        toggleActiveDay(day, Boolean(checked))
                                                    }
                                                />
                                                {label}
                                            </Label>
                                        ))}
                                    </div>
                                    <HelpText>
                                        Feed workflows default to all seven days, but you can restrict them to any
                                        custom schedule.
                                    </HelpText>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {workflowType === "alpha_feed" ? (
                        <div className="max-w-5xl rounded-lg border border-border p-3">
                            <StepHeader
                                step={feedTriggerStep}
                                title="Feed trigger"
                                description="Choose which Ananta websocket products and symbol scopes can create alerts before optional trigger LLM classification runs."
                            />
                            <div className="grid max-w-3xl gap-4 min-[900px]:grid-cols-2">
                                <div>
                                    <FieldLabel>Products</FieldLabel>
                                    <div className="mt-3 grid gap-2">
                                        {alphaFeedProducts.map((product) => (
                                            <Label className="flex items-center gap-2 text-sm" key={product}>
                                                <Checkbox
                                                    checked={feedProducts.includes(product)}
                                                    onCheckedChange={(checked) =>
                                                        toggleFeedProduct(product, Boolean(checked))
                                                    }
                                                />
                                                <span>{product}</span>
                                            </Label>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <FieldLabel>Feed scope</FieldLabel>
                                    <SimpleSelect
                                        className="mt-3 h-9 w-full border border-input bg-background px-3 text-sm"
                                        onValueChange={(nextScope) =>
                                            setFeedSourceScope(nextScope as typeof feedSourceScope)
                                        }
                                        options={[
                                            {
                                                value: "current_alpha_subscription",
                                                label: "Current configured Drishti subscription"
                                            },
                                            { value: "watchlists", label: "Specific watchlists" },
                                            { value: "preset_lists", label: "Preset lists" },
                                            { value: "full_market", label: "Full market feed" }
                                        ]}
                                        value={feedSourceScope}
                                    />
                                    <HelpText>
                                        Events are only available for symbols currently subscribed by the background
                                        Ananta websocket worker unless full-market is enabled for the chosen
                                        products.
                                    </HelpText>
                                </div>
                                {announcementsEnabled ? (
                                    <div className="min-w-0">
                                        <FieldLabel>Announcement categories</FieldLabel>
                                        <div className="mt-3 grid gap-2.5">
                                            <div className="inline-flex w-fit rounded-lg border border-border p-1">
                                                <Button
                                                    className="h-7 px-2.5 text-xs"
                                                    onClick={useAllAnnouncementCategories}
                                                    size="sm"
                                                    type="button"
                                                    variant={!feedCategoryFilterEnabled ? "secondary" : "ghost"}
                                                >
                                                    All
                                                </Button>
                                                <Button
                                                    className="h-7 px-2.5 text-xs"
                                                    onClick={enableSpecificAnnouncementCategories}
                                                    size="sm"
                                                    type="button"
                                                    variant={feedCategoryFilterEnabled ? "secondary" : "ghost"}
                                                >
                                                    Specific
                                                </Button>
                                            </div>
                                            {!feedCategoryFilterEnabled ? (
                                                <HelpText>
                                                    All announcement categories are currently allowed. Turn on
                                                    specific-category mode only when you want to restrict this workflow.
                                                </HelpText>
                                            ) : (
                                                <>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Button
                                                            className="h-7 px-2.5 text-xs"
                                                            onClick={selectAllAnnouncementCategories}
                                                            size="sm"
                                                            type="button"
                                                            variant="ghost"
                                                        >
                                                            Select all
                                                        </Button>
                                                        <Button
                                                            className="h-7 px-2.5 text-xs"
                                                            onClick={clearAnnouncementCategorySelection}
                                                            size="sm"
                                                            type="button"
                                                            variant="ghost"
                                                        >
                                                            Clear
                                                        </Button>
                                                        <HelpText>
                                                            {feedAnnouncementCategories.length} selected
                                                        </HelpText>
                                                    </div>
                                                    <Input
                                                        className="h-9"
                                                        onChange={(event) => setFeedCategoryQuery(event.target.value)}
                                                        placeholder="Filter categories"
                                                        value={feedCategoryQuery}
                                                    />
                                                    <Label className="flex items-center gap-2 text-sm">
                                                        <Checkbox
                                                            checked={feedIncludeRelatedCategories}
                                                            onCheckedChange={(checked) =>
                                                                setFeedIncludeRelatedCategories(Boolean(checked))
                                                            }
                                                        />
                                                        Also match related announcement categories
                                                    </Label>
                                                    <div className="max-h-48 overflow-auto rounded-lg border border-border">
                                                        {filteredAnnouncementCategories.map((category) => (
                                                            <Label
                                                                className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-2.5 py-1.5 text-sm last:border-b-0"
                                                                key={category}
                                                                title={category}
                                                            >
                                                                <span className="min-w-0 truncate">
                                                                    {announcementCategoryLabel(category)}
                                                                </span>
                                                                <Checkbox
                                                                    checked={feedAnnouncementCategories.includes(
                                                                        category
                                                                    )}
                                                                    onCheckedChange={(checked) =>
                                                                        toggleFeedAnnouncementCategory(
                                                                            category,
                                                                            Boolean(checked)
                                                                        )
                                                                    }
                                                                />
                                                            </Label>
                                                        ))}
                                                        {!filteredAnnouncementCategories.length ? (
                                                            <div className="type-help px-3 py-2 text-muted-foreground">
                                                                No categories available for the current filter.
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    {!feedAnnouncementCategories.length ? (
                                                        <HelpText>
                                                            Select at least one category, or switch back to `All
                                                            categories`.
                                                        </HelpText>
                                                    ) : null}
                                                </>
                                            )}
                                            <HelpText>
                                                The category API is only used while this editor page loads. Live
                                                matching uses the category fields already present in incoming
                                                announcement payloads.
                                            </HelpText>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                            {feedSourceScope === "watchlists" ? (
                                <div className="mt-5 grid max-w-md gap-3">
                                    <div>
                                        <FieldLabel>Watchlists</FieldLabel>
                                        <HelpText className="mt-1">
                                            Choose which watchlists can feed this workflow.
                                        </HelpText>
                                    </div>
                                    <Label className="flex w-fit items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={feedIncludeAllWatchlists}
                                            onCheckedChange={(checked) => setFeedIncludeAllWatchlists(Boolean(checked))}
                                        />
                                        All watchlists
                                    </Label>
                                    <div className="grid max-h-44 gap-2 overflow-auto">
                                        {watchlists.map((watchlist) => (
                                            <Label
                                                className="flex min-w-0 items-center gap-2 text-sm"
                                                key={watchlist.id}
                                            >
                                                <Checkbox
                                                    checked={feedWatchlistIds.includes(watchlist.id)}
                                                    disabled={feedIncludeAllWatchlists}
                                                    onCheckedChange={(checked) =>
                                                        toggleFeedWatchlist(watchlist.id, Boolean(checked))
                                                    }
                                                />
                                                <span className="min-w-0 truncate">{watchlist.name}</span>
                                            </Label>
                                        ))}
                                        {!watchlists.length ? (
                                            <HelpText>No watchlists are available yet.</HelpText>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}
                            {feedSourceScope === "preset_lists" ? (
                                <div className="mt-5 grid max-w-md gap-3">
                                    <div>
                                        <FieldLabel>Preset lists</FieldLabel>
                                        <HelpText className="mt-1">
                                            Choose saved preset lists for the feed trigger scope.
                                        </HelpText>
                                    </div>
                                    <div className="grid max-h-44 gap-2 overflow-auto">
                                        {presets.map((preset) => {
                                            const id = String(preset.id ?? "");
                                            return (
                                                <Label className="flex min-w-0 items-center gap-2 text-sm" key={id}>
                                                    <Checkbox
                                                        checked={feedPresetIds.includes(id)}
                                                        onCheckedChange={(checked) =>
                                                            toggleFeedPreset(id, Boolean(checked))
                                                        }
                                                    />
                                                    <span className="min-w-0 truncate">
                                                        {String(preset.label ?? id)}
                                                    </span>
                                                </Label>
                                            );
                                        })}
                                        {!presets.length ? (
                                            <HelpText>No preset lists are available yet.</HelpText>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}
                            <div className="mt-5 grid gap-2">
                                <div className="flex items-center justify-between gap-3">
                                    <FieldLabel>Trigger LLM</FieldLabel>
                                    <Label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={feedTriggerLlmEnabled}
                                            onCheckedChange={(checked) => setFeedTriggerLlmEnabled(Boolean(checked))}
                                        />
                                        Enable
                                    </Label>
                                </div>
                                <div className="grid gap-2">
                                    <SimpleSelect
                                        className="h-10 border border-input bg-background px-3 text-sm"
                                        disabled={!feedTriggerLlmEnabled}
                                        onValueChange={(nextProvider) => setFeedProvider(nextProvider as LlmProvider | "")}
                                        options={enabledLlmProviders.map((provider) => ({
                                            value: provider.provider,
                                            label: provider.label
                                        }))}
                                        placeholder="Select provider"
                                        value={feedProvider}
                                    />
                                    {feedProvider ? (
                                        <LlmModelPicker
                                            allowedModels={selectedFeedModels}
                                            disabled={!feedTriggerLlmEnabled}
                                            models={openRouterModels}
                                            onSelect={(id) => setFeedModelId(id)}
                                            provider={feedProvider}
                                            value={feedModelId}
                                        />
                                    ) : (
                                        <SimpleSelect
                                            className="h-10 border border-input bg-background px-3 text-sm"
                                            disabled
                                            onValueChange={setFeedModelId}
                                            options={selectedFeedModels.map((model) => ({
                                                value: model.model_id,
                                                label: model.label || model.model_id
                                            }))}
                                            placeholder="Select model"
                                            value={feedModelId}
                                        />
                                    )}
                                </div>
                                <HelpText>
                                    {feedTriggerLlmEnabled
                                        ? "The trigger model classifies matched feed items after product, symbol, and category filters pass."
                                        : "Off means every item that passes product, symbol scope, and category filters can create an alert without trigger LLM usage."}
                                </HelpText>
                            </div>
                            <div className="grid gap-2">
                                <Label className="grid gap-2">
                                    <FieldLabel>Natural-language trigger condition</FieldLabel>
                                    <Textarea
                                        className="min-h-28 border border-input bg-background p-3 text-sm"
                                        disabled={!feedTriggerLlmEnabled}
                                        onChange={(event) => setFeedConditionPrompt(event.target.value)}
                                        placeholder="Example: Alert me when the item is about a confirmed order win, large contract, or new customer mandate."
                                        value={feedConditionPrompt}
                                    />
                                </Label>
                                <HelpText>
                                    {feedTriggerLlmEnabled
                                        ? "The trigger model returns strict JSON with match, reason, confidence, and matched terms. Optional post-trigger LLM analysis below still runs separately."
                                        : "This is only used when trigger LLM is enabled. Category and scope filters still work without it."}
                                </HelpText>
                            </div>
                            <div className="grid gap-3 min-[720px]:grid-cols-3">
                                <Input
                                    onChange={(event) => setFeedTemperature(event.target.value)}
                                    placeholder="Trigger temperature"
                                    value={feedTemperature}
                                />
                                <Input
                                    onChange={(event) => setFeedMaxTokens(event.target.value)}
                                    placeholder="Trigger max tokens"
                                    value={feedMaxTokens}
                                />
                                <Input
                                    onChange={(event) => setFeedTimeout(event.target.value)}
                                    placeholder="Trigger timeout seconds"
                                    value={feedTimeout}
                                />
                            </div>
                        </div>
                    ) : (
                        <div
                            className={cn(
                                "grid gap-4",
                                hasPreviewTarget
                                    ? "min-[1280px]:grid-cols-[minmax(560px,0.95fr)_minmax(520px,0.9fr)] min-[1280px]:items-start"
                                    : "max-w-5xl"
                            )}
                        >
                            <div className="rounded-lg border border-border p-3">
                                <StepHeader
                                    step={targetStep}
                                    title="Target"
                                    description="The workflow can target one symbol, a shared symbol list, or a watchlist-backed universe under the same rules."
                                    action={
                                        <Label className="grid max-w-[280px] gap-2 text-sm">
                                            <FieldLabel>Target mode</FieldLabel>
                                            <SimpleSelect
                                                className="h-9 border border-input bg-background px-3 text-sm"
                                                onValueChange={(nextModeValue) => {
                                                    const nextMode = nextModeValue as AlertWorkflowTargeting["mode"];
                                                    setTargetMode(nextMode);
                                                    if (nextMode === "symbol_list" && targetEntries.length) {
                                                        const [firstTarget] = targetEntries;
                                                        setSymbol(firstTarget.symbol);
                                                        setExchange(firstTarget.exchange ?? "NSE");
                                                        setInstrumentRef(firstTarget.instrument_ref);
                                                        setSelectedSearchLabel(targetDisplay(firstTarget));
                                                        setSymbolSearch("");
                                                    } else if (nextMode === "symbol_list" && !targetEntries.length) {
                                                        const currentTarget = buildTargetEntry(
                                                            symbol,
                                                            exchange,
                                                            activeInstrument
                                                        );
                                                        if (currentTarget) {
                                                            setTargetEntries([currentTarget]);
                                                            setSymbol(currentTarget.symbol);
                                                            setExchange(currentTarget.exchange ?? "NSE");
                                                            setInstrumentRef(currentTarget.instrument_ref);
                                                            setSelectedSearchLabel(targetDisplay(currentTarget));
                                                            setSymbolSearch("");
                                                            setCommittedSymbolSearch("");
                                                        }
                                                    } else if (nextMode === "preset_universe") {
                                                        setSymbol("");
                                                        setInstrumentRef({});
                                                        setSelectedSearchLabel("");
                                                        setSymbolSearch("");
                                                        setCommittedSymbolSearch("");
                                                    } else {
                                                        setSymbolSearch(symbol);
                                                        setCommittedSymbolSearch(symbol);
                                                    }
                                                }}
                                                options={[
                                                    { value: "single_symbol", label: "Single symbol" },
                                                    { value: "symbol_list", label: "Symbol list" },
                                                    { value: "preset_universe", label: "Watchlist universe" }
                                                ]}
                                                value={targetMode}
                                            />
                                        </Label>
                                    }
                                />
                                <div className="grid gap-3">
                                    <Label className="grid max-w-sm gap-2 text-sm">
                                        <FieldLabel>Broker account</FieldLabel>
                                        <SimpleSelect
                                            className="h-9 border border-input bg-background px-3 text-sm"
                                            onValueChange={setAccountId}
                                            options={accounts.map((account) => ({
                                                value: account.id,
                                                label: `${account.label} · ${account.broker_code}`
                                            }))}
                                            value={accountId}
                                        />
                                        <HelpText>
                                            The broker account decides which instrument universe and quote API will be
                                            used.
                                        </HelpText>
                                    </Label>
                                    {targetMode !== "preset_universe" ? (
                                        <div className="grid max-w-3xl items-start gap-x-3 gap-y-2 min-[760px]:grid-cols-[minmax(0,1fr)_120px]">
                                            <div className="relative grid content-start gap-2" ref={symbolWrapRef}>
                                                <Label className="grid content-start gap-2 text-sm">
                                                    <FieldLabel>Search symbol</FieldLabel>
                                                    <Input
                                                        aria-activedescendant={
                                                            activeSuggestionIndex >= 0
                                                                ? `workflow-symbol-suggestion-${activeSuggestionIndex}`
                                                                : undefined
                                                        }
                                                        aria-autocomplete="list"
                                                        aria-controls="workflow-symbol-suggestions"
                                                        aria-expanded={
                                                            showSuggestions && suggestions.length ? "true" : "false"
                                                        }
                                                        className="h-10"
                                                        onChange={(event) => {
                                                            const nextValue = event.target.value.toUpperCase();
                                                            setSymbolSearch(nextValue);
                                                            setCommittedSymbolSearch("");
                                                            if (targetMode === "single_symbol") {
                                                                setSymbol(nextValue);
                                                                setInstrumentRef({ symbol: nextValue, exchange });
                                                            }
                                                            setSelectedSearchLabel("");
                                                            setShowSuggestions(true);
                                                        }}
                                                        onFocus={() => {
                                                            if (suggestions.length) {
                                                                setShowSuggestions(true);
                                                            }
                                                        }}
                                                        onKeyDown={handleSymbolSearchKeyDown}
                                                        placeholder="Search symbol"
                                                        role="combobox"
                                                        title="Start typing to search the synced broker instrument master for live suggestions."
                                                        value={symbolSearch}
                                                    />
                                                </Label>
                                                {showSuggestions && suggestions.length ? (
                                                    <div
                                                        className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[280px] overflow-y-auto rounded-lg border border-border bg-background"
                                                        id="workflow-symbol-suggestions"
                                                        role="listbox"
                                                    >
                                                        {suggestions.map((row, index) => {
                                                            const metadata =
                                                                suggestionMetadata[row.symbol.trim().toUpperCase()];
                                                            const detail = [
                                                                metadata?.company_name ?? row.name,
                                                                row.trading_symbol,
                                                                row.account_label
                                                            ]
                                                                .filter(Boolean)
                                                                .join(" / ");
                                                            return (
                                                                <button
                                                                    aria-selected={index === activeSuggestionIndex}
                                                                    className={cn(
                                                                        "flex min-h-[58px] w-full items-center justify-between gap-3 border-b border-l-2 border-border px-3 py-2 text-left text-sm normal-case tracking-normal text-foreground transition-colors last:border-b-0 hover:bg-[var(--accent-glow)] focus-visible:border-ring focus-visible:outline-none",
                                                                        index === activeSuggestionIndex &&
                                                                            "border-l-primary bg-[var(--accent-glow)]"
                                                                    )}
                                                                    id={`workflow-symbol-suggestion-${index}`}
                                                                    key={[
                                                                        row.symbol,
                                                                        row.exchange,
                                                                        row.trading_symbol,
                                                                        index
                                                                    ].join(":")}
                                                                    onClick={() => selectSuggestion(row)}
                                                                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                                                                    role="option"
                                                                    type="button"
                                                                >
                                                                    <span className="flex min-w-0 items-center gap-3">
                                                                        {metadata?.logo ? (
                                                                            <img
                                                                                alt=""
                                                                                className="size-8 shrink-0 object-contain"
                                                                                src={metadata.logo}
                                                                            />
                                                                        ) : (
                                                                            <span className="flex size-8 shrink-0 items-center justify-center font-mono text-[10px] font-semibold uppercase text-muted-foreground">
                                                                                {row.symbol.slice(0, 2)}
                                                                            </span>
                                                                        )}
                                                                        <span className="min-w-0">
                                                                            <span className="block truncate font-mono text-sm font-semibold leading-5">
                                                                                {row.symbol}
                                                                            </span>
                                                                            <span className="block truncate text-[12px] leading-4 text-muted-foreground">
                                                                                {detail}
                                                                            </span>
                                                                        </span>
                                                                    </span>
                                                                    <span className="shrink-0 font-mono text-[11px] uppercase leading-4 text-primary">
                                                                        {[row.exchange, row.instrument_type]
                                                                            .filter(Boolean)
                                                                            .join(" / ")}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <Label className="grid content-start gap-2 text-sm">
                                                <FieldLabel>Exchange</FieldLabel>
                                                <Input
                                                    className="h-10"
                                                    onChange={(event) => {
                                                        setExchange(event.target.value.toUpperCase());
                                                        setInstrumentRef((current) => ({
                                                            ...current,
                                                            exchange: event.target.value.toUpperCase()
                                                        }));
                                                    }}
                                                    placeholder="Exchange"
                                                    title="Usually NSE or BSE. Kept editable in case the selected trading symbol exists on multiple exchanges."
                                                    value={exchange}
                                                />
                                            </Label>
                                            <HelpText className="min-[760px]:col-span-2">
                                                {searchLoading
                                                    ? "Searching instruments..."
                                                    : selectedSearchLabel ||
                                                      "Type a symbol name or trading symbol and choose a suggestion. Exchange is used with the selected instrument identifiers for market data requests."}
                                            </HelpText>
                                        </div>
                                    ) : null}
                                    {targetMode === "symbol_list" ? (
                                        <div className="mt-4 overflow-hidden rounded-lg border border-border">
                                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                                                <div>
                                                    <SectionTitle>Target list</SectionTitle>
                                                    <HelpText>
                                                        Search adds symbols directly. Bulk import is available for
                                                        paste-heavy edits.
                                                    </HelpText>
                                                </div>
                                                {targetEntries.length ? (
                                                    <Button
                                                        onClick={clearTargets}
                                                        size="sm"
                                                        type="button"
                                                        variant="destructive"
                                                    >
                                                        Clear list
                                                    </Button>
                                                ) : null}
                                            </div>
                                            <div className="grid gap-4 p-4 min-[920px]:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)]">
                                                <div className="grid content-start gap-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <div>
                                                            <div className="type-step-eyebrow">
                                                                Current targets · {targetEntries.length}
                                                            </div>
                                                            <HelpText className="mt-1">
                                                                Selected symbols keep their broker identifiers and
                                                                available company metadata.
                                                            </HelpText>
                                                        </div>
                                                    </div>
                                                    <div className="grid max-h-[360px] gap-2 overflow-auto pr-1">
                                                        {targetEntries.map((entry, index) => {
                                                            const fetchedMetadata =
                                                                targetMetadata[entry.symbol.toUpperCase()];
                                                            const metadata: Record<string, unknown> = {
                                                                ...entry.metadata,
                                                                ...(fetchedMetadata ?? {})
                                                            };
                                                            const logo = stringValue(metadata.logo);
                                                            const companyName =
                                                                stringValue(metadata.company_name) ??
                                                                entry.label ??
                                                                "Company metadata unavailable";
                                                            const industry =
                                                                stringValue(metadata.basic_industry) ??
                                                                stringValue(metadata.industry) ??
                                                                stringValue(metadata.theme);
                                                            const sector =
                                                                stringValue(metadata.sector) ??
                                                                stringValue(metadata.macro_economic_indicator);
                                                            const tradingSymbol = stringValue(metadata.trading_symbol);
                                                            const instrumentType = stringValue(
                                                                metadata.instrument_type
                                                            );
                                                            const segment = stringValue(metadata.segment);
                                                            const marketCap = formatMarketCap(
                                                                numberValue(metadata.market_cap)
                                                            );
                                                            const isActiveTarget =
                                                                `${entry.symbol}:${entry.exchange ?? ""}` ===
                                                                previewTargetKey;
                                                            return (
                                                                <div
                                                                    className={cn(
                                                                        "group grid gap-3 rounded-lg border bg-background px-3 py-3 min-[640px]:grid-cols-[minmax(0,1fr)_auto]",
                                                                        isActiveTarget
                                                                            ? "border-primary bg-[var(--accent-glow)]"
                                                                            : "border-border"
                                                                    )}
                                                                    key={`${entry.symbol}:${entry.exchange ?? ""}:${index}`}
                                                                >
                                                                    <button
                                                                        className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] items-center gap-3 text-left"
                                                                        onClick={() => loadTarget(entry)}
                                                                        type="button"
                                                                    >
                                                                        {logo ? (
                                                                            <img
                                                                                alt=""
                                                                                className="size-10 shrink-0 object-contain"
                                                                                src={logo}
                                                                            />
                                                                        ) : (
                                                                            <span className="flex size-10 shrink-0 items-center justify-center font-mono text-[11px] font-semibold uppercase text-muted-foreground">
                                                                                {entry.symbol.slice(0, 2)}
                                                                            </span>
                                                                        )}
                                                                        <span className="min-w-0">
                                                                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                                                <span className="font-mono text-[15px] font-semibold leading-5 text-foreground">
                                                                                    {entry.symbol}
                                                                                </span>
                                                                                <span className="font-mono text-[11px] uppercase leading-4 text-primary">
                                                                                    {entry.exchange ?? "-"}
                                                                                </span>
                                                                                {instrumentType ? (
                                                                                    <span className="font-mono text-[11px] uppercase leading-4 text-muted-foreground">
                                                                                        {instrumentType}
                                                                                    </span>
                                                                                ) : null}
                                                                            </span>
                                                                            <span className="block truncate text-sm font-medium leading-5 text-foreground">
                                                                                {companyName}
                                                                            </span>
                                                                            <span className="block truncate text-[12px] leading-4 text-muted-foreground">
                                                                                {[industry, sector]
                                                                                    .filter(Boolean)
                                                                                    .join(" · ") ||
                                                                                    "No sector metadata"}
                                                                            </span>
                                                                        </span>
                                                                    </button>
                                                                    <div className="flex flex-wrap items-center justify-between gap-3 min-[640px]:justify-end">
                                                                        <div className="grid gap-1 text-left min-[640px]:text-right">
                                                                            <div className="font-mono text-[11px] uppercase leading-4 text-muted-foreground">
                                                                                {[tradingSymbol, segment]
                                                                                    .filter(Boolean)
                                                                                    .join(" · ") || "Broker ref stored"}
                                                                            </div>
                                                                            <div className="font-mono text-[11px] uppercase leading-4 text-muted-foreground">
                                                                                MCap {marketCap}
                                                                            </div>
                                                                        </div>
                                                                        <Button
                                                                            onClick={() => removeTarget(index)}
                                                                            size="sm"
                                                                            type="button"
                                                                            variant="destructive"
                                                                        >
                                                                            Remove
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        {!targetEntries.length ? (
                                                            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                                                                Search above and select a suggestion to add the first
                                                                target.
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div className="grid content-start gap-2 border-t border-border pt-4 min-[920px]:border-l min-[920px]:border-t-0 min-[920px]:pl-4 min-[920px]:pt-0">
                                                    <FieldLabel>Bulk import</FieldLabel>
                                                    <Textarea
                                                        className="min-h-[108px] w-full border border-input bg-background px-3 py-2 text-sm outline-none"
                                                        onChange={(event) =>
                                                            setBulkTargets(event.target.value.toUpperCase())
                                                        }
                                                        placeholder={targetListExample}
                                                        value={bulkTargets}
                                                    />
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <HelpText>
                                                            Use one per line. Accepted forms: `RELIANCE`, `RELIANCE
                                                            NSE`, `RELIANCE:NSE`.
                                                        </HelpText>
                                                        <Button onClick={importBulkTargets} type="button">
                                                            Import symbols
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}
                                    {targetMode === "preset_universe" ? (
                                        <div className="mt-4 overflow-hidden rounded-lg border border-border">
                                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                                                <div>
                                                    <SectionTitle>Watchlist universe</SectionTitle>
                                                    <HelpText>
                                                        Choose a watchlist-backed symbol source. The resolved symbols
                                                        stay synced as that watchlist changes.
                                                    </HelpText>
                                                </div>
                                                <div className="type-step-eyebrow">{`${universeSymbols.length} resolved`}</div>
                                            </div>
                                            <div className="grid gap-4 p-4 min-[980px]:grid-cols-[minmax(280px,0.86fr)_minmax(0,1.14fr)]">
                                                <div className="grid content-start gap-4">
                                                    <div className="grid gap-2">
                                                        <FieldLabel>Watchlist</FieldLabel>
                                                        <SimpleSelect
                                                            className="h-10 border border-input bg-background px-3 text-sm"
                                                            onValueChange={(nextWatchlistId) => {
                                                                const nextWatchlist = watchlists.find(
                                                                    (watchlist) => watchlist.id === nextWatchlistId
                                                                );
                                                                const firstItem = nextWatchlist?.items[0];
                                                                setSelectedWatchlistId(nextWatchlistId);
                                                                if (firstItem) {
                                                                    loadUniverseTarget({
                                                                        symbol: firstItem.symbol,
                                                                        exchange: firstItem.exchange,
                                                                        instrument_ref: firstItem.instrument_ref,
                                                                        source_label: nextWatchlist?.name,
                                                                        source_type: "watchlist"
                                                                    });
                                                                } else {
                                                                    setSymbol("");
                                                                    setInstrumentRef({});
                                                                    setSelectedSearchLabel("");
                                                                    setSymbolSearch("");
                                                                    setCommittedSymbolSearch("");
                                                                }
                                                            }}
                                                            options={watchlists.map((watchlist) => ({
                                                                value: watchlist.id,
                                                                label: `${watchlist.name} · ${watchlist.items.length} symbols`
                                                            }))}
                                                            placeholder="Select watchlist"
                                                            value={selectedWatchlistId}
                                                        />
                                                        {!watchlists.length ? (
                                                            <HelpText>
                                                                Create a watchlist first, then return here to link it to
                                                                this workflow.
                                                            </HelpText>
                                                        ) : (
                                                            <HelpText>
                                                                Live subscriptions follow additions and removals in this
                                                                watchlist.
                                                            </HelpText>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="grid content-start gap-3 border-t border-border pt-4 min-[980px]:border-l min-[980px]:border-t-0 min-[980px]:pl-4 min-[980px]:pt-0">
                                                    <div>
                                                        <div className="type-step-eyebrow">
                                                            Resolved symbols · {universeSymbols.length}
                                                        </div>
                                                        <HelpText className="mt-1">
                                                            {`${universeSymbols.length} symbol${universeSymbols.length === 1 ? "" : "s"} from ${selectedWatchlist?.name ?? "watchlist"}.`}
                                                        </HelpText>
                                                    </div>
                                                    <div className="grid max-h-[420px] gap-2 overflow-auto pr-1">
                                                        {universeSymbols.map((item) => {
                                                            const key = `${item.symbol}:${item.exchange ?? ""}`;
                                                            const metadata =
                                                                universeMetadata[item.symbol.trim().toUpperCase()];
                                                            const logo = metadata?.logo ?? null;
                                                            const companyName =
                                                                metadata?.company_name ??
                                                                item.source_label ??
                                                                "Company metadata unavailable";
                                                            const industry =
                                                                metadata?.basic_industry ??
                                                                metadata?.industry ??
                                                                metadata?.theme;
                                                            const sector =
                                                                metadata?.sector ?? metadata?.macro_economic_indicator;
                                                            const isQuoteActive = hoveredSymbolKey === key;
                                                            const isActiveTarget = key === previewTargetKey;
                                                            return (
                                                                <button
                                                                    className={cn(
                                                                        "grid min-h-[64px] grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:border-primary hover:bg-[var(--accent-glow)] focus-visible:border-primary focus-visible:outline-none",
                                                                        isActiveTarget
                                                                            ? "border-primary bg-[var(--accent-glow)]"
                                                                            : "border-border"
                                                                    )}
                                                                    key={key}
                                                                    onFocus={() => loadSymbolQuote(item)}
                                                                    onClick={() => loadUniverseTarget(item)}
                                                                    onMouseEnter={() => loadSymbolQuote(item)}
                                                                    onMouseLeave={() => setHoveredSymbolKey("")}
                                                                    type="button"
                                                                >
                                                                    {logo ? (
                                                                        <img
                                                                            alt=""
                                                                            className="size-10 shrink-0 object-contain"
                                                                            src={logo}
                                                                        />
                                                                    ) : (
                                                                        <span className="flex size-10 shrink-0 items-center justify-center font-mono text-[11px] font-semibold uppercase text-muted-foreground">
                                                                            {item.symbol.slice(0, 2)}
                                                                        </span>
                                                                    )}
                                                                    <span className="min-w-0">
                                                                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                                            <span className="font-mono text-[15px] font-semibold leading-5 text-foreground">
                                                                                {item.symbol}
                                                                            </span>
                                                                            <span className="font-mono text-[11px] uppercase leading-4 text-primary">
                                                                                {item.exchange ?? "-"}
                                                                            </span>
                                                                        </span>
                                                                        <span className="block truncate text-sm font-medium leading-5 text-foreground">
                                                                            {companyName}
                                                                        </span>
                                                                        <span className="block truncate text-[12px] leading-4 text-muted-foreground">
                                                                            {[industry, sector]
                                                                                .filter(Boolean)
                                                                                .join(" · ") ||
                                                                                item.source_type ||
                                                                                "Universe symbol"}
                                                                        </span>
                                                                    </span>
                                                                    <span className="grid min-w-[88px] justify-items-end gap-1">
                                                                        <span className="font-mono text-[11px] uppercase leading-4 text-muted-foreground">
                                                                            {item.source_type ?? "watchlist"}
                                                                        </span>
                                                                        <span className="font-mono text-[12px] leading-4 text-primary">
                                                                            {isQuoteActive
                                                                                ? hoverQuoteLoading
                                                                                    ? "Loading"
                                                                                    : (hoverQuote?.ltp ?? "No quote")
                                                                                : formatMarketCap(
                                                                                      metadata?.market_cap ?? null
                                                                                  )}
                                                                        </span>
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                        {!universeSymbols.length ? (
                                                            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                                                                No symbols resolved for this universe yet.
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            {hasPreviewTarget ? (
                                <div className="rounded-lg border border-border p-4 min-[1280px]:sticky min-[1280px]:top-4">
                                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                        <div className="max-w-[760px]">
                                            <h2 className="text-xl font-heading font-semibold leading-6 tracking-tight text-foreground">
                                                Validate target
                                            </h2>
                                            <HelpText className="mt-1.5">
                                                Preview the selected symbol, broker mapping, and latest market snapshot
                                                before building alert rules.
                                            </HelpText>
                                        </div>
                                        <div className="inline-flex rounded-lg border border-border p-1">
                                            <Button
                                                className={
                                                    previewMode === "summary"
                                                        ? "bg-secondary text-foreground"
                                                        : "text-muted-foreground"
                                                }
                                                onClick={() => setPreviewMode("summary")}
                                                size="sm"
                                                type="button"
                                                variant="ghost"
                                            >
                                                Summary
                                            </Button>
                                            <Button
                                                className={
                                                    previewMode === "raw"
                                                        ? "bg-secondary text-foreground"
                                                        : "text-muted-foreground"
                                                }
                                                onClick={() => setPreviewMode("raw")}
                                                size="sm"
                                                type="button"
                                                variant="ghost"
                                            >
                                                Raw
                                            </Button>
                                        </div>
                                    </div>
                                    {displayedPreview.error ? (
                                        <div className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--danger)]">
                                            {displayedPreview.error}
                                        </div>
                                    ) : null}
                                    {previewMode === "summary" ? (
                                        <LivePreviewSummary
                                            exchange={exchange}
                                            metadata={selectedSymbolMetadata}
                                            preview={displayedPreview}
                                            symbol={symbol}
                                        />
                                    ) : (
                                        <div className=" rounded-lg border border-border p-3">
                                            <div className="type-step-eyebrow">Raw payload</div>
                                            <pre className="type-meta mt-2 max-h-[320px] overflow-auto">
                                                {compactPreview({
                                                    quote: displayedPreview.quote,
                                                    ohlc: displayedPreview.ohlc
                                                })}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid max-w-5xl gap-2 rounded-lg border border-border p-3">
                <StepHeader
                    className="mb-0"
                    step={marketCapStep}
                    title="Market cap filter"
                    description={
                        workflowType === "alpha_feed"
                            ? "Custom ranges reject feed items before category checks or trigger-LLM classification. Leave it on all market caps to skip the check entirely."
                            : "Custom ranges are checked only after the rule conditions match. Leave it on all market caps to avoid any extra market cap lookup."
                    }
                />
                <div className="grid gap-3">
                    <div>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground">{marketCapRangeSummary}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {MARKET_CAP_PRESETS.map((preset) => {
                                const isActive = activeMarketCapPreset === preset.id;
                                return (
                                    <Button
                                        className={cn(
                                            "h-8 min-w-0 rounded-full px-3 text-[11px]",
                                            isActive && "border-primary"
                                        )}
                                        key={preset.id}
                                        onClick={() => chooseMarketCapPreset(preset)}
                                        size="sm"
                                        type="button"
                                        variant={isActive ? "default" : "secondary"}
                                    >
                                        {preset.label}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                    <div
                        className={cn(
                            "grid gap-4 rounded-lg border border-border bg-secondary/20 p-4 transition-opacity",
                            marketCapMode !== "custom" && "opacity-55"
                        )}
                    >
                        <div className="grid gap-3">
                            <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {MARKET_CAP_SLIDER_LABELS.map((label) => (
                                    <span key={label}>{label}</span>
                                ))}
                            </div>
                            <div className="relative h-8">
                                <div
                                    className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full"
                                    style={marketCapRangeTrackStyle}
                                />
                                <input
                                    aria-label="Minimum market cap"
                                    className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-1 w-full -translate-y-1/2 appearance-none bg-transparent accent-primary disabled:cursor-not-allowed [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-track]:bg-transparent"
                                    disabled={marketCapMode !== "custom"}
                                    max={MARKET_CAP_SLIDER_MAX}
                                    min={MARKET_CAP_SLIDER_MIN}
                                    onChange={(event) => updateMarketCapSlider("min", event.target.value)}
                                    step={MARKET_CAP_SLIDER_STEP}
                                    type="range"
                                    value={marketCapRangeStartSliderValue}
                                />
                                <input
                                    aria-label="Maximum market cap"
                                    className="pointer-events-none absolute inset-x-0 top-1/2 z-20 h-1 w-full -translate-y-1/2 appearance-none bg-transparent accent-primary disabled:cursor-not-allowed [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-track]:bg-transparent"
                                    disabled={marketCapMode !== "custom"}
                                    max={MARKET_CAP_SLIDER_MAX}
                                    min={MARKET_CAP_SLIDER_MIN}
                                    onChange={(event) => updateMarketCapSlider("max", event.target.value)}
                                    step={MARKET_CAP_SLIDER_STEP}
                                    type="range"
                                    value={marketCapRangeEndSliderValue}
                                />
                            </div>
                        </div>
                        <div className="grid min-w-0 gap-3 min-[640px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[640px]:items-end">
                            <Label className="grid gap-2 text-sm">
                                <FieldLabel>From</FieldLabel>
                                <Input
                                    className="h-9 text-sm"
                                    disabled={marketCapMode !== "custom"}
                                    inputMode="decimal"
                                    max={MARKET_CAP_RANGE_MAX}
                                    min={MARKET_CAP_RANGE_MIN}
                                    onBlur={() => normalizeMarketCapInput("min")}
                                    onChange={(event) => updateMarketCapInput("min", event.target.value)}
                                    placeholder="500 Cr"
                                    step={100}
                                    type="number"
                                    value={marketCapMin}
                                />
                            </Label>
                            <span className="hidden pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground min-[640px]:block">
                                to
                            </span>
                            <Label className="grid gap-2 text-sm">
                                <FieldLabel>To</FieldLabel>
                                <Input
                                    className="h-9 text-sm"
                                    disabled={marketCapMode !== "custom"}
                                    inputMode="decimal"
                                    max={MARKET_CAP_RANGE_MAX}
                                    min={MARKET_CAP_RANGE_MIN}
                                    onBlur={() => normalizeMarketCapInput("max")}
                                    onChange={(event) => updateMarketCapInput("max", event.target.value)}
                                    placeholder="20L Cr"
                                    step={100}
                                    type="number"
                                    value={marketCapMax}
                                />
                            </Label>
                        </div>
                    </div>
                    <HelpText>
                        {marketCapMode === "custom"
                            ? "Drag the range or type exact values in crores. Symbols outside this range are skipped."
                            : "No market cap check runs in the backend when all market caps are allowed."}
                    </HelpText>
                    <HelpText>
                        Custom mode uses cached Drishti symbol metadata first and falls back to the developer API only
                        when market cap is missing locally.
                    </HelpText>
                </div>
            </div>

            <div className="max-w-5xl">
                <div className="grid gap-3 rounded-lg border border-border p-3">
                    <div className="max-w-[760px]">
                        <div className="type-step-eyebrow">{buildTriggerStep}</div>
                        <h2 className="mt-1 text-xl font-heading font-semibold leading-6 tracking-tight text-foreground">Build trigger</h2>
                        <HelpText className="mt-1.5">
                            Start with the rule logic first, then refine the outgoing alert content underneath it.
                        </HelpText>
                    </div>
                    <RuleEditor
                        addCondition={addCondition}
                        applyMessageField={applyMessageField}
                        combine={combine}
                        conditions={conditions}
                        cooldownSeconds={cooldownSeconds}
                        filteredMessageFields={filteredMessageFields}
                        handleMessageTemplateKeyDown={handleMessageTemplateKeyDown}
                        level={level}
                        applySuggestedCopy={() => {
                            setTitleTemplate(suggestedCopy.title);
                            setMessageTemplate(suggestedCopy.message);
                        }}
                        currentTemplatesMatchSuggestion={currentTemplatesMatchSuggestion}
                        messageFieldIndex={messageFieldIndex}
                        messageFieldListRef={messageFieldListRef}
                        messageFieldPosition={messageFieldPosition}
                        messageTemplate={messageTemplate}
                        messageInputRef={messageInputRef}
                        messageTemplateWrapRef={messageTemplateWrapRef}
                        onMessageTemplateBlur={() =>
                            window.setTimeout(() => {
                                setShowMessageFieldSuggestions(false);
                                setMessageFieldPosition(null);
                            }, 120)
                        }
                        removeCondition={removeCondition}
                        setCombine={updateCombine}
                        setCooldownSeconds={setCooldownSeconds}
                        setLevel={setLevel}
                        setTitleTemplate={setTitleTemplate}
                        showMessageFieldSuggestions={showMessageFieldSuggestions}
                        suggestedCopy={suggestedCopy}
                        titleTemplate={titleTemplate}
                        updateMessageTemplate={updateMessageTemplate}
                        updateCondition={updateCondition}
                    />
                </div>
            </div>

            <div className="grid max-w-5xl gap-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-[760px]">
                        <div className="type-step-eyebrow">{optionalAnalysisStep}</div>
                        <h2 className="mt-1 text-xl font-heading font-semibold leading-6 tracking-tight text-foreground">Optional analysis</h2>
                        <HelpText className="mt-1.5">
                            Post-trigger analysis is optional and stays tucked away until you need it.
                        </HelpText>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={llmEnabled}
                                onCheckedChange={(checked) => setLlmEnabled(Boolean(checked))}
                            />
                            Enable
                        </Label>
                    </div>
                </div>
                <>
                    <div className="grid max-w-3xl gap-3 min-[900px]:grid-cols-[180px_180px_80px_90px_80px]">
                        <div className="grid gap-2">
                            <SimpleSelect
                                className="h-10 border border-input bg-background px-3 text-sm"
                                disabled={!llmEnabled || !llmProviders.length}
                                onValueChange={(nextProvider) => setLlmProvider(nextProvider as LlmProvider | "")}
                                options={llmProviders.map((provider) => ({
                                    value: provider.provider,
                                    label: `${provider.label}${provider.has_api_key && provider.is_enabled ? "" : " · configure key"}`,
                                    disabled: !provider.has_api_key || !provider.is_enabled
                                }))}
                                placeholder="Select provider"
                                value={llmProvider}
                            />
                            <HelpText>Uses the encrypted provider key from Settings.</HelpText>
                        </div>
                        <div className="grid gap-2">
                            {llmProvider ? (
                                <LlmModelPicker
                                    allowedModels={selectedLlmModels}
                                    disabled={!llmEnabled}
                                    models={openRouterModels}
                                    onSelect={(id) => setLlmModelId(id)}
                                    provider={llmProvider}
                                    value={llmModelId}
                                />
                            ) : (
                                <SimpleSelect
                                    className="h-10 border border-input bg-background px-3 text-sm"
                                    disabled
                                    onValueChange={setLlmModelId}
                                    options={selectedLlmModels.map((model) => ({
                                        value: model.model_id,
                                        label: model.label || model.model_id
                                    }))}
                                    placeholder="Select model"
                                    value={llmModelId}
                                />
                            )}
                            <HelpText>Saved enabled models for the selected provider.</HelpText>
                        </div>
                        <div className="grid gap-2">
                            <Input
                                className="max-w-[96px]"
                                disabled={!llmEnabled}
                                onChange={(event) => setLlmTemperature(event.target.value)}
                                placeholder="0.2"
                                value={llmTemperature}
                            />
                            <HelpText>Temperature.</HelpText>
                        </div>
                        <div className="grid gap-2">
                            <Input
                                className="max-w-[110px]"
                                disabled={!llmEnabled}
                                onChange={(event) => setLlmMaxTokens(event.target.value)}
                                placeholder="500"
                                value={llmMaxTokens}
                            />
                            <HelpText>Max tokens.</HelpText>
                        </div>
                        <div className="grid gap-2">
                            <Input
                                className="max-w-[96px]"
                                disabled={!llmEnabled}
                                onChange={(event) => setLlmTimeout(event.target.value)}
                                placeholder="25"
                                value={llmTimeout}
                            />
                            <HelpText>Timeout sec.</HelpText>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="inline-flex rounded-lg border border-border p-1">
                            <Button
                                className={
                                    llmPromptTab === "prompt" ? "bg-secondary text-foreground" : "text-muted-foreground"
                                }
                                onClick={() => setLlmPromptTab("prompt")}
                                size="sm"
                                type="button"
                                variant="ghost"
                            >
                                Prompt
                            </Button>
                            <Button
                                className={
                                    llmPromptTab === "preview"
                                        ? "bg-secondary text-foreground"
                                        : "text-muted-foreground"
                                }
                                disabled={isPending || !persistedWorkflowId || !llmEnabled}
                                onClick={() => requestLlmCreditConfirmation("preview")}
                                size="sm"
                                type="button"
                                variant="ghost"
                            >
                                Context Preview
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                disabled={isPending || !persistedWorkflowId || !llmEnabled}
                                onClick={() => requestLlmCreditConfirmation("test")}
                                size="sm"
                                type="button"
                                variant="secondary"
                            >
                                Test LLM
                            </Button>
                        </div>
                    </div>
                    {llmPromptTab === "prompt" ? (
                        <div className="relative" ref={llmPromptWrapRef}>
                            <Textarea
                                ref={llmPromptInputRef}
                                className="min-h-[160px] w-full border border-input bg-background px-3 py-2 font-mono text-sm outline-none"
                                disabled={!llmEnabled}
                                onBlur={() =>
                                    window.setTimeout(() => {
                                        setShowLlmSuggestions(false);
                                        setLlmSuggestionPosition(null);
                                    }, 120)
                                }
                                onChange={(event) => {
                                    setLlmPromptTemplate(event.target.value);
                                    updateLlmPromptAutocomplete(
                                        event.target.value,
                                        event.target.selectionStart ?? event.target.value.length,
                                        false,
                                        event.currentTarget
                                    );
                                }}
                                onClick={(event) =>
                                    updateLlmPromptAutocomplete(
                                        event.currentTarget.value,
                                        event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                        false,
                                        event.currentTarget
                                    )
                                }
                                onKeyDown={(event) => {
                                    if (showLlmSuggestions && filteredLlmPlaceholders.length) {
                                        if (event.key === "ArrowDown") {
                                            event.preventDefault();
                                            setLlmSuggestionIndex(
                                                (current) => (current + 1) % filteredLlmPlaceholders.length
                                            );
                                            return;
                                        }
                                        if (event.key === "ArrowUp") {
                                            event.preventDefault();
                                            setLlmSuggestionIndex(
                                                (current) =>
                                                    (current - 1 + filteredLlmPlaceholders.length) %
                                                    filteredLlmPlaceholders.length
                                            );
                                            return;
                                        }
                                        if (event.key === "Enter" || event.key === "Tab") {
                                            event.preventDefault();
                                            applyLlmSuggestion(
                                                filteredLlmPlaceholders[llmSuggestionIndex] ??
                                                    filteredLlmPlaceholders[0]
                                            );
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
                                        updateLlmPromptAutocomplete(
                                            event.currentTarget.value,
                                            event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                            true,
                                            event.currentTarget
                                        );
                                    }
                                }}
                                onKeyUp={(event) => {
                                    if ((event.ctrlKey || event.metaKey) && event.key === " ") return;
                                    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
                                    updateLlmPromptAutocomplete(
                                        event.currentTarget.value,
                                        event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                        false,
                                        event.currentTarget
                                    );
                                }}
                                onScroll={(event) => {
                                    if (showLlmSuggestions) {
                                        updateLlmPromptAutocomplete(
                                            event.currentTarget.value,
                                            event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                            true,
                                            event.currentTarget
                                        );
                                    }
                                }}
                                onSelect={(event) =>
                                    updateLlmPromptAutocomplete(
                                        event.currentTarget.value,
                                        event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                        false,
                                        event.currentTarget
                                    )
                                }
                                placeholder="Type @ for context placeholders"
                                value={llmPromptTemplate}
                            />
                            {showLlmSuggestions && filteredLlmPlaceholders.length ? (
                                <div
                                    className="absolute z-30 max-h-[220px] overflow-y-auto rounded-lg border border-border bg-background shadow-sm"
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
                            <HelpText>
                                Use `@` placeholders for symbol-scoped API context. Save the workflow before previewing
                                or testing changes.
                            </HelpText>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {llmFeedback ? (
                                <AlertLlmMarkdown className="rounded-lg border border-border px-3 py-2 text-muted-foreground">
                                    {llmFeedback}
                                </AlertLlmMarkdown>
                            ) : null}
                            <pre className="type-meta max-h-[420px] overflow-auto rounded-lg border border-border bg-secondary/20 p-3">
                                {llmDetails ? compactPreview(llmDetails) : "No context preview yet."}
                            </pre>
                        </div>
                    )}
                </>
            </div>

            <div className="grid max-w-5xl gap-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-[760px]">
                        <div className="type-step-eyebrow">{advancedDeploymentStep}</div>
                        <h2 className="mt-1 text-xl font-heading font-semibold leading-6 tracking-tight text-foreground">
                            Advanced script and deployment
                        </h2>
                        <HelpText className="mt-1.5">
                            The script is optional. When present, it is validated by the sandboxed expression compiler
                            and overrides the visual logic in the compiled workflow AST.
                        </HelpText>
                    </div>
                </div>
                <>
                    <div className="relative">
                        <Textarea
                            className="min-h-[120px] w-full border border-input bg-background px-3 py-2 font-mono text-sm outline-none"
                            onBlur={() => window.setTimeout(() => setShowDslSuggestions(false), 120)}
                            onChange={(event) => {
                                setDslText(event.target.value);
                                updateDslAutocomplete(
                                    event.target.value,
                                    event.target.selectionStart ?? event.target.value.length
                                );
                            }}
                            onClick={(event) =>
                                updateDslAutocomplete(
                                    event.currentTarget.value,
                                    event.currentTarget.selectionStart ?? event.currentTarget.value.length
                                )
                            }
                            onKeyDown={(event) => {
                                if ((event.ctrlKey || event.metaKey) && event.key === " ") {
                                    event.preventDefault();
                                    updateDslAutocomplete(
                                        event.currentTarget.value,
                                        event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                        true
                                    );
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
                                        return;
                                    }
                                    if (
                                        dslText.trim() &&
                                        suggestedDsl.startsWith(dslText) &&
                                        dslText !== suggestedDsl
                                    ) {
                                        event.preventDefault();
                                        setDslText(suggestedDsl);
                                    }
                                }
                            }}
                            onKeyUp={(event) =>
                                updateDslAutocomplete(
                                    event.currentTarget.value,
                                    event.currentTarget.selectionStart ?? event.currentTarget.value.length
                                )
                            }
                            placeholder={suggestedDsl}
                            value={dslText}
                        />
                        {showDslSuggestions && dslSuggestions.length ? (
                            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-72 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
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
                                        <span className="text-muted-foreground">
                                            {item.kind} - {item.description}
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <div className="type-meta flex max-w-[820px] flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
                        <div>
                            <span className="font-bold uppercase">Generated from visual logic:</span>{" "}
                            <code className="font-mono">{suggestedDsl}</code>
                        </div>
                        <Button onClick={() => setDslText(suggestedDsl)} size="sm" type="button" variant="secondary">
                            Use generated script
                        </Button>
                    </div>
                    <HelpText>
                        Use Ctrl+Space for suggestions. Tab accepts the highlighted suggestion; when empty, Tab inserts
                        the generated script from the visual rule builder.
                    </HelpText>
                    <div className="flex max-w-[820px] flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-3">
                        <div>
                            <div className="type-step-eyebrow">Engine actions</div>
                            <HelpText className="mt-1">
                                Run checks against the script and review the resulting state below.
                            </HelpText>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {engineActions.map((item) => {
                                const isRunning = runningEngineAction === item.action;
                                const isLastAction = lastEngineAction === item.action;
                                return (
                                    <Button
                                        aria-pressed={isLastAction}
                                        className={cn(
                                            isLastAction &&
                                                item.variant === "secondary" &&
                                                "border-primary bg-[var(--accent-subtle)] text-primary",
                                            isLastAction && item.variant === "default" && "bg-primary/90",
                                            isRunning && "cursor-wait"
                                        )}
                                        disabled={isPending || !persistedWorkflowId}
                                        key={item.action}
                                        onClick={() => runEngineAction(item.action)}
                                        size="sm"
                                        type="button"
                                        variant={item.variant}
                                    >
                                        {isRunning ? "Running..." : item.label}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="grid max-w-[820px] gap-3 min-[900px]:grid-cols-3">
                        <div className="rounded-lg border border-border p-3">
                            <div className="type-step-eyebrow">Deployment</div>
                            <div className="type-body mt-2 text-muted-foreground">
                                {persistedWorkflow?.deployment_status ?? "draft"} · version{" "}
                                {persistedWorkflow?.deploy_version ?? 0}
                            </div>
                        </div>
                        <div className="rounded-lg border border-border p-3">
                            <div className="type-step-eyebrow">Last validation</div>
                            <div className="type-body mt-2 text-muted-foreground">
                                {persistedWorkflow?.last_validated_at
                                    ? formatIstDateTime(persistedWorkflow.last_validated_at)
                                    : "-"}
                            </div>
                        </div>
                        <div className="rounded-lg border border-border p-3">
                            <div className="type-step-eyebrow">Runtime error</div>
                            <div className="type-body mt-2 text-muted-foreground">
                                {persistedWorkflow?.last_runtime_error || "-"}
                            </div>
                        </div>
                    </div>
                    {engineFeedback || engineDetails ? (
                        <div className="grid max-w-[820px] min-w-0 gap-2">
                            {engineFeedback ? (
                                <div
                                    className={cn(
                                        "flex items-start gap-2",
                                        engineFeedbackTone === "success" ? "text-[var(--success)]" : "text-destructive"
                                    )}
                                >
                                    {engineFeedbackTone === "success" ? (
                                        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                                    ) : (
                                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                    )}
                                    <p className="type-body text-current">{engineFeedback}</p>
                                </div>
                            ) : null}
                            {engineDetails ? (
                                <div className="min-w-0">
                                    <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                                        <FileJson className="size-4 shrink-0" />
                                        <span className="type-step-eyebrow">{engineDetailsLabel}</span>
                                    </div>
                                    <pre className="type-meta max-h-[220px] max-w-full overflow-auto rounded-lg border border-border p-3">
                                        {compactPreview(engineDetails)}
                                    </pre>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </>
            </div>

            <div className="grid max-w-5xl gap-3 rounded-lg border border-border p-3">
                <div>
                    <div className="type-step-eyebrow">{deliveryLifecycleStep}</div>
                    <h2 className="mt-1 text-xl font-heading font-semibold leading-6 tracking-tight text-foreground">Delivery and lifecycle</h2>
                    <HelpText className="mt-1.5">
                        Choose where the alert goes, set the workflow state, and then save or test it.
                    </HelpText>
                </div>
                <div className="grid gap-3 min-[860px]:grid-cols-[240px_minmax(0,1fr)]">
                    <div className="grid gap-3">
                        <div className="rounded-lg border border-border p-3">
                            <SectionTitle className="mb-2">Workflow scope</SectionTitle>
                            <HelpText>{targetScopeSummary(workflowTargetingPayload())}</HelpText>
                        </div>
                        <div className="rounded-lg border border-border p-3">
                            <SectionTitle className="mb-2">Lifecycle</SectionTitle>
                            <HelpText>
                                Active workflows are evaluated by the alert worker. Inactive workflows stay saved but do
                                not trigger.
                            </HelpText>
                            <SimpleSelect
                                className="mt-3 h-9 max-w-[220px] border border-input bg-background px-3 text-sm"
                                onValueChange={(nextStatus) => setStatus(nextStatus as "active" | "inactive")}
                                options={[
                                    { value: "active", label: "Active" },
                                    { value: "inactive", label: "Inactive" }
                                ]}
                                value={status}
                            />
                        </div>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                        <SectionTitle className="mb-2">Channels</SectionTitle>
                        <HelpText>
                            Choose where the alert should be delivered. Inherit defaults uses the alert delivery
                            channels saved in Settings.
                        </HelpText>
                        <div className="mt-3 grid gap-2 text-sm min-[560px]:grid-cols-2">
                            <Label
                                className="flex items-center gap-2"
                                title="Always recommended so alerts remain visible inside the app."
                            >
                                <Checkbox
                                    checked={channelInApp}
                                    onCheckedChange={(checked) => setChannelInApp(Boolean(checked))}
                                />
                                In-app
                            </Label>
                            <Label
                                className="flex items-center gap-2"
                                title="Send through your saved Discord webhook configuration."
                            >
                                <Checkbox
                                    checked={channelDiscord}
                                    onCheckedChange={(checked) => setChannelDiscord(Boolean(checked))}
                                />
                                Discord
                            </Label>
                            <Label
                                className="flex items-center gap-2"
                                title="Send through your saved Telegram bot configuration."
                            >
                                <Checkbox
                                    checked={channelTelegram}
                                    onCheckedChange={(checked) => setChannelTelegram(Boolean(checked))}
                                />
                                Telegram
                            </Label>
                            <Label
                                className="flex items-center gap-2"
                                title="Send generated audio to paired desktop tray apps."
                            >
                                <Checkbox
                                    checked={channelDesktopAudio}
                                    onCheckedChange={(checked) => setChannelDesktopAudio(Boolean(checked))}
                                />
                                Desktop audio
                            </Label>
                            <Label
                                className="flex items-center gap-2"
                                title="When enabled, default alert delivery channels from Settings are included automatically."
                            >
                                <Checkbox
                                    checked={inheritDefaults}
                                    onCheckedChange={(checked) => setInheritDefaults(Boolean(checked))}
                                />
                                Inherit defaults
                            </Label>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button disabled={isPending} onClick={save} type="button">
                        {isPending ? "Saving..." : persistedWorkflowId ? "Save workflow" : "Create workflow"}
                    </Button>
                    {persistedWorkflowId ? (
                        <Button disabled={isPending} onClick={sendTestAlert} type="button" variant="secondary">
                            Send test alert
                        </Button>
                    ) : null}
                    {persistedWorkflowId ? (
                        <Button disabled={isPending} onClick={removeWorkflow} type="button" variant="destructive">
                            Delete workflow
                        </Button>
                    ) : null}
                </div>
                {persistedWorkflowId ? (
                    <div className="type-help grid gap-1 rounded-lg border border-border px-3 py-2 text-muted-foreground">
                        <div>
                            `Send test alert` renders the current title and message templates with the preview payload
                            and attempts delivery through the selected channels.
                        </div>
                    </div>
                ) : null}
            </div>
            <WorkflowAiChatPanel
                currentWorkflowId={persistedWorkflowId || null}
                disabled={workflowType !== "market_data"}
                getEditorPayload={() => workflowPayload() as Record<string, unknown>}
                llmProviders={llmProviders}
                onWorkflowApplied={applyWorkflowToEditor}
                openRouterModels={openRouterModels}
            />
        </div>
    );
}

function LivePreviewSummary({
    symbol,
    exchange,
    metadata,
    preview
}: {
    symbol: string;
    exchange: string;
    metadata: AlphaSymbolMetadata | null;
    preview: PreviewState;
}) {
    const quoteRaw = ((preview.quote?.detail as JsonObject | undefined)?.raw as JsonObject | undefined) ?? {};
    const depth = (quoteRaw.depth as JsonObject | undefined) ?? {};
    const buyDepth = Array.isArray(depth.buy) ? depth.buy.slice(0, 3) : [];
    const sellDepth = Array.isArray(depth.sell) ? depth.sell.slice(0, 3) : [];
    const ltp = displayValue(preview.quote?.ltp);
    const dailyMove = formatDailyMove(quoteRaw.day_change, quoteRaw.day_change_perc);
    const positiveMove = isPositiveMove(quoteRaw.day_change, quoteRaw.day_change_perc);
    const volume = displayValue(quoteRaw.volume);
    const openInterest = displayValue(quoteRaw.open_interest);
    const companyContext = metadata?.company_name
        ? [metadata.company_name, metadata.basic_industry ?? metadata.industry ?? metadata.sector]
              .filter(Boolean)
              .join(" · ")
        : "";
    return (
        <div className="grid max-w-5xl gap-3">
            <div className="grid gap-3 min-[760px]:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.1fr)]">
                <div className="rounded-lg border border-border bg-background p-4">
                    <div className="type-step-eyebrow">Last traded price</div>
                    <div className="mt-3 grid gap-3 min-[520px]:grid-cols-[40px_minmax(0,1fr)]">
                        {metadata?.logo ? (
                            <img alt="" className="mt-1 size-10 shrink-0 object-contain" src={metadata.logo} />
                        ) : (
                            <span className="mt-1 flex size-10 shrink-0 items-center justify-center font-mono text-[11px] font-semibold uppercase text-muted-foreground">
                                {(symbol || "--").slice(0, 2)}
                            </span>
                        )}
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-end gap-2">
                                <div className="font-mono text-4xl font-bold leading-none text-foreground">{ltp}</div>
                                <div className="pb-1 font-mono text-sm uppercase text-muted-foreground">INR</div>
                            </div>
                            <div
                                className={cn(
                                    "mt-2 font-mono text-sm font-semibold",
                                    positiveMove === false ? "text-[var(--danger)]" : "text-[var(--success)]"
                                )}
                            >
                                {dailyMove}
                            </div>
                            <div className="mt-2 font-mono text-xs uppercase text-muted-foreground">
                                {[symbol, exchange].filter(Boolean).join(" · ") || "-"}
                            </div>
                            {companyContext ? (
                                <div className="mt-1 truncate text-xs text-muted-foreground">{companyContext}</div>
                            ) : null}
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                        <PreviewMetric label="Volume" value={volume} />
                        <PreviewMetric label="Open interest" value={openInterest} />
                    </div>
                </div>
                <div className="grid gap-3 min-[620px]:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background p-4">
                        <div className="type-step-eyebrow">OHLC</div>
                        <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                            <PreviewMetric label="Open" value={displayValue(preview.ohlc?.open)} />
                            <PreviewMetric label="High" value={displayValue(preview.ohlc?.high)} />
                            <PreviewMetric label="Low" value={displayValue(preview.ohlc?.low)} />
                            <PreviewMetric label="Close" value={displayValue(preview.ohlc?.close)} />
                            <PreviewMetric label="52w high" value={displayValue(quoteRaw.week_52_high)} />
                            <PreviewMetric label="52w low" value={displayValue(quoteRaw.week_52_low)} />
                        </div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-4">
                        <div className="type-step-eyebrow">Market internals</div>
                        <div className="mt-3 grid gap-3 text-sm">
                            <PreviewMetric label="Total buy qty" value={displayValue(quoteRaw.total_buy_quantity)} />
                            <PreviewMetric label="Total sell qty" value={displayValue(quoteRaw.total_sell_quantity)} />
                            <PreviewMetric label="Last trade qty" value={displayValue(quoteRaw.last_trade_quantity)} />
                            <PreviewMetric label="Last trade time" value={displayValue(quoteRaw.last_trade_time)} />
                            <PreviewMetric label="Upper circuit" value={displayValue(quoteRaw.upper_circuit_limit)} />
                            <PreviewMetric label="Lower circuit" value={displayValue(quoteRaw.lower_circuit_limit)} />
                        </div>
                    </div>
                </div>
            </div>
            <MarketDepth buyRows={buyDepth} sellRows={sellDepth} />
        </div>
    );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[12px] leading-4 text-muted-foreground">{label}</div>
            <div className="truncate font-mono text-sm font-semibold leading-5 text-foreground">{value}</div>
        </div>
    );
}

function depthQuantity(row: unknown): number {
    const item = row as JsonObject;
    return numeric(item.quantity ?? item.qty) ?? 0;
}

function formatDepthTotal(value: number): string {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

function MarketDepth({ buyRows, sellRows }: { buyRows: unknown[]; sellRows: unknown[] }) {
    const buyTotal = buyRows.reduce<number>((sum, row) => sum + depthQuantity(row), 0);
    const sellTotal = sellRows.reduce<number>((sum, row) => sum + depthQuantity(row), 0);
    const total = buyTotal + sellTotal;
    const buyPct = total ? (buyTotal / total) * 100 : 50;
    const sellPct = total ? 100 - buyPct : 50;
    const maxQty = Math.max(1, ...buyRows.map(depthQuantity), ...sellRows.map(depthQuantity));
    return (
        <div className="rounded-lg border border-border bg-background p-4">
            <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <div className="text-muted-foreground">Buy orders</div>
                        <div className="font-mono font-semibold text-foreground">
                            {total ? `${buyPct.toFixed(2)}%` : "-"}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-muted-foreground">Sell orders</div>
                        <div className="font-mono font-semibold text-foreground">
                            {total ? `${sellPct.toFixed(2)}%` : "-"}
                        </div>
                    </div>
                </div>
                <div className="flex h-1 overflow-hidden bg-border">
                    <div className="bg-[var(--success)]" style={{ width: `${buyPct}%` }} />
                    <div className="bg-[var(--danger)]" style={{ width: `${sellPct}%` }} />
                </div>
                <div className="grid gap-6 min-[760px]:grid-cols-2">
                    <DepthColumn maxQty={maxQty} rows={buyRows} side="bid" title="Bid Price" total={buyTotal} />
                    <DepthColumn maxQty={maxQty} rows={sellRows} side="ask" title="Ask Price" total={sellTotal} />
                </div>
            </div>
        </div>
    );
}

function DepthColumn({
    maxQty,
    rows,
    side,
    title,
    total
}: {
    maxQty: number;
    rows: unknown[];
    side: "bid" | "ask";
    title: string;
    total: number;
}) {
    const isBid = side === "bid";
    return (
        <div className="grid content-start gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3 text-[13px] text-muted-foreground">
                <div>{title}</div>
                <div className="text-right">Qty</div>
            </div>
            <div className="grid gap-1">
                {rows.map((row, index) => {
                    const item = row as JsonObject;
                    const quantity = depthQuantity(item);
                    const width = Math.max(4, (quantity / maxQty) * 100);
                    return (
                        <div
                            className="grid min-h-7 grid-cols-[minmax(0,1fr)_112px] items-center gap-3 font-mono text-[13px] leading-4"
                            key={`${title}-${index}`}
                        >
                            <div className="text-foreground">{displayValue(item.price)}</div>
                            <div
                                className={cn(
                                    "relative overflow-hidden px-1 py-1 text-right font-semibold",
                                    isBid ? "text-[var(--success)]" : "text-[var(--danger)]"
                                )}
                            >
                                <span
                                    className={cn(
                                        "absolute inset-y-0 opacity-15",
                                        isBid ? "right-0 bg-[var(--success)]" : "right-0 bg-[var(--danger)]"
                                    )}
                                    style={{ width: `${width}%` }}
                                />
                                <span className="relative">{formatDepthTotal(quantity)}</span>
                            </div>
                        </div>
                    );
                })}
                {!rows.length ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
                        No depth available.
                    </div>
                ) : null}
                {rows.length ? (
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_112px] gap-3 border-t border-border pt-2 text-sm">
                        <div className="font-semibold text-foreground">{isBid ? "Bid Total" : "Ask Total"}</div>
                        <div className="text-right font-mono font-semibold text-foreground">
                            {formatDepthTotal(total)}
                        </div>
                    </div>
                ) : null}
            </div>
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
    applySuggestedCopy,
    currentTemplatesMatchSuggestion,
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
    suggestedCopy,
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
    applySuggestedCopy: () => void;
    currentTemplatesMatchSuggestion: boolean;
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
    suggestedCopy: { title: string; message: string };
    titleTemplate: string;
    updateMessageTemplate: (
        nextValue: string,
        caretPosition?: number,
        force?: boolean,
        textarea?: HTMLTextAreaElement
    ) => void;
    updateCondition: (index: number, patch: Partial<AlertCondition>) => void;
}) {
    return (
        <div className="grid max-w-4xl gap-3">
            <div className="max-w-xl rounded-lg border border-border p-3">
                <SectionTitle className="mb-3">Trigger settings</SectionTitle>
                <div className="grid items-start gap-3 min-[760px]:grid-cols-[150px_120px_120px]">
                    <div className="grid content-start self-start gap-2">
                        <FieldLabel>Match mode</FieldLabel>
                        <SimpleSelect
                            className="h-9 border border-input bg-background px-3 text-sm"
                            onValueChange={(nextCombine) => setCombine(nextCombine as "all" | "any")}
                            options={[
                                { value: "all", label: "All conditions" },
                                { value: "any", label: "Any condition" }
                            ]}
                            value={combine}
                        />
                        <HelpText>
                            `All` means every condition must match. `Any` means one matching condition is enough.
                        </HelpText>
                    </div>
                    <div className="grid content-start self-start gap-2">
                        <FieldLabel>Cooldown</FieldLabel>
                        <Input
                            className="h-9 max-w-[120px] text-sm"
                            onChange={(event) => setCooldownSeconds(event.target.value)}
                            placeholder="Cooldown seconds"
                            title="Minimum wait time before the same workflow can trigger again."
                            value={cooldownSeconds}
                        />
                        <HelpText>Prevents repeated alerts on every tick after the first match.</HelpText>
                    </div>
                    <div className="grid content-start self-start gap-2">
                        <FieldLabel>Level</FieldLabel>
                        <Input
                            className="h-9 max-w-[120px] text-sm"
                            onChange={(event) => setLevel(event.target.value)}
                            placeholder="Level"
                            title="Examples: info, warning, critical."
                            value={level}
                        />
                        <HelpText>Used only for display and downstream routing emphasis.</HelpText>
                    </div>
                </div>
            </div>
            <div className="grid max-w-4xl gap-3">
                {conditions.map((condition, index) => (
                    <div className="rounded-lg border border-border p-3" key={`${condition.field}-${index}`}>
                        <ConditionEditor
                            condition={condition}
                            index={index}
                            removeCondition={removeCondition}
                            updateCondition={updateCondition}
                        />
                    </div>
                ))}
            </div>
            <Button className="max-w-[180px]" onClick={addCondition} type="button">
                <Plus />
                Add condition
            </Button>
            <div className="max-w-4xl rounded-lg border border-border p-3">
                <SectionTitle className="mb-3">Alert content</SectionTitle>
                <div className="grid max-w-3xl gap-3">
                    <div className="grid max-w-[260px] gap-2">
                        <FieldLabel>Title template</FieldLabel>
                        <Input
                            className="h-9 text-sm"
                            onChange={(event) => setTitleTemplate(event.target.value)}
                            placeholder="Title template"
                            value={titleTemplate}
                        />
                        <HelpText>
                            Supports placeholders like {"{symbol}"} and {"{ltp}"}.
                        </HelpText>
                    </div>
                    <div className="grid gap-2">
                        <FieldLabel>Message template</FieldLabel>
                        <div className="relative max-w-[720px]" ref={messageTemplateWrapRef}>
                            <Textarea
                                className="min-h-[84px] w-full border border-input bg-background px-3 py-2 text-sm outline-none"
                                onBlur={onMessageTemplateBlur}
                                onChange={(event) =>
                                    updateMessageTemplate(
                                        event.target.value,
                                        event.target.selectionStart ?? undefined,
                                        false,
                                        event.currentTarget
                                    )
                                }
                                onClick={(event) =>
                                    updateMessageTemplate(
                                        event.currentTarget.value,
                                        event.currentTarget.selectionStart ?? undefined,
                                        false,
                                        event.currentTarget
                                    )
                                }
                                onKeyDown={handleMessageTemplateKeyDown}
                                onKeyUp={(event) => {
                                    if ((event.ctrlKey || event.metaKey) && event.key === " ") return;
                                    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
                                    updateMessageTemplate(
                                        event.currentTarget.value,
                                        event.currentTarget.selectionStart ?? undefined,
                                        false,
                                        event.currentTarget
                                    );
                                }}
                                onScroll={(event) => {
                                    if (showMessageFieldSuggestions) {
                                        updateMessageTemplate(
                                            event.currentTarget.value,
                                            event.currentTarget.selectionStart ?? undefined,
                                            true,
                                            event.currentTarget
                                        );
                                    }
                                }}
                                onSelect={(event) =>
                                    updateMessageTemplate(
                                        event.currentTarget.value,
                                        event.currentTarget.selectionStart ?? undefined,
                                        false,
                                        event.currentTarget
                                    )
                                }
                                placeholder="Message template"
                                ref={messageInputRef}
                                value={messageTemplate}
                            />
                            {showMessageFieldSuggestions && filteredMessageFields.length ? (
                                <div
                                    className="absolute z-30 max-h-[220px] overflow-y-auto rounded-lg border border-border bg-background shadow-sm"
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
                        <HelpText>
                            Type {"{"} to insert any supported live-data or computed field, including price, volume,
                            open-interest, account, connection, and derived change fields.
                        </HelpText>
                        {!currentTemplatesMatchSuggestion ? (
                            <div className="grid max-w-[720px] gap-2 rounded-lg border border-border bg-secondary/20 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <HelpText>Suggested copy based on the current conditions.</HelpText>
                                    <Button onClick={applySuggestedCopy} size="sm" type="button">
                                        Use suggested copy
                                    </Button>
                                </div>
                                <div className="type-body grid gap-1 text-muted-foreground">
                                    <div>
                                        <span className="font-semibold text-foreground">Title:</span>{" "}
                                        {suggestedCopy.title}
                                    </div>
                                    <div>
                                        <span className="font-semibold text-foreground">Message:</span>{" "}
                                        {suggestedCopy.message}
                                    </div>
                                </div>
                            </div>
                        ) : null}
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
    const isRollingOperator = condition.operator.startsWith("rolling_");
    const isSpreadOperator = condition.operator === "spread_lte";
    const isBookRatioOperator =
        condition.operator.startsWith("bid_ask_imbalance") || condition.operator.startsWith("total_buy_sell_ratio");
    const isVolumeOperator = ["volume_spike", "relative_volume_gte", "rolling_volume_spike_gte"].includes(
        condition.operator
    );
    const usesCompareField = !isRollingOperator && !isSpreadOperator && !isBookRatioOperator;
    const config = condition.config ?? {};

    function updateConditionConfig(key: string, value: unknown) {
        const nextConfig = { ...config };
        if (value === null || value === undefined || value === "") {
            delete nextConfig[key];
        } else {
            nextConfig[key] = value;
        }
        updateCondition(index, { config: nextConfig });
    }

    return (
        <div className="grid gap-3">
            <div className="grid max-w-4xl gap-3 [grid-template-columns:repeat(auto-fit,minmax(132px,1fr))]">
                <div className="grid min-w-0 gap-2">
                    <FieldLabel>Field</FieldLabel>
                    <SimpleSelect
                        className="h-9 border border-input bg-background px-3 text-sm"
                        onValueChange={(field) => updateCondition(index, { field })}
                        options={fieldOptions.map((item) => ({
                            value: item.value,
                            label: item.label
                        }))}
                        value={condition.field}
                    />
                </div>
                <div className="grid min-w-0 gap-2">
                    <FieldLabel>Operator</FieldLabel>
                    <SimpleSelect
                        className="h-9 border border-input bg-background px-3 text-sm"
                        onValueChange={(nextOperator) => {
                            const nextConfig = { ...(condition.config ?? {}) };
                            if (nextOperator.startsWith("rolling_")) {
                                nextConfig.baseline = nextConfig.baseline ?? "oldest";
                                nextConfig.min_samples = nextConfig.min_samples ?? 3;
                                nextConfig.min_coverage_ratio = nextConfig.min_coverage_ratio ?? 0.8;
                            }
                            if (nextOperator === "spread_lte") {
                                nextConfig.unit = nextConfig.unit ?? "bps";
                            }
                            updateCondition(
                                index,
                                nextOperator.startsWith("rolling_")
                                    ? {
                                          operator: nextOperator,
                                          compare_to: null,
                                          window_seconds: condition.window_seconds ?? 300,
                                          config: nextConfig
                                      }
                                    : {
                                          operator: nextOperator,
                                          compare_to:
                                              nextOperator === "spread_lte" ||
                                              nextOperator.startsWith("bid_ask_imbalance") ||
                                              nextOperator.startsWith("total_buy_sell_ratio")
                                                  ? null
                                                  : condition.compare_to,
                                          window_seconds: null,
                                          config: nextConfig
                                      }
                            );
                        }}
                        options={operatorOptions.map((item) => ({
                            value: item.value,
                            label: item.label
                        }))}
                        value={condition.operator}
                    />
                </div>
                <div className="grid min-w-0 gap-2">
                    <FieldLabel>Value</FieldLabel>
                    <Input
                        className="h-9 text-sm"
                        onChange={(event) => updateCondition(index, { value: event.target.value })}
                        placeholder="Value"
                        value={String(condition.value ?? "")}
                    />
                </div>
                <div className="grid min-w-0 gap-2">
                    <FieldLabel>Compare to</FieldLabel>
                    <SimpleSelect
                        className="h-9 border border-input bg-background px-3 text-sm"
                        disabled={!usesCompareField}
                        onValueChange={(compareTo) => updateCondition(index, { compare_to: compareTo || null })}
                        options={compareOptions.map((item) => ({
                            value: item.value,
                            label: item.label
                        }))}
                        value={condition.compare_to ?? ""}
                    />
                </div>
                {isRollingOperator ? (
                    <div className="grid min-w-0 gap-2">
                        <FieldLabel>Window seconds</FieldLabel>
                        <Input
                            className="h-9 text-sm"
                            min={5}
                            onChange={(event) =>
                                updateCondition(index, {
                                    compare_to: null,
                                    window_seconds: Number(event.target.value || 300)
                                })
                            }
                            placeholder="300"
                            type="number"
                            value={String(condition.window_seconds ?? 300)}
                        />
                    </div>
                ) : null}
                {isSpreadOperator ? (
                    <div className="grid min-w-0 gap-2">
                        <FieldLabel>Spread unit</FieldLabel>
                        <SimpleSelect
                            className="h-9 border border-input bg-background px-3 text-sm"
                            onValueChange={(unit) => updateConditionConfig("unit", unit)}
                            options={spreadUnitOptions.map((item) => ({
                                value: item.value,
                                label: item.label
                            }))}
                            value={String(config.unit ?? "bps")}
                        />
                    </div>
                ) : null}
                <div className="grid min-w-[112px] gap-2">
                    <FieldLabel>Action</FieldLabel>
                    <Button
                        className="w-full min-w-0"
                        onClick={() => removeCondition(index)}
                        type="button"
                        variant="destructive"
                    >
                        Remove
                    </Button>
                </div>
            </div>
            {isRollingOperator || isVolumeOperator ? (
                <div className="grid max-w-4xl gap-3 rounded-lg border border-border bg-secondary/20 p-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
                    {isRollingOperator ? (
                        <>
                            <div className="grid gap-2">
                                <FieldLabel>Rolling baseline</FieldLabel>
                                <SimpleSelect
                                    className="h-9 border border-input bg-background px-3 text-sm"
                                    onValueChange={(baseline) => updateConditionConfig("baseline", baseline)}
                                    options={rollingBaselineOptions.map((item) => ({
                                        value: item.value,
                                        label: item.label
                                    }))}
                                    value={String(config.baseline ?? "oldest")}
                                />
                            </div>
                            <div className="grid gap-2">
                                <FieldLabel>Min samples</FieldLabel>
                                <Input
                                    className="h-9 text-sm"
                                    min={1}
                                    onChange={(event) =>
                                        updateConditionConfig(
                                            "min_samples",
                                            event.target.value ? Number(event.target.value) : null
                                        )
                                    }
                                    placeholder="3"
                                    type="number"
                                    value={String(config.min_samples ?? "")}
                                />
                            </div>
                            <div className="grid gap-2">
                                <FieldLabel>Min coverage</FieldLabel>
                                <Input
                                    className="h-9 text-sm"
                                    max={1}
                                    min={0}
                                    onChange={(event) =>
                                        updateConditionConfig(
                                            "min_coverage_ratio",
                                            event.target.value ? Number(event.target.value) : null
                                        )
                                    }
                                    placeholder="0.8"
                                    step="0.05"
                                    type="number"
                                    value={String(config.min_coverage_ratio ?? "")}
                                />
                            </div>
                        </>
                    ) : null}
                    {isVolumeOperator ? (
                        <div className="grid gap-2">
                            <FieldLabel>Minimum volume</FieldLabel>
                            <Input
                                className="h-9 text-sm"
                                min={0}
                                onChange={(event) =>
                                    updateConditionConfig(
                                        "min_volume",
                                        event.target.value ? Number(event.target.value) : null
                                    )
                                }
                                placeholder="Optional"
                                type="number"
                                value={String(config.min_volume ?? "")}
                            />
                        </div>
                    ) : null}
                    <HelpText className="self-end">
                        Rolling baselines use Redis samples and only match after the configured sample and coverage
                        gates are satisfied.
                    </HelpText>
                </div>
            ) : null}
            <div className="grid max-w-4xl gap-3 rounded-lg border border-border p-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
                <div className="grid gap-2">
                    <FieldLabel>Trigger mode</FieldLabel>
                    <SimpleSelect
                        className="h-9 border border-input bg-background px-3 text-sm"
                        onValueChange={(triggerMode) =>
                            updateCondition(index, {
                                trigger_mode: triggerMode as AlertCondition["trigger_mode"]
                            })
                        }
                        options={triggerModeOptions.map((item) => ({
                            value: item.value,
                            label: item.label
                        }))}
                        value={condition.trigger_mode ?? "level"}
                    />
                </div>
                <div className="grid gap-2">
                    <FieldLabel>Hold seconds</FieldLabel>
                    <Input
                        className="h-9 text-sm"
                        min={1}
                        onChange={(event) =>
                            updateCondition(index, {
                                hold_seconds: event.target.value ? Number(event.target.value) : null
                            })
                        }
                        placeholder="Optional"
                        type="number"
                        value={String(condition.hold_seconds ?? "")}
                    />
                </div>
                <div className="grid gap-2">
                    <FieldLabel>Occurrences</FieldLabel>
                    <Input
                        className="h-9 text-sm"
                        min={1}
                        onChange={(event) =>
                            updateCondition(index, {
                                occurrences: event.target.value ? Number(event.target.value) : null
                            })
                        }
                        placeholder="Optional"
                        type="number"
                        value={String(condition.occurrences ?? "")}
                    />
                </div>
                <div className="grid gap-2">
                    <FieldLabel>Occurrence window</FieldLabel>
                    <Input
                        className="h-9 text-sm"
                        min={1}
                        onChange={(event) =>
                            updateCondition(index, {
                                occurrence_window_seconds: event.target.value ? Number(event.target.value) : null
                            })
                        }
                        placeholder="300"
                        type="number"
                        value={String(condition.occurrence_window_seconds ?? "")}
                    />
                </div>
                <HelpText className="self-end">
                    These controls add stateful noise suppression: edge-only triggers, hold-for duration, and
                    N-times-in-window recurrence.
                </HelpText>
            </div>
            <div className="grid gap-2 text-[13px] leading-5 text-muted-foreground [grid-template-columns:repeat(auto-fit,minmax(132px,1fr))]">
                <div>{fieldMeta?.help}</div>
                <div>{operatorMeta?.help}</div>
                <div />
                <div>
                    {isRollingOperator
                        ? "Rolling operators use Redis samples for this field over the configured window."
                        : usesCompareField
                          ? compareMeta?.help
                          : "This operator derives its reference internally from the order book or runtime state."}
                </div>
                {isRollingOperator ? (
                    <div>Default is 300 seconds. The backend waits for enough window coverage before matching.</div>
                ) : null}
                <div />
            </div>
        </div>
    );
}
