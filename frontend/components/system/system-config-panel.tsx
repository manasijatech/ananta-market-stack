"use client";

import { useState, useTransition } from "react";
import { CircleHelpIcon } from "lucide-react";
import {
    addLlmProviderModel,
    clearMcpOAuth,
    clearMcpServerApiKey,
    deleteMcpServerConfig,
    deleteAlphaApiCredential,
    deleteLlmProviderCredential,
    deleteLlmProviderModel,
    refreshMcpInventory,
    startMcpOAuth,
    updateBrokerDataDefaultConfig,
    updateBrokerDataSearchConfig,
    updateAlphaWebSocketConfig,
    updateMcpServerConfig,
    upsertAlphaApiCredential,
    upsertLlmProviderCredential
} from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatIstDateTime } from "@/lib/datetime";
import type { LlmProvider, SystemConfig } from "@/service/types/broker";

type ProviderDraftState = {
    apiKey: string;
    modelId: string;
    label: string;
};

const PROVIDER_LOGOS: Record<LlmProvider, { src: string; alt: string; imageClassName: string }> = {
    openai: {
        src: "/brand/providers/openai.svg",
        alt: "OpenAI logo",
        imageClassName: "h-6 w-auto"
    },
    openrouter: {
        src: "/brand/providers/openrouter.svg",
        alt: "OpenRouter logo",
        imageClassName: "h-4.5 w-auto"
    },
    gemini: {
        src: "/brand/providers/gemini.svg",
        alt: "Google Gemini logo",
        imageClassName: "h-6 w-auto"
    },
    anthropic: {
        src: "/brand/providers/anthropic.svg",
        alt: "Anthropic logo",
        imageClassName: "h-5 w-auto"
    }
};

const PROVIDER_SETUP_GUIDES: Record<
    LlmProvider,
    {
        summary: string;
        steps: Array<{
            before: string;
            label?: string;
            href?: string;
            after?: string;
        }>;
        modelExamples: string[];
        notes: string[];
    }
> = {
    openai: {
        summary: "Use an OpenAI project API key and save one or more OpenAI model IDs.",
        steps: [
            {
                before: "Open ",
                label: "OpenAI API keys",
                href: "https://platform.openai.com/api-keys",
                after: " and create a project API key."
            },
            {
                before: "Copy the full key once from the key creation screen. OpenAI will not show it again later."
            },
            { before: "Paste the key in the OpenAI API key field and click Save key." },
            {
                before: "Choose a model from the ",
                label: "OpenAI model catalog",
                href: "https://developers.openai.com/api/docs/models",
                after: ", paste the model ID, then click Add model."
            }
        ],
        modelExamples: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"],
        notes: [
            "Use gpt-5.4-mini first when you want lower cost and faster alert analysis.",
            "Use gpt-5.5 only when you need stronger reasoning and accept higher cost.",
            "Do not paste an organization ID, project ID, or environment variable name here."
        ]
    },
    openrouter: {
        summary: "Use one OpenRouter key to access many providers through OpenRouter model IDs.",
        steps: [
            {
                before: "Open ",
                label: "OpenRouter API keys",
                href: "https://openrouter.ai/settings/keys",
                after: " and create a new key."
            },
            {
                before: "Check ",
                label: "OpenRouter credits",
                href: "https://openrouter.ai/settings/credits",
                after: " so the selected model can run."
            },
            { before: "Paste the key in the OpenRouter API key field and click Save key." },
            {
                before: "Pick the exact provider/model slug from ",
                label: "OpenRouter models",
                href: "https://openrouter.ai/models",
                after: ", paste it as the model ID, then click Add model."
            }
        ],
        modelExamples: ["openai/gpt-5.4-nano", "google/gemini-3.5-flash", "openrouter/free"],
        notes: [
            "OpenRouter model IDs normally look like provider/model-name.",
            "If a model fails, check credits, model availability, and whether the model needs a paid account.",
            "OpenRouter is useful when you want to switch model providers without changing Market Stack code."
        ]
    },
    gemini: {
        summary: "Use a Gemini API key from Google AI Studio with Gemini's OpenAI-compatible endpoint.",
        steps: [
            {
                before: "Open ",
                label: "Google AI Studio API keys",
                href: "https://aistudio.google.com/app/apikey",
                after: " and create a Gemini API key."
            },
            { before: "Copy the API key from AI Studio." },
            { before: "Paste the key in the Gemini API key field and click Save key." },
            {
                before: "Use a Gemini model ID from the ",
                label: "Gemini OpenAI-compatible model guide",
                href: "https://ai.google.dev/gemini-api/docs/openai",
                after: ", paste it, then click Add model."
            }
        ],
        modelExamples: ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-2.5-flash"],
        notes: [
            "Gemini is a good choice for fast, lower-cost analysis.",
            "Use Flash models first for alerts unless you specifically need a larger Pro model.",
            "The key should be a Gemini API key, not a Google Cloud service-account JSON file."
        ]
    },
    anthropic: {
        summary: "Use an Anthropic API key with Claude's OpenAI SDK compatibility endpoint.",
        steps: [
            {
                before: "Open ",
                label: "Anthropic Console API keys",
                href: "https://console.anthropic.com/settings/keys",
                after: " and create a Claude API key."
            },
            { before: "Copy the key from the console." },
            { before: "Paste the key in the Anthropic API key field and click Save key." },
            {
                before: "Use a Claude model ID from the ",
                label: "Claude OpenAI SDK compatibility guide",
                href: "https://platform.claude.com/docs/en/api/openai-sdk",
                after: ", paste it, then click Add model."
            }
        ],
        modelExamples: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
        notes: [
            "Market Stack uses Anthropic through Claude's OpenAI-compatible Chat Completions endpoint.",
            "Prompt caching, citations, PDF processing, and full extended-thinking features need Anthropic's native API.",
            "For broker chat, Claude runs through the Agents SDK Chat Completions model path."
        ]
    }
};

function formatConfigDate(value?: string | null) {
    return value ? formatIstDateTime(value) : null;
}

function providerKey(provider: LlmProvider) {
    return provider;
}

export function SystemConfigPanel({ initialConfig }: { initialConfig: SystemConfig }) {
    const [config, setConfig] = useState(initialConfig);
    const [selectedDefaultAccountId, setSelectedDefaultAccountId] = useState(
        initialConfig.broker_data_default.preferred_default_account_id ?? ""
    );
    const [selectedAccountId, setSelectedAccountId] = useState(
        initialConfig.broker_data_search.preferred_search_account_id ?? ""
    );
    const [defaultBrokerError, setDefaultBrokerError] = useState("");
    const [brokerError, setBrokerError] = useState("");
    const [alphaApiKey, setAlphaApiKey] = useState("");
    const [alphaWsConfig, setAlphaWsConfig] = useState(initialConfig.alpha_websocket);
    const [alphaError, setAlphaError] = useState("");
    const [mcpConfig, setMcpConfig] = useState(initialConfig.mcp_server);
    const [mcpApiKey, setMcpApiKey] = useState("");
    const [mcpExtraHeadersText, setMcpExtraHeadersText] = useState(
        JSON.stringify(initialConfig.mcp_server.extra_headers ?? {}, null, 2)
    );
    const [mcpError, setMcpError] = useState("");
    const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
    const [drafts, setDrafts] = useState<Record<string, ProviderDraftState>>(
        Object.fromEntries(
            initialConfig.llm_providers.map((provider) => [
                provider.provider,
                { apiKey: "", modelId: "", label: "" }
            ])
        )
    );
    const [isPending, startTransition] = useTransition();

    function updateDraft(provider: LlmProvider, patch: Partial<ProviderDraftState>) {
        setDrafts((current) => ({
            ...current,
            [providerKey(provider)]: {
                ...(current[providerKey(provider)] ?? { apiKey: "", modelId: "", label: "" }),
                ...patch
            }
        }));
    }

    function replaceProvider(provider: LlmProvider, nextProviderConfig: SystemConfig["llm_providers"][number]) {
        setConfig((current) => ({
            ...current,
            llm_providers: current.llm_providers.map((item) => (item.provider === provider ? nextProviderConfig : item))
        }));
    }

    function replaceProviders(nextProviders: SystemConfig["llm_providers"]) {
        setConfig((current) => ({
            ...current,
            llm_providers: nextProviders
        }));
    }

    function saveBrokerPreference() {
        setBrokerError("");
        startTransition(async () => {
            try {
                const next = await updateBrokerDataSearchConfig(selectedAccountId || null);
                setConfig((current) => ({ ...current, broker_data_search: next }));
            } catch (caught) {
                setBrokerError(parseActionError(caught).message);
            }
        });
    }

    function saveDefaultBrokerPreference() {
        setDefaultBrokerError("");
        startTransition(async () => {
            try {
                const next = await updateBrokerDataDefaultConfig(selectedDefaultAccountId || null);
                setConfig((current) => ({ ...current, broker_data_default: next }));
            } catch (caught) {
                setDefaultBrokerError(parseActionError(caught).message);
            }
        });
    }

    function saveAlphaApiKey() {
        setAlphaError("");
        startTransition(async () => {
            try {
                const next = await upsertAlphaApiCredential({ api_key: alphaApiKey });
                setConfig((current) => ({ ...current, alpha_api: next }));
                setAlphaApiKey("");
            } catch (caught) {
                setAlphaError(parseActionError(caught).message);
            }
        });
    }

    function clearAlphaApiKey() {
        setAlphaError("");
        startTransition(async () => {
            try {
                const next = await deleteAlphaApiCredential();
                setConfig((current) => ({ ...current, alpha_api: next }));
                setAlphaApiKey("");
            } catch (caught) {
                setAlphaError(parseActionError(caught).message);
            }
        });
    }

    function toggleAlphaWsProduct(product: string, checked: boolean) {
        setAlphaWsConfig((current) => ({
            ...current,
            products: checked
                ? Array.from(new Set([...current.products, product]))
                : current.products.filter((item) => item !== product)
        }));
    }

    function saveAlphaWsConfig() {
        setAlphaError("");
        startTransition(async () => {
            try {
                const next = await updateAlphaWebSocketConfig({
                    is_enabled: alphaWsConfig.is_enabled,
                    products: alphaWsConfig.products,
                    scope_mode: alphaWsConfig.scope_mode,
                    watchlist_ids: alphaWsConfig.watchlist_ids,
                    include_all_watchlists: alphaWsConfig.include_all_watchlists,
                    full_market: alphaWsConfig.full_market
                });
                setAlphaWsConfig(next);
            } catch (caught) {
                setAlphaError(parseActionError(caught).message);
            }
        });
    }

    function readMcpExtraHeaders(): Record<string, string> {
        if (!mcpExtraHeadersText.trim()) {
            return {};
        }
        const parsed = JSON.parse(mcpExtraHeadersText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("MCP extra headers must be a JSON object.");
        }
        return Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
        );
    }

    function saveMcpConfig() {
        setMcpError("");
        startTransition(async () => {
            try {
                const extraHeaders = readMcpExtraHeaders();
                const next = await updateMcpServerConfig({
                    is_enabled: mcpConfig.is_enabled,
                    name: mcpConfig.name ?? null,
                    url: mcpConfig.url,
                    transport: mcpConfig.transport,
                    auth_mode: mcpConfig.auth_mode ?? "oauth",
                    api_key: mcpApiKey || null,
                    api_key_header_name: mcpConfig.api_key_header_name,
                    api_key_prefix: mcpConfig.api_key_prefix,
                    extra_headers: extraHeaders,
                    timeout_seconds: mcpConfig.timeout_seconds,
                    tool_cache_enabled: mcpConfig.tool_cache_enabled
                });
                setMcpConfig(next);
                setMcpApiKey("");
                setMcpExtraHeadersText(JSON.stringify(next.extra_headers ?? {}, null, 2));
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function startMcpAuthentication() {
        setMcpError("");
        startTransition(async () => {
            try {
                const saved = await updateMcpServerConfig({
                    is_enabled: mcpConfig.is_enabled,
                    name: mcpConfig.name ?? null,
                    url: mcpConfig.url,
                    transport: mcpConfig.transport,
                    auth_mode: mcpConfig.auth_mode ?? "oauth",
                    api_key: mcpApiKey || null,
                    api_key_header_name: mcpConfig.api_key_header_name,
                    api_key_prefix: mcpConfig.api_key_prefix,
                    extra_headers: readMcpExtraHeaders(),
                    timeout_seconds: mcpConfig.timeout_seconds,
                    tool_cache_enabled: mcpConfig.tool_cache_enabled
                });
                setMcpConfig(saved);
                setMcpApiKey("");
                setMcpExtraHeadersText(JSON.stringify(saved.extra_headers ?? {}, null, 2));
                const auth = await startMcpOAuth(`${window.location.origin}/api/mcp/oauth/callback`);
                window.open(auth.authorization_url, "_blank", "noopener,noreferrer");
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function clearMcpAuthentication() {
        setMcpError("");
        startTransition(async () => {
            try {
                const next = await clearMcpOAuth();
                setMcpConfig(next);
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function refreshMcpCapabilities() {
        setMcpError("");
        startTransition(async () => {
            try {
                const next = await refreshMcpInventory();
                setMcpConfig(next);
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function clearMcpConfigCompletely() {
        setMcpError("");
        startTransition(async () => {
            try {
                const next = await deleteMcpServerConfig();
                setMcpConfig(next);
                setMcpApiKey("");
                setMcpExtraHeadersText(JSON.stringify(next.extra_headers ?? {}, null, 2));
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function clearMcpKey() {
        setMcpError("");
        startTransition(async () => {
            try {
                const next = await clearMcpServerApiKey();
                setMcpConfig(next);
                setMcpApiKey("");
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function saveProviderApiKey(provider: LlmProvider) {
        setProviderErrors((current) => ({ ...current, [provider]: "" }));
        startTransition(async () => {
            try {
                const next = await upsertLlmProviderCredential(provider, {
                    api_key: drafts[providerKey(provider)]?.apiKey ?? ""
                });
                replaceProvider(provider, next);
                updateDraft(provider, { apiKey: "" });
            } catch (caught) {
                setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
            }
        });
    }

    function clearProviderApiKey(provider: LlmProvider) {
        setProviderErrors((current) => ({ ...current, [provider]: "" }));
        startTransition(async () => {
            try {
                const next = await deleteLlmProviderCredential(provider);
                replaceProviders(next);
                updateDraft(provider, { apiKey: "" });
            } catch (caught) {
                setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
            }
        });
    }

    function addModel(provider: LlmProvider) {
        setProviderErrors((current) => ({ ...current, [provider]: "" }));
        startTransition(async () => {
            try {
                const next = await addLlmProviderModel({
                    provider,
                    model_id: drafts[providerKey(provider)]?.modelId ?? "",
                    label: drafts[providerKey(provider)]?.label || null
                });
                replaceProviders(next);
                updateDraft(provider, { modelId: "", label: "" });
            } catch (caught) {
                setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
            }
        });
    }

    function removeModel(provider: LlmProvider, modelRowId: string) {
        setProviderErrors((current) => ({ ...current, [provider]: "" }));
        startTransition(async () => {
            try {
                const next = await deleteLlmProviderModel(modelRowId);
                replaceProviders(next);
            } catch (caught) {
                setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
            }
        });
    }

    return (
        <div className="grid gap-5">
            <section className="border border-border p-4">
                <div className="text-sm font-bold">Default broker for broker data</div>
                <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                    Background subscriptions and broker-backed market data use this broker first. If the selected broker
                    is not verified or its session is inactive, the backend falls back to the next verified active
                    session.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select
                        className="h-9 min-w-[240px] max-w-sm border border-input bg-background px-3 text-sm"
                        onChange={(event) => setSelectedDefaultAccountId(event.target.value)}
                        value={selectedDefaultAccountId}
                    >
                        {config.broker_data_default.accounts.map((account) => (
                            <option key={account.account_id} value={account.account_id}>
                                {account.label} · {account.broker_code}
                            </option>
                        ))}
                    </Select>
                    <Button
                        disabled={isPending || !config.broker_data_default.accounts.length}
                        onClick={saveDefaultBrokerPreference}
                        type="button"
                    >
                        {isPending ? "Saving..." : "Save"}
                    </Button>
                </div>
                {config.broker_data_default.effective_default_account_id ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                        Effective broker data account:{" "}
                        {config.broker_data_default.accounts.find(
                            (item) => item.account_id === config.broker_data_default.effective_default_account_id
                        )?.label ?? config.broker_data_default.effective_default_account_id}
                        {config.broker_data_default.fallback_used ? " · fallback active right now" : ""}
                    </div>
                ) : config.broker_data_default.accounts.length ? (
                    <div className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                        No verified active broker session is currently available for default broker data.
                    </div>
                ) : null}
                {defaultBrokerError ? <div className="mt-3 text-sm text-destructive">{defaultBrokerError}</div> : null}
            </section>

            <section className="border border-border p-4">
                <div className="text-sm font-bold">Default symbol-search broker</div>
                <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                    The selected broker cache is used first for symbol search. If it is unavailable, search falls back
                    to the next available synced broker without blocking the UI.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select
                        className="h-9 min-w-[240px] max-w-sm border border-input bg-background px-3 text-sm"
                        onChange={(event) => setSelectedAccountId(event.target.value)}
                        value={selectedAccountId}
                    >
                        {config.broker_data_search.accounts.map((account) => (
                            <option key={account.account_id} value={account.account_id}>
                                {account.label} · {account.broker_code}
                            </option>
                        ))}
                    </Select>
                    <Button disabled={isPending} onClick={saveBrokerPreference} type="button">
                        {isPending ? "Saving..." : "Save"}
                    </Button>
                </div>
                {config.broker_data_search.effective_search_account_id ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                        Effective search account:{" "}
                        {config.broker_data_search.accounts.find(
                            (item) => item.account_id === config.broker_data_search.effective_search_account_id
                        )?.label ?? config.broker_data_search.effective_search_account_id}
                        {config.broker_data_search.fallback_used ? " · fallback active right now" : ""}
                    </div>
                ) : null}
                {brokerError ? <div className="mt-3 text-sm text-destructive">{brokerError}</div> : null}
            </section>

            <section className="grid gap-2.5">
                <div className="text-sm font-bold">Broker data status</div>
                {config.broker_data_search.accounts.map((account) => (
                    <div className="border border-border p-3.5" key={account.account_id}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <div className="text-sm font-bold">
                                    {account.label} · {account.broker_code}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    {account.search_available ? "Search cache ready" : "Search cache unavailable"} ·{" "}
                                    {account.is_verified ? "verified" : "unverified"} ·{" "}
                                    {account.session_active
                                        ? "session active"
                                        : (account.session_status ?? "session pending")}
                                </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {account.is_preferred
                                    ? "search preferred"
                                    : account.is_effective
                                      ? "search fallback"
                                      : "standby"}
                            </div>
                        </div>
                        <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                            <div>
                                Instrument sync: {account.latest_instrument_sync_status ?? "not run"}
                                {account.latest_instrument_sync_finished_at
                                    ? ` · ${formatIstDateTime(account.latest_instrument_sync_finished_at)}`
                                    : ""}
                            </div>
                            <div>
                                Holdings refresh: {account.holdings_status ?? "not run"} · {account.holdings_count}{" "}
                                items
                                {account.holdings_fetched_at
                                    ? ` · ${formatIstDateTime(account.holdings_fetched_at)}`
                                    : ""}
                            </div>
                            {account.last_error ? (
                                <div className="text-amber-700 dark:text-amber-300">{account.last_error}</div>
                            ) : null}
                            {account.latest_instrument_sync_error ? (
                                <div className="text-amber-700 dark:text-amber-300">
                                    {account.latest_instrument_sync_error}
                                </div>
                            ) : null}
                        </div>
                    </div>
                ))}
                {!config.broker_data_search.accounts.length ? (
                    <div className="text-sm text-muted-foreground">No broker accounts available yet.</div>
                ) : null}
            </section>

            <section className="grid gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <div className="text-sm font-bold">Manasija Alpha API</div>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button
                                    aria-label="Manasija Alpha API help"
                                    className="size-6 border-transparent bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-primary"
                                    size="icon"
                                    type="button"
                                    variant="ghost"
                                >
                                    <CircleHelpIcon className="size-4" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-lg p-0">
                                <DialogHeader className="border-b border-border px-5 py-4 pr-14">
                                    <DialogTitle>Manasija Alpha API</DialogTitle>
                                    <DialogDescription>
                                        This key connects Market Stack to Manasija Alpha market intelligence services.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-3 px-5 py-4 text-sm leading-6 text-muted-foreground">
                                    <p>
                                        It powers company metadata, announcements, concalls, news, daily summaries, and
                                        related market intelligence data used throughout the workspace.
                                    </p>
                                    <p>
                                        The key is saved server-side and shown here only as a masked hint. Replace it
                                        when the key rotates, or clear it to disable Alpha-backed intelligence calls.
                                    </p>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                    <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                        Store the Alpha API key used for market intelligence, company metadata, announcements, concalls,
                        and daily summaries.
                    </p>
                </div>
                <div className="border border-border p-4" data-onboarding="manasija-alpha-api-input-section">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <div className="text-sm font-bold">{config.alpha_api.label}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Badge
                                    className={
                                        config.alpha_api.has_api_key
                                            ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
                                            : "border-destructive bg-destructive/10 text-destructive"
                                    }
                                    variant="outline"
                                >
                                    {config.alpha_api.has_api_key ? "Key saved" : "Key missing"}
                                </Badge>
                                {config.alpha_api.api_key_hint ? (
                                    <span className="font-mono text-xs font-semibold text-foreground">
                                        {config.alpha_api.api_key_hint}
                                    </span>
                                ) : null}
                                {config.alpha_api.api_key_updated_at ? (
                                    <span className="text-xs text-muted-foreground">
                                        Updated {formatConfigDate(config.alpha_api.api_key_updated_at)}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 min-[760px]:flex-row">
                        <Input
                            autoComplete="off"
                            className="h-9 text-sm min-[760px]:max-w-md"
                            data-1p-ignore="true"
                            data-form-type="other"
                            data-lpignore="true"
                            onChange={(event) => setAlphaApiKey(event.target.value)}
                            placeholder={
                                config.alpha_api.has_api_key
                                    ? "Replace saved Manasija Alpha API key"
                                    : "Add Manasija Alpha API key"
                            }
                            type="password"
                            value={alphaApiKey}
                        />
                        <Button disabled={isPending || !alphaApiKey.trim()} onClick={saveAlphaApiKey} type="button">
                            Save key
                        </Button>
                        <Button
                            disabled={isPending || !config.alpha_api.has_api_key}
                            onClick={clearAlphaApiKey}
                            type="button"
                            variant="ghost"
                        >
                            Clear key
                        </Button>
                    </div>
                    {alphaError ? <div className="mt-3 text-sm text-destructive">{alphaError}</div> : null}
                </div>
                <div className="border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <div className="text-sm font-bold">Backend websocket worker</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {alphaWsConfig.status} · {alphaWsConfig.effective_products.length} products ·{" "}
                                {alphaWsConfig.scope_mode === "full_market"
                                    ? "full market"
                                    : `${alphaWsConfig.effective_symbol_count ?? alphaWsConfig.effective_symbols.length}${typeof alphaWsConfig.live_symbol_limit === "number" ? ` / ${alphaWsConfig.live_symbol_limit}` : ""} symbols`}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                Market Stack plan: {alphaWsConfig.plan_name ?? alphaWsConfig.plan_id ?? "Unknown"}
                                {typeof alphaWsConfig.monthly_unique_symbol_limit === "number"
                                    ? ` · ${alphaWsConfig.monthly_unique_symbol_limit} unique/month`
                                    : ""}
                            </div>
                        </div>
                        <Button disabled={isPending} onClick={saveAlphaWsConfig} type="button">
                            Save websocket products
                        </Button>
                    </div>
                    <div className="mt-3 grid max-w-md gap-2">
                        {alphaWsConfig.entitled_addons
                            .filter((addon) => addon.enabled)
                            .map((addon) => (
                                <Label className="flex items-center gap-2 text-sm" key={addon.product}>
                                    <Checkbox
                                        checked={alphaWsConfig.products.includes(addon.product)}
                                        onCheckedChange={(checked) =>
                                            toggleAlphaWsProduct(addon.product, Boolean(checked))
                                        }
                                    />
                                    <span>
                                        {addon.product} · {addon.tier ?? "tier unknown"}
                                    </span>
                                </Label>
                            ))}
                    </div>
                    {config.alpha_api.account_error ? (
                        <div className="mt-3 text-sm text-destructive">{config.alpha_api.account_error}</div>
                    ) : null}
                    {alphaWsConfig.last_error ? (
                        <div className="mt-3 text-sm text-destructive">{alphaWsConfig.last_error}</div>
                    ) : null}
                </div>
            </section>

            <section className="grid gap-4">
                <div>
                    <div className="text-base font-bold tracking-tight">Hosted MCP server</div>
                    <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                        Configure the hosted MCP endpoint that broker chat can attach when MCP is enabled for a chat
                        run. OAuth is preferred for remote MCP servers; direct bearer keys remain available as a
                        fallback for simple or private deployments.
                    </p>
                </div>
                <div className="border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-sm font-bold">MCP connection</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {mcpConfig.is_enabled ? "Enabled" : "Disabled"} · OAuth{" "}
                                {mcpConfig.oauth_authenticated ? "connected" : "not connected"} · API key{" "}
                                {mcpConfig.has_api_key ? "fallback configured" : "fallback not configured"}
                                {mcpConfig.updated_at ? ` · updated ${formatIstDateTime(mcpConfig.updated_at)}` : ""}
                            </div>
                            {mcpConfig.oauth_authorized_at ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                    Authorized {formatIstDateTime(mcpConfig.oauth_authorized_at)}
                                    {mcpConfig.oauth_token_expires_at
                                        ? ` · token expires ${formatIstDateTime(mcpConfig.oauth_token_expires_at)}`
                                        : ""}
                                </div>
                            ) : null}
                            {mcpConfig.api_key_hint ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                    Saved fallback key: {mcpConfig.api_key_hint}
                                </div>
                            ) : null}
                            {mcpConfig.inventory_checked_at ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                    Capabilities refreshed {formatIstDateTime(mcpConfig.inventory_checked_at)}
                                </div>
                            ) : null}
                        </div>
                        <Label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={mcpConfig.is_enabled}
                                onCheckedChange={(checked) =>
                                    setMcpConfig((current) => ({ ...current, is_enabled: Boolean(checked) }))
                                }
                            />
                            Enable MCP globally
                        </Label>
                    </div>

                    <div className="mt-4 grid gap-2 min-[900px]:grid-cols-[minmax(160px,0.7fr)_minmax(260px,1.3fr)_180px]">
                        <Input
                            className="h-9 text-sm"
                            onChange={(event) => setMcpConfig((current) => ({ ...current, name: event.target.value }))}
                            placeholder="Display name"
                            value={mcpConfig.name ?? ""}
                        />
                        <Input
                            className="h-9 text-sm"
                            onChange={(event) => setMcpConfig((current) => ({ ...current, url: event.target.value }))}
                            placeholder="https://mcp.testing.manasija.in/"
                            value={mcpConfig.url}
                        />
                        <Select
                            className="h-9"
                            onChange={(event) =>
                                setMcpConfig((current) => ({
                                    ...current,
                                    transport: event.target.value as "streamable_http" | "sse"
                                }))
                            }
                            value={mcpConfig.transport}
                        >
                            <option value="streamable_http">Streamable HTTP</option>
                            <option value="sse">SSE</option>
                        </Select>
                    </div>

                    <div className="mt-3 grid gap-2 min-[900px]:grid-cols-[180px_minmax(220px,1fr)]">
                        <Select
                            className="h-9"
                            onChange={(event) =>
                                setMcpConfig((current) => ({
                                    ...current,
                                    auth_mode: event.target.value as "oauth" | "api_key"
                                }))
                            }
                            value={mcpConfig.auth_mode ?? "oauth"}
                        >
                            <option value="oauth">OAuth / browser authentication</option>
                            <option value="api_key">Bearer API key fallback</option>
                        </Select>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                disabled={isPending || !mcpConfig.url}
                                onClick={startMcpAuthentication}
                                type="button"
                                variant="outline"
                            >
                                Authenticate MCP
                            </Button>
                            <Button
                                disabled={isPending || !mcpConfig.oauth_authenticated}
                                onClick={clearMcpAuthentication}
                                type="button"
                                variant="outline"
                            >
                                Clear OAuth
                            </Button>
                            <Button disabled={isPending || !mcpConfig.url} onClick={refreshMcpCapabilities} type="button">
                                Refresh tools
                            </Button>
                        </div>
                    </div>

                    <div className="mt-3 grid gap-2 min-[900px]:grid-cols-[minmax(220px,1fr)_180px_140px]">
                        <Input
                            autoComplete="off"
                            className="h-9 text-sm"
                            data-1p-ignore="true"
                            data-form-type="other"
                            data-lpignore="true"
                            onChange={(event) => setMcpApiKey(event.target.value)}
                            placeholder={mcpConfig.has_api_key ? "Replace MCP API key" : "Add MCP API key"}
                            type="password"
                            value={mcpApiKey}
                        />
                        <Input
                            className="h-9 text-sm"
                            onChange={(event) =>
                                setMcpConfig((current) => ({
                                    ...current,
                                    api_key_header_name: event.target.value
                                }))
                            }
                            placeholder="Authorization"
                            value={mcpConfig.api_key_header_name}
                        />
                        <Input
                            className="h-9 text-sm"
                            onChange={(event) =>
                                setMcpConfig((current) => ({ ...current, api_key_prefix: event.target.value }))
                            }
                            placeholder="Bearer"
                            value={mcpConfig.api_key_prefix}
                        />
                    </div>

                    <div className="mt-3 grid gap-2 border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                        <div className="font-semibold text-foreground">
                            MCP capabilities · {(mcpConfig.inventory.tools ?? []).length} tools ·{" "}
                            {(mcpConfig.inventory.prompts ?? []).length} prompts ·{" "}
                            {(mcpConfig.inventory.resources ?? []).length} resources
                        </div>
                        {(mcpConfig.inventory.tools ?? []).length ? (
                            <div className="flex flex-wrap gap-1.5">
                                {(mcpConfig.inventory.tools ?? []).slice(0, 12).map((tool) => (
                                    <Badge key={String(tool.name)} variant="secondary">
                                        {tool.name}
                                    </Badge>
                                ))}
                            </div>
                        ) : (
                            <div>No MCP tools cached yet. Authenticate, then refresh tools.</div>
                        )}
                        {(mcpConfig.inventory.prompts ?? []).length || (mcpConfig.inventory.resources ?? []).length ? (
                            <div>
                                Context: {(mcpConfig.inventory.prompts ?? []).map((item) => item.name).filter(Boolean).join(", ") || "no prompts"} ·{" "}
                                {(mcpConfig.inventory.resources ?? [])
                                    .map((item) => item.name || item.uri)
                                    .filter(Boolean)
                                    .join(", ") || "no resources"}
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-3 grid gap-2 min-[900px]:grid-cols-[140px_minmax(260px,1fr)]">
                        <Input
                            className="h-9 text-sm"
                            min={1}
                            max={120}
                            onChange={(event) =>
                                setMcpConfig((current) => ({
                                    ...current,
                                    timeout_seconds: Number(event.target.value || 15)
                                }))
                            }
                            type="number"
                            value={mcpConfig.timeout_seconds}
                        />
                        <Label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={mcpConfig.tool_cache_enabled}
                                onCheckedChange={(checked) =>
                                    setMcpConfig((current) => ({
                                        ...current,
                                        tool_cache_enabled: Boolean(checked)
                                    }))
                                }
                            />
                            Cache MCP tool list between calls
                        </Label>
                    </div>

                    <textarea
                        className="mt-3 min-h-24 w-full border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
                        onChange={(event) => setMcpExtraHeadersText(event.target.value)}
                        placeholder='{"X-Workspace": "market-stack"}'
                        value={mcpExtraHeadersText}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button disabled={isPending} onClick={saveMcpConfig} type="button">
                            {isPending ? "Saving..." : "Save MCP config"}
                        </Button>
                        <Button
                            disabled={isPending || !mcpConfig.has_api_key}
                            onClick={clearMcpKey}
                            type="button"
                            variant="outline"
                        >
                            Clear MCP key
                        </Button>
                        <Button
                            disabled={isPending}
                            onClick={clearMcpConfigCompletely}
                            type="button"
                            variant="outline"
                        >
                            Delete MCP config
                        </Button>
                    </div>
                    {mcpError ? <div className="mt-3 text-sm text-destructive">{mcpError}</div> : null}
                    {mcpConfig.oauth_last_error ? (
                        <div className="mt-3 text-sm text-destructive">{mcpConfig.oauth_last_error}</div>
                    ) : null}
                    {mcpConfig.inventory_error ? (
                        <div className="mt-3 text-sm text-destructive">{mcpConfig.inventory_error}</div>
                    ) : null}
                </div>
            </section>

            <section className="grid gap-4">
                <div>
                    <div className="text-base font-bold tracking-tight">LLM providers</div>
                    <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                        Configure OpenAI, OpenRouter, or Gemini API keys and save one or more models per provider. All
                        provider calls in the backend are routed through the OpenAI SDK with provider-specific base
                        URLs.
                    </p>
                </div>
                {config.llm_providers.map((provider) => (
                    <div className="border border-border p-4" key={provider.provider}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <div className="flex items-center gap-2.5">
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                                        <img
                                            alt={PROVIDER_LOGOS[provider.provider].alt}
                                            className={`${PROVIDER_LOGOS[provider.provider].imageClassName} object-contain`}
                                            draggable={false}
                                            src={PROVIDER_LOGOS[provider.provider].src}
                                        />
                                    </span>
                                    <div className="text-base font-bold leading-none tracking-tight">
                                        {provider.label}
                                    </div>
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">{provider.base_url}</div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <Badge
                                        className={
                                            provider.has_api_key
                                                ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
                                                : "border-destructive bg-destructive/10 text-destructive"
                                        }
                                        variant="outline"
                                    >
                                        {provider.has_api_key ? "Key saved" : "Key missing"}
                                    </Badge>
                                    {provider.api_key_hint ? (
                                        <span className="font-mono text-xs font-semibold text-foreground">
                                            {provider.api_key_hint}
                                        </span>
                                    ) : null}
                                    {provider.api_key_updated_at ? (
                                        <span className="text-xs text-muted-foreground">
                                            Updated {formatConfigDate(provider.api_key_updated_at)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button
                                        aria-label={`${provider.label} setup guide`}
                                        className="size-6 border-transparent bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-primary"
                                        size="icon"
                                        type="button"
                                        variant="ghost"
                                    >
                                        <CircleHelpIcon className="size-4" />
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl p-0">
                                    <DialogHeader className="border-b border-border px-5 py-4 pr-14">
                                        <DialogTitle>{provider.label} setup</DialogTitle>
                                        <DialogDescription>
                                            {PROVIDER_SETUP_GUIDES[provider.provider].summary}
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-5 px-5 py-4 text-sm leading-6">
                                        <div>
                                            <div className="text-xs font-bold uppercase text-muted-foreground">
                                                Steps
                                            </div>
                                            <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
                                                {PROVIDER_SETUP_GUIDES[provider.provider].steps.map((step) => (
                                                    <li key={`${step.before}-${step.label ?? ""}`}>
                                                        {step.before}
                                                        {step.href && step.label ? (
                                                            <a
                                                                className="font-medium text-primary underline-offset-4 hover:underline"
                                                                href={step.href}
                                                                rel="noreferrer"
                                                                target="_blank"
                                                            >
                                                                {step.label}
                                                            </a>
                                                        ) : null}
                                                        {step.after}
                                                    </li>
                                                ))}
                                            </ol>
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold uppercase text-muted-foreground">
                                                Model IDs to try
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {PROVIDER_SETUP_GUIDES[provider.provider].modelExamples.map(
                                                    (modelId) => (
                                                        <code
                                                            className="border border-border bg-muted px-2 py-1 text-xs text-foreground"
                                                            key={modelId}
                                                        >
                                                            {modelId}
                                                        </code>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold uppercase text-muted-foreground">
                                                Notes
                                            </div>
                                            <ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">
                                                {PROVIDER_SETUP_GUIDES[provider.provider].notes.map((note) => (
                                                    <li key={note}>{note}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>

                        <div className="mt-4 grid gap-2 min-[900px]:grid-cols-[minmax(220px,1fr)_auto_auto]">
                            <Input
                                autoComplete="off"
                                className="h-9 text-sm"
                                data-1p-ignore="true"
                                data-form-type="other"
                                data-lpignore="true"
                                onChange={(event) => updateDraft(provider.provider, { apiKey: event.target.value })}
                                placeholder={
                                    provider.has_api_key ? "Replace saved API key" : `Add ${provider.label} API key`
                                }
                                type="password"
                                value={drafts[providerKey(provider.provider)]?.apiKey ?? ""}
                            />
                            <Button
                                disabled={isPending || !(drafts[providerKey(provider.provider)]?.apiKey ?? "").trim()}
                                onClick={() => saveProviderApiKey(provider.provider)}
                                type="button"
                            >
                                Save key
                            </Button>
                            <Button
                                disabled={isPending || !provider.has_api_key}
                                onClick={() => clearProviderApiKey(provider.provider)}
                                type="button"
                                variant="outline"
                            >
                                Clear key
                            </Button>
                        </div>

                        <div className="mt-4 grid gap-2 min-[900px]:grid-cols-[minmax(180px,0.8fr)_minmax(160px,0.7fr)_auto]">
                            <Input
                                className="h-9 text-sm"
                                onChange={(event) => updateDraft(provider.provider, { modelId: event.target.value })}
                                placeholder="Model id"
                                value={drafts[providerKey(provider.provider)]?.modelId ?? ""}
                            />
                            <Input
                                className="h-9 text-sm"
                                onChange={(event) => updateDraft(provider.provider, { label: event.target.value })}
                                placeholder="Optional label"
                                value={drafts[providerKey(provider.provider)]?.label ?? ""}
                            />
                            <Button
                                disabled={isPending || !(drafts[providerKey(provider.provider)]?.modelId ?? "").trim()}
                                onClick={() => addModel(provider.provider)}
                                type="button"
                                variant="outline"
                            >
                                Add model
                            </Button>
                        </div>

                        <div className="mt-4 grid gap-2">
                            <div className="text-xs font-bold uppercase text-muted-foreground">Saved models</div>
                            {provider.models.map((model) => (
                                <div
                                    className="flex flex-wrap items-center justify-between gap-2 border border-border px-3 py-2"
                                    key={model.id}
                                >
                                    <div>
                                        <div className="text-sm font-semibold">{model.model_id}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {model.label || "No custom label"} · saved {formatIstDateTime(model.created_at)}
                                        </div>
                                    </div>
                                    <Button
                                        className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => removeModel(provider.provider, model.id)}
                                        size="sm"
                                        type="button"
                                        variant="outline"
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                            {!provider.models.length ? (
                                <div className="text-sm text-muted-foreground">No models saved yet.</div>
                            ) : null}
                        </div>

                        {providerErrors[provider.provider] ? (
                            <div className="mt-3 text-sm text-destructive">{providerErrors[provider.provider]}</div>
                        ) : null}
                    </div>
                ))}
            </section>
        </div>
    );
}
