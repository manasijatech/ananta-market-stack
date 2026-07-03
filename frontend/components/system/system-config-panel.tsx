"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { ChevronDownIcon, CircleHelpIcon } from "lucide-react";
import {
    addLlmProviderModel,
    clearMcpOAuthById,
    clearMcpOAuth,
    clearMcpServerApiKeyById,
    clearMcpServerApiKey,
    createMcpServerConfig,
    deleteMcpServerConfigById,
    deleteMcpServerConfig,
    deleteAlphaApiCredential,
    deleteLlmProviderCredential,
    deleteLlmProviderModel,
    deleteLlmModelPricing,
    getBrokerDataSearchConfig,
    refreshOpenRouterModelPricing,
    refreshMcpInventoryById,
    refreshMcpInventory,
    startMcpOAuth,
    updateBrokerDataDefaultConfig,
    updateMcpServerConfig,
    upsertAlphaApiCredential,
    upsertLlmProviderCredential,
    upsertLlmModelPricing
} from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogPanel,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { formatIstDateTime } from "@/lib/datetime";
import { DRISHTI_API_SIGNUP_URL } from "@/lib/drishti";
import type { LlmProvider, SystemConfig } from "@/service/types/broker";
import type { OpenRouterModel } from "@/service/actions/llm-models";
import { LlmModelPicker } from "@/components/system/llm-model-picker";

type ProviderDraftState = {
    apiKey: string;
    modelId: string;
    label: string;
};

type PricingDraftState = {
    provider: LlmProvider;
    modelId: string;
    inputCost: string;
    outputCost: string;
};

export type SystemConfigPanelSection = "all" | "broker-data" | "alpha" | "mcp" | "llm";

const PROVIDER_LOGOS: Record<LlmProvider, { src: string; alt: string; imageClassName: string }> = {
    openai: {
        src: "/brand/providers/openai.svg",
        alt: "OpenAI logo",
        imageClassName: "size-6 object-contain"
    },
    openrouter: {
        src: "/brand/providers/openrouter.svg",
        alt: "OpenRouter logo",
        imageClassName: "size-6 object-contain"
    },
    gemini: {
        src: "/brand/providers/gemini.svg",
        alt: "Google Gemini logo",
        imageClassName: "size-6 object-contain"
    },
    anthropic: {
        src: "/brand/providers/anthropic.svg",
        alt: "Anthropic logo",
        imageClassName: "size-6 object-contain"
    }
};

const LLM_PROVIDER_OPTIONS = [
    { value: "openai", label: "OpenAI" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "gemini", label: "Gemini" },
    { value: "anthropic", label: "Anthropic" }
];

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
        modelExamples: ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4", "gpt-5.5"],
        notes: [
            "Cheapest option: use gpt-5.4-nano for simple, high-volume alert analysis.",
            "Use gpt-5.4-mini when you want a stronger low-cost default.",
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
            "OpenRouter is useful when you want to switch model providers without changing Ananta code."
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
            "Ananta uses Anthropic through Claude's OpenAI-compatible Chat Completions endpoint.",
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

function formatPricingRate(value?: number | null) {
    return value == null ? "not set" : `$${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(value)}`;
}

export function SystemConfigPanel({
    initialConfig,
    section = "all",
    permissions,
    openRouterModels = []
}: {
    initialConfig: SystemConfig;
    section?: SystemConfigPanelSection;
    openRouterModels?: OpenRouterModel[];
    permissions: {
        canManageAlpha: boolean;
        canManageLlm: boolean;
        canManageMcp: boolean;
        canUseMcp: boolean;
    };
}) {
    const [config, setConfig] = useState(initialConfig);
    const [selectedDefaultAccountId, setSelectedDefaultAccountId] = useState(
        initialConfig.broker_data_default.preferred_default_account_id ?? ""
    );
    const [defaultBrokerError, setDefaultBrokerError] = useState("");
    const [isDefaultBrokerSaving, setIsDefaultBrokerSaving] = useState(false);
    const defaultBrokerSaveIdRef = useRef(0);
    const [alphaApiKey, setAlphaApiKey] = useState("");
    const [alphaError, setAlphaError] = useState("");
    const [mcpServers, setMcpServers] = useState(
        initialConfig.mcp_servers.length ? initialConfig.mcp_servers : [initialConfig.mcp_server]
    );
    const [selectedMcpServerId, setSelectedMcpServerId] = useState(
        initialConfig.mcp_servers[0]?.id ?? initialConfig.mcp_server.id ?? ""
    );
    const mcpConfig =
        mcpServers.find((server) => server.id === selectedMcpServerId) ?? mcpServers[0] ?? initialConfig.mcp_server;
    const [mcpApiKey, setMcpApiKey] = useState("");
    const [mcpExtraHeadersText, setMcpExtraHeadersText] = useState(
        JSON.stringify((mcpConfig ?? initialConfig.mcp_server).extra_headers ?? {}, null, 2)
    );
    const [mcpError, setMcpError] = useState("");
    const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
    const [pricingError, setPricingError] = useState("");
    const [pricingDraft, setPricingDraft] = useState<PricingDraftState>({
        provider: "openrouter",
        modelId: "",
        inputCost: "",
        outputCost: ""
    });
    const [drafts, setDrafts] = useState<Record<string, ProviderDraftState>>(
        Object.fromEntries(
            initialConfig.llm_providers.map((provider) => [
                provider.provider,
                { apiKey: "", modelId: "", label: "" }
            ])
        )
    );
    // Progressive disclosure: collapse providers by default, open the first one
    // that still needs setup so the user is guided to a single next step.
    const [openLlmProviders, setOpenLlmProviders] = useState<string[]>(() => {
        const firstUnconfigured = initialConfig.llm_providers.find((provider) => !provider.has_api_key);
        return firstUnconfigured ? [firstUnconfigured.provider] : [];
    });
    const [isPending, startTransition] = useTransition();
    const alphaReadOnly = !permissions.canManageAlpha;
    const llmReadOnly = !permissions.canManageLlm;
    const mcpReadOnly = !permissions.canManageMcp;

    function replaceMcpServer(next: SystemConfig["mcp_server"]) {
        setMcpServers((current) => {
            const exists = next.id && current.some((server) => server.id === next.id);
            if (!exists) {
                return [next, ...current.filter((server) => server.id)];
            }
            return current.map((server) => (server.id === next.id ? next : server));
        });
        setSelectedMcpServerId(next.id ?? "");
        setConfig((current) => ({
            ...current,
            mcp_server: next,
            mcp_servers: next.id
                ? current.mcp_servers.some((server) => server.id === next.id)
                    ? current.mcp_servers.map((server) => (server.id === next.id ? next : server))
                    : [next, ...current.mcp_servers]
                : current.mcp_servers
        }));
    }

    function patchSelectedMcpServer(patch: Partial<SystemConfig["mcp_server"]>) {
        setMcpServers((current) => current.map((server) => (server.id === mcpConfig.id ? { ...server, ...patch } : server)));
    }

    function autosaveSelectedMcpServer(patch: Partial<SystemConfig["mcp_server"]>) {
        const nextDraft = { ...mcpConfig, ...patch };
        patchSelectedMcpServer(patch);
        setMcpError("");
        startTransition(async () => {
            try {
                const next = await updateMcpServerConfig({
                    id: nextDraft.id,
                    is_enabled: nextDraft.is_enabled,
                    use_by_default: nextDraft.use_by_default,
                    name: nextDraft.name ?? null,
                    url: nextDraft.url,
                    transport: nextDraft.transport,
                    auth_mode: nextDraft.auth_mode ?? "oauth",
                    api_key: null,
                    api_key_header_name: nextDraft.api_key_header_name,
                    api_key_prefix: nextDraft.api_key_prefix,
                    extra_headers: readMcpExtraHeaders(),
                    timeout_seconds: nextDraft.timeout_seconds
                });
                replaceMcpServer(next);
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

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

    function replacePricing(nextPricing: SystemConfig["llm_model_pricing"]) {
        setConfig((current) => ({
            ...current,
            llm_model_pricing: nextPricing
        }));
    }

    async function autosaveDefaultBrokerPreference(accountId: string) {
        const saveId = defaultBrokerSaveIdRef.current + 1;
        const previousAccountId = selectedDefaultAccountId;
        defaultBrokerSaveIdRef.current = saveId;
        setSelectedDefaultAccountId(accountId);
        setDefaultBrokerError("");
        setIsDefaultBrokerSaving(true);
        try {
            const nextDefault = await updateBrokerDataDefaultConfig(accountId || null);
            if (defaultBrokerSaveIdRef.current === saveId) {
                setConfig((current) => ({
                    ...current,
                    broker_data_default: nextDefault
                }));
                setSelectedDefaultAccountId(nextDefault.preferred_default_account_id ?? "");
            }
            const nextSearch = await getBrokerDataSearchConfig();
            if (defaultBrokerSaveIdRef.current === saveId) {
                setConfig((current) => ({ ...current, broker_data_search: nextSearch }));
            }
        } catch (caught) {
            if (defaultBrokerSaveIdRef.current === saveId) {
                setSelectedDefaultAccountId(previousAccountId);
                setDefaultBrokerError(parseActionError(caught).message);
            }
        } finally {
            if (defaultBrokerSaveIdRef.current === saveId) {
                setIsDefaultBrokerSaving(false);
            }
        }
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
                    id: mcpConfig.id,
                    is_enabled: mcpConfig.is_enabled,
                    use_by_default: mcpConfig.use_by_default,
                    name: mcpConfig.name ?? null,
                    url: mcpConfig.url,
                    transport: mcpConfig.transport,
                    auth_mode: mcpConfig.auth_mode ?? "oauth",
                    api_key: mcpApiKey || null,
                    api_key_header_name: mcpConfig.api_key_header_name,
                    api_key_prefix: mcpConfig.api_key_prefix,
                    extra_headers: extraHeaders,
                    timeout_seconds: mcpConfig.timeout_seconds
                });
                replaceMcpServer(next);
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
                    id: mcpConfig.id,
                    is_enabled: mcpConfig.is_enabled,
                    use_by_default: mcpConfig.use_by_default,
                    name: mcpConfig.name ?? null,
                    url: mcpConfig.url,
                    transport: mcpConfig.transport,
                    auth_mode: mcpConfig.auth_mode ?? "oauth",
                    api_key: mcpApiKey || null,
                    api_key_header_name: mcpConfig.api_key_header_name,
                    api_key_prefix: mcpConfig.api_key_prefix,
                    extra_headers: readMcpExtraHeaders(),
                    timeout_seconds: mcpConfig.timeout_seconds
                });
                replaceMcpServer(saved);
                setMcpApiKey("");
                setMcpExtraHeadersText(JSON.stringify(saved.extra_headers ?? {}, null, 2));
                const auth = await startMcpOAuth(`${window.location.origin}/api/mcp/oauth/callback`, saved.id);
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
                const next = mcpConfig.id ? await clearMcpOAuthById(mcpConfig.id) : await clearMcpOAuth();
                replaceMcpServer(next);
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function refreshMcpCapabilities() {
        setMcpError("");
        startTransition(async () => {
            try {
                const next = mcpConfig.id ? await refreshMcpInventoryById(mcpConfig.id) : await refreshMcpInventory();
                replaceMcpServer(next);
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function clearMcpConfigCompletely() {
        setMcpError("");
        startTransition(async () => {
            try {
                const next = mcpConfig.id ? await deleteMcpServerConfigById(mcpConfig.id) : await deleteMcpServerConfig();
                setMcpServers((current) => {
                    const remaining = current.filter((server) => server.id !== mcpConfig.id);
                    return remaining.length ? remaining : [next];
                });
                setSelectedMcpServerId(next.id ?? "");
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
                const next = mcpConfig.id ? await clearMcpServerApiKeyById(mcpConfig.id) : await clearMcpServerApiKey();
                replaceMcpServer(next);
                setMcpApiKey("");
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function addMcpServer() {
        setMcpError("");
        startTransition(async () => {
            try {
                const next = await createMcpServerConfig({
                    is_enabled: false,
                    use_by_default: true,
                    name: "New MCP server",
                    url: "",
                    transport: "streamable_http",
                    auth_mode: "oauth",
                    api_key: null,
                    api_key_header_name: "Authorization",
                    api_key_prefix: "Bearer",
                    extra_headers: {},
                    timeout_seconds: 15
                });
                replaceMcpServer(next);
                setMcpApiKey("");
                setMcpExtraHeadersText(JSON.stringify(next.extra_headers ?? {}, null, 2));
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

    function savePricing() {
        setPricingError("");
        startTransition(async () => {
            try {
                const next = await upsertLlmModelPricing({
                    provider: pricingDraft.provider,
                    model_id: pricingDraft.modelId,
                    input_cost_per_1m_tokens: pricingDraft.inputCost.trim() ? Number(pricingDraft.inputCost) : null,
                    output_cost_per_1m_tokens: pricingDraft.outputCost.trim() ? Number(pricingDraft.outputCost) : null
                });
                replacePricing([
                    ...config.llm_model_pricing.filter(
                        (row) => !(row.provider === next.provider && row.model_id === next.model_id)
                    ),
                    next
                ].sort((a, b) => `${a.provider}:${a.model_id}`.localeCompare(`${b.provider}:${b.model_id}`)));
                setPricingDraft((current) => ({ ...current, modelId: "", inputCost: "", outputCost: "" }));
            } catch (caught) {
                setPricingError(parseActionError(caught).message);
            }
        });
    }

    function refreshOpenRouterPricing() {
        setPricingError("");
        startTransition(async () => {
            try {
                replacePricing(await refreshOpenRouterModelPricing());
            } catch (caught) {
                setPricingError(parseActionError(caught).message);
            }
        });
    }

    function removePricing(pricingId: string) {
        setPricingError("");
        startTransition(async () => {
            try {
                replacePricing(await deleteLlmModelPricing(pricingId));
            } catch (caught) {
                setPricingError(parseActionError(caught).message);
            }
        });
    }

    const showBrokerData = section === "all" || section === "broker-data";
    const showAlpha = section === "all" || section === "alpha";
    const showMcp = section === "all" || section === "mcp";
    const showLlm = section === "all" || section === "llm";

    return (
        <div className="grid gap-5">
            {showBrokerData ? (
                <>
            <section className="rounded-lg border border-border p-4">
                <div className="text-sm font-semibold">Default broker</div>
                <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                    Background subscriptions, broker-backed market data, and symbol search use this broker first. If
                    the selected broker is unavailable for a specific task, the backend falls back to the next eligible
                    active account.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <SimpleSelect
                        className="h-9 min-w-[240px] max-w-sm border border-input bg-background px-3 text-sm"
                        disabled={isDefaultBrokerSaving || !config.broker_data_default.accounts.length}
                        onValueChange={(accountId) => {
                            void autosaveDefaultBrokerPreference(accountId);
                        }}
                        options={config.broker_data_default.accounts.map((account) => ({
                            value: account.account_id,
                            label: `${account.label} · ${account.broker_code}`
                        }))}
                        value={selectedDefaultAccountId}
                    />
                </div>
                {isDefaultBrokerSaving ? <div className="mt-3 text-xs text-muted-foreground">Saving default broker...</div> : null}
                {config.broker_data_default.effective_default_account_id ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                        Effective broker account:{" "}
                        {config.broker_data_default.accounts.find(
                            (item) => item.account_id === config.broker_data_default.effective_default_account_id
                        )?.label ?? config.broker_data_default.effective_default_account_id}
                        {config.broker_data_default.fallback_used ? " · fallback active right now" : ""}
                    </div>
                ) : config.broker_data_default.accounts.length ? (
                    <div className="mt-3 text-xs text-warning-foreground">
                        No verified active broker session is currently available for default broker data.
                    </div>
                ) : null}
                {defaultBrokerError ? <div className="mt-3 text-sm text-destructive">{defaultBrokerError}</div> : null}
            </section>

            <section className="grid gap-2.5">
                <div className="text-sm font-semibold">Broker data status</div>
                {config.broker_data_search.accounts.map((account) => (
                    <div className="rounded-lg border border-border p-3.5" key={account.account_id}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <div className="text-sm font-semibold">
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
                                <div className="text-warning-foreground">{account.last_error}</div>
                            ) : null}
                            {account.latest_instrument_sync_error ? (
                                <div className="text-warning-foreground">
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
                </>
            ) : null}

            {showAlpha ? (
            <section className="grid gap-4">
                {section === "all" ? (
                <div>
                    <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">Drishti API</div>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button
                                    aria-label="Drishti API help"
                                    className="size-6 border-transparent bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-primary"
                                    size="icon"
                                    type="button"
                                    variant="ghost"
                                >
                                    <CircleHelpIcon className="size-4" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-lg">
                                <DialogHeader>
                                    <DialogTitle>Drishti API</DialogTitle>
                                    <DialogDescription>
                                        This key connects Ananta to Drishti market intelligence services.
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogPanel>
                                    <div className="grid gap-3 text-sm leading-6 text-muted-foreground">
                                        <p>
                                            It powers company metadata, announcements, concalls, news, daily summaries, and
                                            related market intelligence data used throughout the workspace.
                                        </p>
                                        <p>
                                            The key is saved server-side and shown here only as a masked hint. Replace it
                                            when the key rotates, or clear it to disable Drishti-backed intelligence calls.
                                        </p>
                                        <p>
                                            Don&apos;t have a key yet?{" "}
                                            <Link
                                                className="font-medium text-primary underline underline-offset-2"
                                                href={DRISHTI_API_SIGNUP_URL}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                            >
                                                Create one at drishti.manasija.in
                                            </Link>
                                            .
                                        </p>
                                    </div>
                                </DialogPanel>
                            </DialogContent>
                        </Dialog>
                    </div>
                    <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                        Store the Drishti API key used for market intelligence, company metadata, announcements, concalls,
                        and daily summaries.
                    </p>
                </div>
                ) : null}
                <div className="rounded-lg border border-border p-4">
                    {alphaReadOnly ? (
                        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            This Drishti API key is shared for the whole workspace. You can use the configured
                            services, but only an allowed admin can change this setup.
                        </div>
                    ) : null}
                    {!config.alpha_api.has_api_key ? (
                        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            Don&apos;t have a Drishti API key yet?{" "}
                            <Link
                                className="font-medium text-primary underline underline-offset-2"
                                href={DRISHTI_API_SIGNUP_URL}
                                rel="noopener noreferrer"
                                target="_blank"
                            >
                                Create one at drishti.manasija.in
                            </Link>
                            , then paste it below.
                        </div>
                    ) : null}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold">{config.alpha_api.label}</div>
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
                            disabled={alphaReadOnly}
                            onChange={(event) => setAlphaApiKey(event.target.value)}
                            placeholder={
                                config.alpha_api.has_api_key
                                    ? "Replace saved Drishti API key"
                                    : "Add Drishti API key"
                            }
                            type="password"
                            value={alphaApiKey}
                        />
                        <Button
                            disabled={alphaReadOnly || isPending || !alphaApiKey.trim()}
                            onClick={saveAlphaApiKey}
                            title={alphaReadOnly ? "Only a workspace admin can update the shared Drishti API key." : undefined}
                            type="button"
                        >
                            Save key
                        </Button>
                        <Button
                            disabled={alphaReadOnly || isPending || !config.alpha_api.has_api_key}
                            onClick={clearAlphaApiKey}
                            title={alphaReadOnly ? "Only a workspace admin can clear the shared Drishti API key." : undefined}
                            type="button"
                            variant="ghost"
                        >
                            Clear key
                        </Button>
                    </div>
                    {alphaError ? <div className="mt-3 text-sm text-destructive">{alphaError}</div> : null}
                </div>
                {config.alpha_api.account_error ? (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                        {config.alpha_api.account_error}
                    </div>
                ) : null}
            </section>
            ) : null}

            {showMcp ? (
            <section className="@container grid gap-4">
                {section === "all" ? (
                <div>
                    <div className="text-base font-semibold tracking-tight">Hosted MCP servers</div>
                    <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                        Configure one or more hosted MCP endpoints that broker chat can attach when MCP is enabled.
                        Enabled default servers are selected automatically in chat; users can narrow the set per run.
                    </p>
                </div>
                ) : null}
                <div className="rounded-lg border border-border p-4">
                    {mcpReadOnly ? (
                        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            These MCP servers are shared for the workspace. You can use granted MCP access in broker
                            chat, but only an allowed admin can change this shared setup.
                        </div>
                    ) : null}
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        <SimpleSelect
                            className="h-9 min-w-[260px]"
                            onValueChange={(serverId) => {
                                const next = mcpServers.find((server) => server.id === serverId);
                                setSelectedMcpServerId(serverId);
                                setMcpApiKey("");
                                setMcpExtraHeadersText(JSON.stringify(next?.extra_headers ?? {}, null, 2));
                            }}
                            options={mcpServers.map((server, index) => ({
                                value: server.id ?? "",
                                label: server.name || server.url || `MCP server ${index + 1}`
                            }))}
                            value={mcpConfig.id ?? ""}
                        />
                        <Button
                            disabled={mcpReadOnly || isPending}
                            onClick={addMcpServer}
                            title={mcpReadOnly ? "Only a workspace admin can add shared MCP servers." : undefined}
                            type="button"
                            variant="outline"
                        >
                            Add MCP server
                        </Button>
                    </div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-sm font-semibold">MCP connection</div>
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
                                disabled={mcpReadOnly}
                                onCheckedChange={(checked) => autosaveSelectedMcpServer({ is_enabled: Boolean(checked) })}
                            />
                            Enable this server
                        </Label>
                        <Label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={mcpConfig.use_by_default}
                                disabled={mcpReadOnly}
                                onCheckedChange={(checked) =>
                                    autosaveSelectedMcpServer({ use_by_default: Boolean(checked) })
                                }
                            />
                            Use by default in chat
                        </Label>
                    </div>

                    <div className="@container mt-4">
                        <div className="grid gap-3 @lg:grid-cols-2">
                            <div className="grid gap-1.5">
                                <Label className="text-xs font-medium text-muted-foreground">Display name</Label>
                                <Input
                                    className="h-9 text-sm"
                                    disabled={mcpReadOnly}
                                    onChange={(event) => patchSelectedMcpServer({ name: event.target.value })}
                                    placeholder="Display name"
                                    value={mcpConfig.name ?? ""}
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label className="text-xs font-medium text-muted-foreground">Transport</Label>
                                <SimpleSelect
                                    className="h-9"
                                    disabled={mcpReadOnly}
                                    onValueChange={(transport) =>
                                        patchSelectedMcpServer({ transport: transport as "streamable_http" | "sse" })
                                    }
                                    options={[
                                        { value: "streamable_http", label: "Streamable HTTP" },
                                        { value: "sse", label: "SSE" }
                                    ]}
                                    value={mcpConfig.transport}
                                />
                            </div>
                            <div className="grid gap-1.5 @lg:col-span-2">
                                <Label className="text-xs font-medium text-muted-foreground">Server URL</Label>
                                <Input
                                    className="h-9 text-sm"
                                    disabled={mcpReadOnly}
                                    onChange={(event) => patchSelectedMcpServer({ url: event.target.value })}
                                    placeholder="https://mcp.manasija.in/"
                                    value={mcpConfig.url}
                                />
                            </div>
                        </div>
                    </div>

                    <Collapsible className="mt-4 border-t border-border pt-3">
                        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-foreground">
                            <span>Authentication</span>
                            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="@container grid gap-3 pt-3">
                                <div className="grid gap-3 @lg:grid-cols-2">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs font-medium text-muted-foreground">Auth mode</Label>
                                        <SimpleSelect
                                            className="h-9"
                                            disabled={mcpReadOnly}
                                            onValueChange={(authMode) =>
                                                patchSelectedMcpServer({ auth_mode: authMode as "oauth" | "api_key" })
                                            }
                                            options={[
                                                { value: "oauth", label: "OAuth / browser authentication" },
                                                { value: "api_key", label: "Bearer API key fallback" }
                                            ]}
                                            value={mcpConfig.auth_mode ?? "oauth"}
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-end gap-2">
                                        <Button
                                            disabled={mcpReadOnly || isPending || !mcpConfig.url}
                                            onClick={startMcpAuthentication}
                                            title={mcpReadOnly ? "Only a workspace admin can authenticate shared MCP servers." : undefined}
                                            type="button"
                                            variant="outline"
                                        >
                                            Authenticate MCP
                                        </Button>
                                        <Button
                                            disabled={mcpReadOnly || isPending || !mcpConfig.oauth_authenticated}
                                            onClick={clearMcpAuthentication}
                                            title={mcpReadOnly ? "Only a workspace admin can clear shared MCP authentication." : undefined}
                                            type="button"
                                            variant="outline"
                                        >
                                            Clear OAuth
                                        </Button>
                                        <Button
                                            disabled={mcpReadOnly || isPending || !mcpConfig.url}
                                            onClick={refreshMcpCapabilities}
                                            title={mcpReadOnly ? "Only a workspace admin can refresh shared MCP tools." : undefined}
                                            type="button"
                                        >
                                            Refresh tools
                                        </Button>
                                    </div>
                                </div>
                                <div className="grid gap-3 @lg:grid-cols-2">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs font-medium text-muted-foreground">API key</Label>
                                        <Input
                                            autoComplete="off"
                                            className="h-9 text-sm"
                                            data-1p-ignore="true"
                                            data-form-type="other"
                                            data-lpignore="true"
                                            disabled={mcpReadOnly}
                                            onChange={(event) => setMcpApiKey(event.target.value)}
                                            placeholder={mcpConfig.has_api_key ? "Replace MCP API key" : "Add MCP API key"}
                                            type="password"
                                            value={mcpApiKey}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs font-medium text-muted-foreground">Header name</Label>
                                            <Input
                                                className="h-9 text-sm"
                                                disabled={mcpReadOnly}
                                                onChange={(event) =>
                                                    patchSelectedMcpServer({ api_key_header_name: event.target.value })
                                                }
                                                placeholder="Authorization"
                                                value={mcpConfig.api_key_header_name}
                                            />
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs font-medium text-muted-foreground">Prefix</Label>
                                            <Input
                                                className="h-9 text-sm"
                                                disabled={mcpReadOnly}
                                                onChange={(event) =>
                                                    patchSelectedMcpServer({ api_key_prefix: event.target.value })
                                                }
                                                placeholder="Bearer"
                                                value={mcpConfig.api_key_prefix}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>

                    <Collapsible className="mt-3 border-t border-border pt-3">
                        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-foreground">
                            <span>Advanced</span>
                            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="@container grid gap-3 pt-3">
                                <div className="grid gap-3 @lg:grid-cols-2">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs font-medium text-muted-foreground">Timeout (seconds)</Label>
                                        <Input
                                            className="h-9 text-sm"
                                            disabled={mcpReadOnly}
                                            min={1}
                                            max={120}
                                            onChange={(event) =>
                                                patchSelectedMcpServer({ timeout_seconds: Number(event.target.value || 15) })
                                            }
                                            type="number"
                                            value={mcpConfig.timeout_seconds}
                                        />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs font-medium text-muted-foreground">Extra headers (JSON)</Label>
                                        <textarea
                                            className="min-h-24 w-full border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
                                            disabled={mcpReadOnly}
                                            onChange={(event) => setMcpExtraHeadersText(event.target.value)}
                                            placeholder='{"X-Workspace": "ananta-market-stack"}'
                                            value={mcpExtraHeadersText}
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                                    <div className="font-semibold text-foreground">
                                        MCP capabilities · {(mcpConfig.inventory.tools ?? []).length} tools ·{" "}
                                        {(mcpConfig.inventory.prompts ?? []).length} prompts ·{" "}
                                        {(mcpConfig.inventory.resources ?? []).length} resources
                                    </div>
                                    {(mcpConfig.inventory.tools ?? []).length ? (
                                        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-1">
                                            {(mcpConfig.inventory.tools ?? []).map((tool, index) => (
                                                <Badge key={`${String(tool.name || "tool")}-${index}`} variant="secondary">
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
                                    {mcpConfig.inventory.errors && Object.keys(mcpConfig.inventory.errors).length ? (
                                        <div className="text-warning-foreground">
                                            Inventory notes:{" "}
                                            {Object.entries(mcpConfig.inventory.errors)
                                                .map(([key, value]) => `${key}: ${value}`)
                                                .join(" · ")}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                            disabled={mcpReadOnly || isPending}
                            onClick={saveMcpConfig}
                            title={mcpReadOnly ? "Only a workspace admin can save shared MCP settings." : undefined}
                            type="button"
                        >
                            {isPending ? "Saving..." : "Save MCP config"}
                        </Button>
                        <Button
                            disabled={mcpReadOnly || isPending || !mcpConfig.has_api_key}
                            onClick={clearMcpKey}
                            title={mcpReadOnly ? "Only a workspace admin can clear the shared MCP key." : undefined}
                            type="button"
                            variant="outline"
                        >
                            Clear MCP key
                        </Button>
                        <Button
                            disabled={mcpReadOnly || isPending}
                            onClick={clearMcpConfigCompletely}
                            title={mcpReadOnly ? "Only a workspace admin can delete shared MCP servers." : undefined}
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
            ) : null}

            {showLlm ? (
            <section className="@container grid gap-4">
                {llmReadOnly ? (
                    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                        These provider keys and models are shared across the workspace. You can use the configured
                        providers in chat and alerts, but only an allowed admin can change them here.
                    </div>
                ) : null}
                {section === "all" ? (
                <div>
                    <div className="text-base font-semibold tracking-tight">LLM providers</div>
                    <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                        Configure OpenAI, OpenRouter, or Gemini API keys and save one or more models per provider. All
                        provider calls in the backend are routed through the OpenAI SDK with provider-specific base
                        URLs.
                    </p>
                </div>
                ) : null}
                <Accordion
                    className="overflow-hidden rounded-lg border border-border"
                    multiple={false}
                    onValueChange={(value) => setOpenLlmProviders(value as string[])}
                    value={openLlmProviders}
                >
                {config.llm_providers.map((provider) => (
                    <AccordionItem className="@container px-4" key={provider.provider} value={provider.provider}>
                        <AccordionTrigger className="items-center gap-3 py-3">
                            <span className="flex size-7 shrink-0 items-center justify-center">
                                <img
                                    alt={PROVIDER_LOGOS[provider.provider].alt}
                                    className={`${PROVIDER_LOGOS[provider.provider].imageClassName} object-contain`}
                                    draggable={false}
                                    src={PROVIDER_LOGOS[provider.provider].src}
                                />
                            </span>
                            <span className="min-w-0 flex-1 text-left">
                                <span className="block font-heading text-sm font-semibold tracking-tight text-foreground">
                                    {provider.label}
                                </span>
                                <span className="block text-xs font-normal text-muted-foreground">
                                    {provider.has_api_key
                                        ? `Connected${provider.models.length ? ` · ${provider.models.length} model${provider.models.length === 1 ? "" : "s"}` : ""}`
                                        : "Not connected"}
                                </span>
                            </span>
                            <Badge
                                className={
                                    provider.has_api_key
                                        ? "border-[var(--success)] bg-[var(--success-subtle)] font-normal text-[var(--success)]"
                                        : "font-normal text-muted-foreground"
                                }
                                variant="outline"
                            >
                                {provider.has_api_key ? "Connected" : "Connect"}
                            </Badge>
                        </AccordionTrigger>
                        <AccordionPanel className="grid gap-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="text-xs text-muted-foreground">{provider.base_url}</span>
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
                                <DialogContent className="max-w-2xl">
                                    <DialogHeader>
                                        <DialogTitle>{provider.label} setup</DialogTitle>
                                        <DialogDescription>
                                            {PROVIDER_SETUP_GUIDES[provider.provider].summary}
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogPanel>
                                        <div className="grid gap-5 text-sm leading-6">
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Model IDs to try
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {PROVIDER_SETUP_GUIDES[provider.provider].modelExamples.map(
                                                    (modelId) => (
                                                        <code
                                                            className="rounded-lg border border-border bg-muted px-2 py-1 text-xs text-foreground"
                                                            key={modelId}
                                                        >
                                                            {modelId}
                                                        </code>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Notes
                                            </div>
                                            <ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">
                                                {PROVIDER_SETUP_GUIDES[provider.provider].notes.map((note) => (
                                                    <li key={note}>{note}</li>
                                                ))}
                                            </ul>
                                        </div>
                                        </div>
                                    </DialogPanel>
                                </DialogContent>
                            </Dialog>
                        </div>

                        <div className="mt-4 grid gap-2 @lg:grid-cols-[minmax(200px,1fr)_auto_auto]">
                            <Input
                                autoComplete="off"
                                className="h-9 text-sm"
                                data-1p-ignore="true"
                                data-form-type="other"
                                data-lpignore="true"
                                disabled={llmReadOnly}
                                onChange={(event) => updateDraft(provider.provider, { apiKey: event.target.value })}
                                placeholder={
                                    provider.has_api_key ? "Replace saved API key" : `Add ${provider.label} API key`
                                }
                                type="password"
                                value={drafts[providerKey(provider.provider)]?.apiKey ?? ""}
                            />
                            <Button
                                disabled={llmReadOnly || isPending || !(drafts[providerKey(provider.provider)]?.apiKey ?? "").trim()}
                                onClick={() => saveProviderApiKey(provider.provider)}
                                title={llmReadOnly ? "Only a workspace admin can update shared provider keys." : undefined}
                                type="button"
                            >
                                Save key
                            </Button>
                            <Button
                                disabled={llmReadOnly || isPending || !provider.has_api_key}
                                onClick={() => clearProviderApiKey(provider.provider)}
                                title={llmReadOnly ? "Only a workspace admin can clear shared provider keys." : undefined}
                                type="button"
                                variant="outline"
                            >
                                Clear key
                            </Button>
                        </div>

                        {provider.has_api_key ? (
                            <div className="mt-4 grid gap-2 @lg:grid-cols-[minmax(200px,1fr)_minmax(140px,0.6fr)_auto]">
                                {openRouterModels.length ? (
                                    <LlmModelPicker
                                        disabled={llmReadOnly}
                                        models={openRouterModels}
                                        onSelect={(modelId, modelName) =>
                                            updateDraft(provider.provider, {
                                                modelId,
                                                label: drafts[providerKey(provider.provider)]?.label || modelName
                                            })
                                        }
                                        provider={provider.provider}
                                        value={drafts[providerKey(provider.provider)]?.modelId ?? ""}
                                    />
                                ) : (
                                    <Input
                                        className="h-9 text-sm"
                                        disabled={llmReadOnly}
                                        onChange={(event) =>
                                            updateDraft(provider.provider, { modelId: event.target.value })
                                        }
                                        placeholder="Model id"
                                        value={drafts[providerKey(provider.provider)]?.modelId ?? ""}
                                    />
                                )}
                                <Input
                                    className="h-9 text-sm"
                                    disabled={llmReadOnly}
                                    onChange={(event) => updateDraft(provider.provider, { label: event.target.value })}
                                    placeholder="Optional label"
                                    value={drafts[providerKey(provider.provider)]?.label ?? ""}
                                />
                                <Button
                                    disabled={llmReadOnly || isPending || !(drafts[providerKey(provider.provider)]?.modelId ?? "").trim()}
                                    onClick={() => addModel(provider.provider)}
                                    title={llmReadOnly ? "Only a workspace admin can add shared models." : undefined}
                                    type="button"
                                    variant="outline"
                                >
                                    Add model
                                </Button>
                            </div>
                        ) : (
                            <div className="mt-4 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                                Save your {provider.label} API key above, then pick a model from the catalog.
                            </div>
                        )}

                        <div className="mt-4 grid gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved models</div>
                            {provider.models.map((model) => (
                                <div
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
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
                                        disabled={llmReadOnly || isPending}
                                        onClick={() => removeModel(provider.provider, model.id)}
                                        title={llmReadOnly ? "Only a workspace admin can remove shared models." : undefined}
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
                        </AccordionPanel>
                    </AccordionItem>
                ))}
                </Accordion>

                <div className="border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-base font-bold tracking-tight">Model pricing</div>
                            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                                Configure USD rates per 1M tokens for estimated costs when a provider does not return
                                cost in the response. Estimated costs are labeled as estimates in usage screens.
                            </p>
                        </div>
                        <Button
                            disabled={llmReadOnly || isPending}
                            onClick={refreshOpenRouterPricing}
                            type="button"
                            variant="outline"
                        >
                            Refresh OpenRouter pricing
                        </Button>
                    </div>

                    <div className="mt-4 grid gap-2 min-[900px]:grid-cols-[160px_minmax(180px,1fr)_140px_140px_auto]">
                        <SimpleSelect
                            aria-label="Pricing provider"
                            disabled={llmReadOnly}
                            onValueChange={(value) =>
                                setPricingDraft((current) => ({ ...current, provider: value as LlmProvider }))
                            }
                            options={LLM_PROVIDER_OPTIONS}
                            value={pricingDraft.provider}
                        />
                        <Input
                            className="h-9 text-sm"
                            disabled={llmReadOnly}
                            onChange={(event) => setPricingDraft((current) => ({ ...current, modelId: event.target.value }))}
                            placeholder="Model id"
                            value={pricingDraft.modelId}
                        />
                        <Input
                            className="h-9 text-sm"
                            disabled={llmReadOnly}
                            inputMode="decimal"
                            onChange={(event) => setPricingDraft((current) => ({ ...current, inputCost: event.target.value }))}
                            placeholder="Input $/1M"
                            value={pricingDraft.inputCost}
                        />
                        <Input
                            className="h-9 text-sm"
                            disabled={llmReadOnly}
                            inputMode="decimal"
                            onChange={(event) => setPricingDraft((current) => ({ ...current, outputCost: event.target.value }))}
                            placeholder="Output $/1M"
                            value={pricingDraft.outputCost}
                        />
                        <Button
                            disabled={llmReadOnly || isPending || !pricingDraft.modelId.trim()}
                            onClick={savePricing}
                            type="button"
                        >
                            Save pricing
                        </Button>
                    </div>

                    <div className="mt-4 grid gap-2">
                        {config.llm_model_pricing.map((row) => (
                            <div className="flex flex-wrap items-center justify-between gap-2 border border-border px-3 py-2" key={row.id}>
                                <div>
                                    <div className="text-sm font-semibold">{row.provider} / {row.model_id}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        Input {formatPricingRate(row.input_cost_per_1m_tokens)} · output{" "}
                                        {formatPricingRate(row.output_cost_per_1m_tokens)} · {row.source}
                                    </div>
                                </div>
                                <Button
                                    className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    disabled={llmReadOnly || isPending}
                                    onClick={() => removePricing(row.id)}
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                >
                                    Remove
                                </Button>
                            </div>
                        ))}
                        {!config.llm_model_pricing.length ? (
                            <div className="text-sm text-muted-foreground">No model pricing configured yet.</div>
                        ) : null}
                    </div>

                    {pricingError ? <div className="mt-3 text-sm text-destructive">{pricingError}</div> : null}
                </div>
            </section>
            ) : null}
        </div>
    );
}
