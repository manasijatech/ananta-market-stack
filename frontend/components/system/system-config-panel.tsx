"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { CheckIcon, CircleHelpIcon, PlugIcon, PlusIcon, SearchIcon } from "lucide-react";
import {
    addLlmProviderModel,
    createMcpServerConfig,
    deleteMcpServerConfigById,
    deleteMcpServerConfig,
    deleteAlphaApiCredential,
    deleteLlmProviderCredential,
    deleteLlmProviderModel,
    deleteLlmModelPricing,
    getBrokerDataSearchConfig,
    refreshOpenRouterModelPricing,
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
import { LlmProviderSetupGuideDialog } from "@/components/system/llm-provider-setup-guide";
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

type SuggestedMcpTemplate = {
    id: string;
    name: string;
    logoSrc: string;
    logoAlt: string;
    category: string;
    useCase: string;
    setupHint: string;
    url: string;
    transport: "streamable_http" | "sse";
    authMode: "oauth" | "api_key";
    useByDefault: boolean;
    setupGuide?: {
        title: string;
        intro: string;
        steps: Array<{
            text: string;
            links?: Array<{ label: string; href: string }>;
            codeItems?: string[];
        }>;
    };
};

const LLM_PROVIDER_OPTIONS = [
    { value: "openai", label: "OpenAI" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "gemini", label: "Gemini" },
    { value: "anthropic", label: "Anthropic" }
];

type CustomMcpDraft = {
    name: string;
    url: string;
    transport: "streamable_http" | "sse";
    authMode: "oauth" | "api_key";
    apiKey: string;
    apiKeyHeaderName: string;
    apiKeyPrefix: string;
};

const EMPTY_CUSTOM_MCP_DRAFT: CustomMcpDraft = {
    name: "",
    url: "",
    transport: "streamable_http",
    authMode: "oauth",
    apiKey: "",
    apiKeyHeaderName: "Authorization",
    apiKeyPrefix: "Bearer"
};

const SUGGESTED_MCP_TEMPLATES: SuggestedMcpTemplate[] = [
    {
        id: "drishti",
        name: "Drishti MCP",
        logoSrc: "/brand/mcp/drishti.svg",
        logoAlt: "Drishti logo",
        category: "Market intelligence",
        useCase: "Indian equities news, filings, earnings, concalls, events, and movement context.",
        setupHint: "One-click setup opens Drishti OAuth; API-key fallback still works after setup.",
        url: "https://mcp.drishti.manasija.in",
        transport: "streamable_http",
        authMode: "oauth",
        useByDefault: true
    },
    {
        id: "google-drive",
        name: "Google Drive MCP",
        logoSrc: "/brand/mcp/google-drive.svg",
        logoAlt: "Google Drive logo",
        category: "Documents",
        useCase: "Broker statements, tax docs, research PDFs, CSV exports, screenshots, and reports.",
        setupHint: "One-click setup uses Google's hosted Drive MCP and opens OAuth.",
        url: "https://drivemcp.googleapis.com/mcp/v1",
        transport: "streamable_http",
        authMode: "oauth",
        useByDefault: false,
        setupGuide: {
            title: "Set up Google Drive MCP",
            intro: "Google Drive needs an Ananta-owned Google OAuth app before users can connect their Drive account.",
            steps: [
                {
                    text: "Open Google Cloud Console and choose the project Ananta should use.",
                    links: [{ label: "Google Cloud OAuth clients", href: "https://console.cloud.google.com/auth/clients" }]
                },
                {
                    text: "Enable the Google Drive API and Google Drive MCP API for that project.",
                    links: [
                        {
                            label: "Google Drive MCP setup guide",
                            href: "https://developers.google.com/workspace/drive/api/guides/configure-mcp-server"
                        }
                    ]
                },
                {
                    text: "Configure the OAuth consent screen, audience, and Drive MCP scopes.",
                    codeItems: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"]
                },
                { text: "Create an OAuth 2.0 Web application client." },
                { text: "Add this redirect URI to the OAuth client: <your Ananta URL>/api/mcp/oauth/callback." },
                {
                    text: "Copy the client ID and secret into Ananta's backend environment, then restart the backend.",
                    codeItems: ["MCP_GOOGLE_DRIVE_OAUTH_CLIENT_ID", "MCP_GOOGLE_DRIVE_OAUTH_CLIENT_SECRET"]
                }
            ]
        }
    },
    {
        id: "slack",
        name: "Slack MCP",
        logoSrc: "/brand/mcp/slack.svg",
        logoAlt: "Slack logo",
        category: "Support",
        useCase: "Support and incident channels for broker outages, sync failures, and customer reports.",
        setupHint: "One-click setup uses Slack's hosted MCP and opens OAuth.",
        url: "https://mcp.slack.com/mcp",
        transport: "streamable_http",
        authMode: "oauth",
        useByDefault: false,
        setupGuide: {
            title: "Set up Slack MCP",
            intro: "Slack needs an Ananta-owned Slack OAuth app before users can connect their workspace.",
            steps: [
                {
                    text: "Create or open the Slack app that Ananta should use for MCP OAuth; Slack MCP requires an internal app or a directory-published app.",
                    links: [
                        { label: "Slack app dashboard", href: "https://api.slack.com/apps" },
                        { label: "Slack MCP app identity", href: "https://docs.slack.dev/ai/slack-mcp-server/#app-identity" }
                    ]
                },
                { text: "In OAuth & Permissions, add this redirect URI: <your Ananta URL>/api/mcp/oauth/callback." },
                {
                    text: "Choose only the Slack MCP user-token scopes needed for Ananta support workflows.",
                    links: [
                        {
                            label: "Slack MCP scopes",
                            href: "https://docs.slack.dev/ai/slack-mcp-server/#oauth-scopes-needed-on-user-token-for-different-tools"
                        }
                    ]
                },
                {
                    text: "Copy the Slack app client ID and client secret into Ananta's backend environment.",
                    codeItems: ["MCP_SLACK_OAUTH_CLIENT_ID", "MCP_SLACK_OAUTH_CLIENT_SECRET"]
                },
                { text: "Restart the backend, then users can connect Slack from this catalog." }
            ]
        }
    },
    {
        id: "discord",
        name: "Discord MCP",
        logoSrc: "/brand/mcp/discord.svg",
        logoAlt: "Discord logo",
        category: "Community",
        useCase: "Community support, alert-delivery feedback, and broker issue reports.",
        setupHint: "Needs an Ananta-hosted or workspace-hosted Discord MCP endpoint before one-click setup.",
        url: "",
        transport: "streamable_http",
        authMode: "oauth",
        useByDefault: false,
        setupGuide: {
            title: "Set up Discord MCP",
            intro: "Discord does not have an Ananta-hosted connector URL yet, so you need to host or choose a Discord MCP server first.",
            steps: [
                {
                    text: "Create a Discord application or bot for the workspace data Ananta should be allowed to reach.",
                    links: [
                        {
                            label: "Discord Developer Portal",
                            href: "https://discord.com/developers/applications"
                        }
                    ]
                },
                {
                    text: "If the connector needs per-user consent, implement Discord OAuth behind the MCP server.",
                    links: [{ label: "Discord OAuth2 docs", href: "https://docs.discord.com/developers/topics/oauth2" }]
                },
                {
                    text: "Expose the Discord MCP server as a hosted Streamable HTTP endpoint reachable by Ananta.",
                    links: [
                        {
                            label: "MCP Streamable HTTP transport",
                            href: "https://modelcontextprotocol.io/specification/2025-03-26/basic/transports"
                        }
                    ]
                },
                {
                    text: "For OAuth-protected Discord tools, make the MCP server handle the delegated authorization flow and token binding.",
                    links: [
                        {
                            label: "MCP delegated authorization",
                            href: "https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization"
                        }
                    ]
                },
                { text: "Add that hosted endpoint to Ananta's connector catalog before enabling one-click setup." },
                { text: "After a hosted endpoint exists, Ananta can wire the connector like the other hosted MCPs." }
            ],
        }
    },
    {
        id: "notion",
        name: "Notion MCP",
        logoSrc: "/brand/mcp/notion.svg",
        logoAlt: "Notion logo",
        category: "Knowledge",
        useCase: "Research notes, support playbooks, broker setup notes, and product decisions.",
        setupHint: "One-click setup uses Notion's hosted MCP and opens OAuth.",
        url: "https://mcp.notion.com/mcp",
        transport: "streamable_http",
        authMode: "oauth",
        useByDefault: false
    }
];

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
    const [isMcpConnectorCatalogOpen, setIsMcpConnectorCatalogOpen] = useState(false);
    const [mcpConnectorSearch, setMcpConnectorSearch] = useState("");
    const [mcpSetupGuideTemplateId, setMcpSetupGuideTemplateId] = useState<string | null>(null);
    const [isCustomMcpDialogOpen, setIsCustomMcpDialogOpen] = useState(false);
    const [customMcpDraft, setCustomMcpDraft] = useState<CustomMcpDraft>(EMPTY_CUSTOM_MCP_DRAFT);
    const [customMcpError, setCustomMcpError] = useState("");
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
    const filteredMcpTemplates = SUGGESTED_MCP_TEMPLATES.filter((template) => {
        const query = mcpConnectorSearch.trim().toLowerCase();
        if (!query) {
            return true;
        }
        return [template.name, template.category, template.useCase, template.setupHint]
            .join(" ")
            .toLowerCase()
            .includes(query);
    });

    function suggestedMcpServerForTemplate(template: SuggestedMcpTemplate) {
        return mcpServers.find((server) => {
            if (template.url && server.url === template.url) {
                return true;
            }
            return (server.name || "").toLowerCase() === template.name.toLowerCase();
        });
    }

    function suggestedMcpTemplateForServer(server: SystemConfig["mcp_server"]) {
        return SUGGESTED_MCP_TEMPLATES.find((template) => {
            if (template.url && server.url === template.url) {
                return true;
            }
            return (server.name || "").toLowerCase() === template.name.toLowerCase();
        });
    }

    function isSuggestedMcpConfigured(template: SuggestedMcpTemplate) {
        return Boolean(suggestedMcpServerForTemplate(template));
    }

    function isMcpServerConnected(server?: SystemConfig["mcp_server"]) {
        return Boolean(server?.oauth_authenticated || server?.has_api_key);
    }

    function isSuggestedMcpConnected(template: SuggestedMcpTemplate) {
        return isMcpServerConnected(suggestedMcpServerForTemplate(template));
    }

    function mcpConnectorReadiness(template: SuggestedMcpTemplate) {
        return (
            (config.mcp_connector_readiness ?? []).find((item) => item.id === template.id) ?? {
                id: template.id,
                is_ready: true,
                reason: null
            }
        );
    }

    function mcpConnectorIsReady(template: SuggestedMcpTemplate) {
        return Boolean(template.url && mcpConnectorReadiness(template).is_ready);
    }

    function selectSuggestedMcpConnector(template: SuggestedMcpTemplate) {
        const existing = suggestedMcpServerForTemplate(template);
        if (
            existing &&
            (!template.url || existing.url === template.url) &&
            existing.is_enabled &&
            existing.use_by_default &&
            isMcpServerConnected(existing)
        ) {
            setSelectedMcpServerId(existing.id ?? "");
            setIsMcpConnectorCatalogOpen(false);
            return;
        }
        configureSuggestedMcpConnector(template);
    }

    function friendlyMcpError(message?: string | null) {
        const text = (message || "").trim();
        if (!text) {
            return "";
        }
        if (text.includes("401") || text.toLowerCase().includes("unauthorized")) {
            return "Connect this connector to authorize Ananta.";
        }
        if (text.toLowerCase().includes("url is required")) {
            return "Choose a connector from the catalog.";
        }
        if (text.includes("MCP_GOOGLE_DRIVE_OAUTH_CLIENT_ID") || text.includes("MCP_SLACK_OAUTH_CLIENT_ID")) {
            return "This connector needs an Ananta OAuth app configured by an admin before users can connect.";
        }
        if (text.toLowerCase().includes("dynamic client registration")) {
            return "This connector needs an Ananta OAuth app configured before users can connect.";
        }
        return "This connector needs attention. Try connecting it again.";
    }

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

    function startMcpAuthentication(server: SystemConfig["mcp_server"]) {
        setMcpError("");
        setSelectedMcpServerId(server.id ?? "");
        startTransition(async () => {
            try {
                const saved = await updateMcpServerConfig({
                    id: server.id,
                    is_enabled: true,
                    use_by_default: true,
                    name: server.name ?? null,
                    url: server.url,
                    transport: server.transport,
                    auth_mode: server.auth_mode ?? "oauth",
                    api_key: null,
                    api_key_header_name: server.api_key_header_name,
                    api_key_prefix: server.api_key_prefix,
                    extra_headers: server.extra_headers ?? {},
                    timeout_seconds: server.timeout_seconds
                });
                replaceMcpServer(saved);
                const auth = await startMcpOAuth(`${window.location.origin}/api/mcp/oauth/callback`, saved.id);
                window.open(auth.authorization_url, "_blank", "noopener,noreferrer");
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function clearMcpConfigCompletely(server: SystemConfig["mcp_server"]) {
        setMcpError("");
        setSelectedMcpServerId(server.id ?? "");
        startTransition(async () => {
            try {
                const next = server.id ? await deleteMcpServerConfigById(server.id) : await deleteMcpServerConfig();
                setMcpServers((current) => {
                    const remaining = current.filter((item) => item.id !== server.id);
                    return remaining.length ? remaining : [next];
                });
                setSelectedMcpServerId(next.id ?? "");
            } catch (caught) {
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function configureSuggestedMcpConnector(template: SuggestedMcpTemplate) {
        setMcpError("");
        if (!template.url) {
            setMcpError(`${template.name} needs a hosted MCP endpoint before Ananta can configure it automatically.`);
            return;
        }
        const readiness = mcpConnectorReadiness(template);
        if (!readiness.is_ready) {
            setMcpError(readiness.reason || `${template.name} needs admin setup before users can connect.`);
            return;
        }
        startTransition(async () => {
            let createdServerId: string | null = null;
            try {
                const existing = suggestedMcpServerForTemplate(template);
                const payload = {
                    id: existing?.id,
                    is_enabled: true,
                    use_by_default: true,
                    name: template.name,
                    url: template.url,
                    transport: template.transport,
                    auth_mode: template.authMode,
                    api_key: null,
                    api_key_header_name: "Authorization",
                    api_key_prefix: "Bearer",
                    extra_headers: {},
                    timeout_seconds: 15
                };
                const next = existing ? await updateMcpServerConfig(payload) : await createMcpServerConfig(payload);
                createdServerId = existing ? null : next.id ?? null;
                replaceMcpServer(next);
                setIsMcpConnectorCatalogOpen(false);
                if (template.authMode === "oauth" && !next.oauth_authenticated) {
                    const auth = await startMcpOAuth(`${window.location.origin}/api/mcp/oauth/callback`, next.id);
                    window.open(auth.authorization_url, "_blank", "noopener,noreferrer");
                }
            } catch (caught) {
                if (createdServerId) {
                    try {
                        const next = await deleteMcpServerConfigById(createdServerId);
                        setMcpServers((current) => {
                            const remaining = current.filter((server) => server.id !== createdServerId);
                            return remaining.length ? remaining : [next];
                        });
                        setSelectedMcpServerId(next.id ?? "");
                    } catch {
                        // Best effort: the visible error below is more useful than a rollback failure.
                    }
                }
                setMcpError(parseActionError(caught).message);
            }
        });
    }

    function updateCustomMcpDraft(patch: Partial<CustomMcpDraft>) {
        setCustomMcpDraft((current) => ({ ...current, ...patch }));
    }

    function openCustomMcpSetup() {
        setCustomMcpError("");
        setIsMcpConnectorCatalogOpen(false);
        setIsCustomMcpDialogOpen(true);
    }

    function saveCustomMcpConnector() {
        const name = customMcpDraft.name.trim();
        const url = customMcpDraft.url.trim();
        const apiKey = customMcpDraft.apiKey.trim();
        const apiKeyHeaderName = customMcpDraft.apiKeyHeaderName.trim() || "Authorization";
        const apiKeyPrefix = customMcpDraft.apiKeyPrefix.trim();
        setCustomMcpError("");
        setMcpError("");
        if (!name) {
            setCustomMcpError("Add a display name for this MCP server.");
            return;
        }
        if (!url) {
            setCustomMcpError("Add the hosted MCP endpoint URL.");
            return;
        }
        if (customMcpDraft.authMode === "api_key" && !apiKey) {
            setCustomMcpError("Add the API key for this MCP server.");
            return;
        }
        startTransition(async () => {
            try {
                const next = await createMcpServerConfig({
                    is_enabled: true,
                    use_by_default: true,
                    name,
                    url,
                    transport: customMcpDraft.transport,
                    auth_mode: customMcpDraft.authMode,
                    api_key: customMcpDraft.authMode === "api_key" ? apiKey : null,
                    api_key_header_name: apiKeyHeaderName,
                    api_key_prefix: apiKeyPrefix,
                    extra_headers: {},
                    timeout_seconds: 15
                });
                replaceMcpServer(next);
                setCustomMcpDraft(EMPTY_CUSTOM_MCP_DRAFT);
                setIsCustomMcpDialogOpen(false);
                if (customMcpDraft.authMode === "oauth" && next.id) {
                    try {
                        const auth = await startMcpOAuth(`${window.location.origin}/api/mcp/oauth/callback`, next.id);
                        window.open(auth.authorization_url, "_blank", "noopener,noreferrer");
                    } catch (caught) {
                        setMcpError(parseActionError(caught).message);
                    }
                }
            } catch (caught) {
                setCustomMcpError(parseActionError(caught).message);
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

    const visibleMcpServers = mcpServers.filter((server) => {
        const template = suggestedMcpTemplateForServer(server);
        if (!server.url && !server.name && !template) {
            return false;
        }
        return isMcpServerConnected(server) || !template || mcpConnectorIsReady(template);
    });
    const mcpSetupGuideTemplate = SUGGESTED_MCP_TEMPLATES.find((template) => template.id === mcpSetupGuideTemplateId);

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
                <div className="grid gap-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <div className="text-sm font-bold">Connector catalog</div>
                            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                                Add hosted MCP connectors without entering server details.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                disabled={mcpReadOnly}
                                onClick={openCustomMcpSetup}
                                title={mcpReadOnly ? "Only a workspace admin can add shared MCP servers." : undefined}
                                type="button"
                                variant="outline"
                            >
                                <PlugIcon className="size-4" />
                                Custom MCP
                            </Button>
                            <Dialog open={isMcpConnectorCatalogOpen} onOpenChange={setIsMcpConnectorCatalogOpen}>
                                <DialogTrigger asChild>
                                <Button
                                    disabled={mcpReadOnly}
                                    title={mcpReadOnly ? "Only a workspace admin can add shared MCP servers." : undefined}
                                    type="button"
                                    variant="outline"
                                >
                                    <PlusIcon className="size-4" />
                                    Browse connectors
                                </Button>
                                </DialogTrigger>
                            <DialogContent className="max-h-[88vh] w-[min(1120px,calc(100vw-2rem))] max-w-none p-0">
                                <DialogHeader className="border-b border-border px-8 py-6 pr-16">
                                    <DialogTitle className="text-2xl">MCP connectors</DialogTitle>
                                    <DialogDescription className="mt-2 max-w-3xl text-sm leading-6">
                                        Pick a connector and Ananta will create the hosted MCP config with the right
                                        endpoint, transport, and auth mode.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="border-b border-border px-8 py-5">
                                    <div className="relative">
                                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            className="h-11 pl-8"
                                            inputClassName="pl-8"
                                            onChange={(event) => setMcpConnectorSearch(event.target.value)}
                                            placeholder="Search connectors..."
                                            type="search"
                                            value={mcpConnectorSearch}
                                        />
                                    </div>
                                </div>
                                <div className="max-h-[62vh] overflow-y-auto px-8 py-6">
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-border bg-muted/20 p-4">
                                        <div>
                                            <div className="text-sm font-bold">Have your own hosted MCP server?</div>
                                            <div className="mt-1 text-sm text-muted-foreground">
                                                Add a custom Streamable HTTP or SSE endpoint with OAuth or API-key auth.
                                            </div>
                                        </div>
                                        <Button disabled={mcpReadOnly || isPending} onClick={openCustomMcpSetup} type="button">
                                            <PlugIcon className="size-4" />
                                            Custom MCP
                                        </Button>
                                    </div>
                                    <div className="mb-4 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                                        Recommended for Ananta
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-2 min-[1180px]:grid-cols-3">
                                        {filteredMcpTemplates.map((template) => {
                                            const configured = isSuggestedMcpConfigured(template);
                                            const connected = isSuggestedMcpConnected(template);
                                            const unavailable = !template.url;
                                            const readiness = mcpConnectorReadiness(template);
                                            const ready = mcpConnectorIsReady(template);
                                            return (
                                                <div
                                                    className="min-h-56 border border-border bg-muted/20 p-5"
                                                    key={template.id}
                                                >
                                                    <div className="flex items-start gap-4">
                                                        <span className="flex size-12 shrink-0 items-center justify-center border border-border bg-white p-2">
                                                            <img
                                                                alt={template.logoAlt}
                                                                className="max-h-full max-w-full object-contain"
                                                                draggable={false}
                                                                src={template.logoSrc}
                                                            />
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                <div className="truncate text-base font-bold">
                                                                    {template.name}
                                                                </div>
                                                                <Badge variant={connected || ready ? "success" : "warning"}>
                                                                    {connected
                                                                        ? "Connected"
                                                                        : unavailable
                                                                          ? "Hosted endpoint needed"
                                                                          : ready
                                                                            ? "Ready to connect"
                                                                            : "Admin setup needed"}
                                                                </Badge>
                                                            </div>
                                                            <div className="mt-1 text-sm text-muted-foreground">
                                                                {template.category}
                                                            </div>
                                                        </div>
                                                        {connected ? (
                                                            <span className="inline-flex size-9 shrink-0 items-center justify-center text-[var(--success)]">
                                                                <CheckIcon className="size-4" />
                                                            </span>
                                                        ) : ready ? (
                                                            <Button
                                                                aria-label={`${configured ? "Connect" : "Add"} ${template.name}`}
                                                                disabled={mcpReadOnly || isPending}
                                                                onClick={() => selectSuggestedMcpConnector(template)}
                                                                size="icon"
                                                                title={
                                                                    configured
                                                                        ? "Connect this connector"
                                                                        : unavailable
                                                                          ? "Show setup requirement"
                                                                          : `Add ${template.name}`
                                                                }
                                                                type="button"
                                                                variant="outline"
                                                            >
                                                                <PlusIcon className="size-4" />
                                                            </Button>
                                                        ) : template.setupGuide ? (
                                                            <Button
                                                                aria-label={`How to set up ${template.name}`}
                                                                onClick={() => setMcpSetupGuideTemplateId(template.id)}
                                                                size="icon"
                                                                title={`How to set up ${template.name}`}
                                                                type="button"
                                                                variant="outline"
                                                            >
                                                                <CircleHelpIcon className="size-4" />
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                    <div className="mt-5 text-sm leading-6 text-muted-foreground">
                                                        {template.useCase}
                                                    </div>
                                                    <div className="mt-3 text-sm leading-6 text-muted-foreground">
                                                        {connected
                                                            ? "Connected."
                                                            : !ready
                                                              ? readiness.reason || "Admin setup is required before users can connect."
                                                            : configured
                                                              ? "Saved. Connect to authorize Ananta."
                                                              : template.setupHint}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {filteredMcpTemplates.length ? null : (
                                        <div className="border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                                            No connectors match this search.
                                        </div>
                                    )}
                                </div>
                            </DialogContent>
                            </Dialog>
                        </div>
                        <Dialog
                            open={Boolean(mcpSetupGuideTemplate)}
                            onOpenChange={(open) => {
                                if (!open) {
                                    setMcpSetupGuideTemplateId(null);
                                }
                            }}
                        >
                            <DialogContent className="w-[min(720px,calc(100vw-2rem))] max-w-none p-0">
                                <DialogHeader className="border-b border-border px-6 py-5 pr-14">
                                    <DialogTitle>{mcpSetupGuideTemplate?.setupGuide?.title ?? "Connector setup"}</DialogTitle>
                                    <DialogDescription className="mt-2 max-w-2xl leading-6">
                                        {mcpSetupGuideTemplate?.setupGuide?.intro}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-5 px-6 py-5">
                                    <div>
                                        <div className="text-sm font-bold">Setup steps</div>
                                        <ol className="mt-3 grid gap-3">
                                            {(mcpSetupGuideTemplate?.setupGuide?.steps ?? []).map((step, index) => (
                                                <li
                                                    className="flex gap-3 text-sm leading-6 text-muted-foreground"
                                                    key={step.text}
                                                >
                                                    <span className="flex size-6 shrink-0 items-center justify-center border border-border bg-muted/30 text-xs font-semibold text-foreground">
                                                        {index + 1}
                                                    </span>
                                                    <span>
                                                        {step.text}
                                                        {step.links?.length ? (
                                                            <span className="ml-1 inline-flex flex-wrap gap-x-2 gap-y-1">
                                                                {step.links.map((link) => (
                                                                    <a
                                                                        className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                                                                        href={link.href}
                                                                        key={link.href}
                                                                        rel="noreferrer"
                                                                        target="_blank"
                                                                    >
                                                                        {link.label}
                                                                    </a>
                                                                ))}
                                                            </span>
                                                        ) : null}
                                                        {step.codeItems?.length ? (
                                                            <span className="mt-2 flex flex-wrap gap-2">
                                                                {step.codeItems.map((codeItem) => (
                                                                    <code
                                                                        className="border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground"
                                                                        key={codeItem}
                                                                    >
                                                                        {codeItem}
                                                                    </code>
                                                                ))}
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                        <Dialog
                            open={isCustomMcpDialogOpen}
                            onOpenChange={(open) => {
                                setIsCustomMcpDialogOpen(open);
                                if (!open) {
                                    setCustomMcpError("");
                                }
                            }}
                        >
                            <DialogContent className="w-[min(760px,calc(100vw-2rem))] max-w-none p-0">
                                <DialogHeader className="border-b border-border px-6 py-5 pr-14">
                                    <DialogTitle>Custom MCP server</DialogTitle>
                                    <DialogDescription className="mt-2 max-w-2xl leading-6">
                                        Add a hosted MCP endpoint that is not in the connector catalog. Ananta will save
                                        it as an enabled broker-chat connector.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-5 px-6 py-5">
                                    <div className="grid gap-4 min-[720px]:grid-cols-2">
                                        <label className="grid gap-1.5 text-sm font-medium">
                                            Display name
                                            <Input
                                                autoComplete="off"
                                                disabled={mcpReadOnly || isPending}
                                                onChange={(event) => updateCustomMcpDraft({ name: event.target.value })}
                                                placeholder="Company docs MCP"
                                                value={customMcpDraft.name}
                                            />
                                        </label>
                                        <label className="grid gap-1.5 text-sm font-medium">
                                            Endpoint URL
                                            <Input
                                                autoComplete="off"
                                                disabled={mcpReadOnly || isPending}
                                                onChange={(event) => updateCustomMcpDraft({ url: event.target.value })}
                                                placeholder="https://mcp.example.com/mcp"
                                                type="url"
                                                value={customMcpDraft.url}
                                            />
                                        </label>
                                    </div>
                                    <div className="grid gap-4 min-[720px]:grid-cols-2">
                                        <label className="grid gap-1.5 text-sm font-medium">
                                            Transport
                                            <SimpleSelect
                                                disabled={mcpReadOnly || isPending}
                                                onValueChange={(value) =>
                                                    updateCustomMcpDraft({
                                                        transport: value === "sse" ? "sse" : "streamable_http"
                                                    })
                                                }
                                                options={[
                                                    { value: "streamable_http", label: "Streamable HTTP" },
                                                    { value: "sse", label: "SSE" }
                                                ]}
                                                value={customMcpDraft.transport}
                                            />
                                        </label>
                                        <label className="grid gap-1.5 text-sm font-medium">
                                            Authentication
                                            <SimpleSelect
                                                disabled={mcpReadOnly || isPending}
                                                onValueChange={(value) =>
                                                    updateCustomMcpDraft({
                                                        authMode: value === "api_key" ? "api_key" : "oauth"
                                                    })
                                                }
                                                options={[
                                                    { value: "oauth", label: "OAuth" },
                                                    { value: "api_key", label: "API key" }
                                                ]}
                                                value={customMcpDraft.authMode}
                                            />
                                        </label>
                                    </div>
                                    {customMcpDraft.authMode === "api_key" ? (
                                        <div className="grid gap-4 border border-border bg-muted/20 p-4">
                                            <label className="grid gap-1.5 text-sm font-medium">
                                                API key
                                                <Input
                                                    autoComplete="off"
                                                    data-1p-ignore="true"
                                                    data-form-type="other"
                                                    data-lpignore="true"
                                                    disabled={mcpReadOnly || isPending}
                                                    onChange={(event) =>
                                                        updateCustomMcpDraft({ apiKey: event.target.value })
                                                    }
                                                    placeholder="Paste the connector API key"
                                                    type="password"
                                                    value={customMcpDraft.apiKey}
                                                />
                                            </label>
                                            <div className="grid gap-4 min-[720px]:grid-cols-2">
                                                <label className="grid gap-1.5 text-sm font-medium">
                                                    Header name
                                                    <Input
                                                        autoComplete="off"
                                                        disabled={mcpReadOnly || isPending}
                                                        onChange={(event) =>
                                                            updateCustomMcpDraft({
                                                                apiKeyHeaderName: event.target.value
                                                            })
                                                        }
                                                        placeholder="Authorization"
                                                        value={customMcpDraft.apiKeyHeaderName}
                                                    />
                                                </label>
                                                <label className="grid gap-1.5 text-sm font-medium">
                                                    Prefix
                                                    <Input
                                                        autoComplete="off"
                                                        disabled={mcpReadOnly || isPending}
                                                        onChange={(event) =>
                                                            updateCustomMcpDraft({ apiKeyPrefix: event.target.value })
                                                        }
                                                        placeholder="Bearer"
                                                        value={customMcpDraft.apiKeyPrefix}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="border border-border bg-muted/20 px-4 py-3 text-sm leading-6 text-muted-foreground">
                                            Ananta will open this MCP server&apos;s OAuth authorization flow after saving.
                                            The server must expose MCP-compatible OAuth metadata.
                                        </div>
                                    )}
                                    {customMcpError ? <div className="text-sm text-destructive">{customMcpError}</div> : null}
                                    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
                                        <Button
                                            disabled={isPending}
                                            onClick={() => setIsCustomMcpDialogOpen(false)}
                                            type="button"
                                            variant="ghost"
                                        >
                                            Cancel
                                        </Button>
                                        <Button disabled={mcpReadOnly || isPending} onClick={saveCustomMcpConnector} type="button">
                                            {customMcpDraft.authMode === "oauth" ? "Save and connect" : "Save connector"}
                                        </Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
                <div className="grid gap-3" data-onboarding="mcp-server-config-section">
                    {mcpReadOnly ? (
                        <div className="border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            These MCP servers are shared for the workspace. You can use granted MCP access in broker
                            chat, but only an allowed admin can change this shared setup.
                        </div>
                    ) : null}
                    {visibleMcpServers.length ? (
                        <div className="grid gap-3 min-[760px]:grid-cols-2">
                            {visibleMcpServers.map((server) => {
                                const template = suggestedMcpTemplateForServer(server);
                                const logoSrc = template?.logoSrc ?? "/logo-mark.svg";
                                const logoAlt = template?.logoAlt ?? "MCP connector logo";
                                const name = server.name || template?.name || "MCP connector";
                                const connected = isMcpServerConnected(server);
                                const error = friendlyMcpError(
                                    (server.id === selectedMcpServerId ? mcpError : "") ||
                                        server.oauth_last_error ||
                                        server.inventory_error
                                );
                                return (
                                    <div className="border border-border p-4" key={server.id || `${server.url}-${name}`}>
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="flex min-w-0 items-center gap-3">
                                                <span className="flex size-10 shrink-0 items-center justify-center border border-border bg-white p-1.5">
                                                    <img
                                                        alt={logoAlt}
                                                        className="max-h-full max-w-full object-contain"
                                                        draggable={false}
                                                        src={logoSrc}
                                                    />
                                                </span>
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-bold">{name}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        {connected
                                                            ? "Ready for broker chat."
                                                            : "Connect this connector to use it in broker chat."}
                                                    </div>
                                                </div>
                                            </div>
                                            <Badge variant={connected ? "success" : "warning"}>
                                                {connected ? "Connected" : "Connect required"}
                                            </Badge>
                                        </div>

                                        {connected ? (
                                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                                <div className="flex items-center gap-2 text-xs font-medium text-[var(--success)]">
                                                    <CheckIcon className="size-4" />
                                                    Available in broker chat when MCP is enabled.
                                                </div>
                                                <Button
                                                    disabled={mcpReadOnly || isPending}
                                                    onClick={() => clearMcpConfigCompletely(server)}
                                                    title={
                                                        mcpReadOnly
                                                            ? "Only a workspace admin can remove shared MCP servers."
                                                            : undefined
                                                    }
                                                    type="button"
                                                    variant="destructive"
                                                >
                                                    Remove connector
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                <Button
                                                    disabled={mcpReadOnly || isPending || !server.url}
                                                    onClick={() => startMcpAuthentication(server)}
                                                    title={
                                                        mcpReadOnly
                                                            ? "Only a workspace admin can connect shared MCP servers."
                                                            : undefined
                                                    }
                                                    type="button"
                                                >
                                                    Connect
                                                </Button>
                                                <Button
                                                    disabled={mcpReadOnly || isPending}
                                                    onClick={() => clearMcpConfigCompletely(server)}
                                                    title={
                                                        mcpReadOnly
                                                            ? "Only a workspace admin can remove shared MCP servers."
                                                            : undefined
                                                    }
                                                    type="button"
                                                    variant="destructive"
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        )}

                                        {error ? <div className="mt-3 text-sm text-destructive">{error}</div> : null}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex min-h-32 flex-col items-center justify-center text-center">
                            <span className="flex size-16 items-center justify-center border border-dashed border-border bg-muted/30 text-muted-foreground">
                                <PlugIcon className="size-7" />
                            </span>
                            <div className="mt-3 text-sm font-bold">No MCP connector selected</div>
                            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                                Pick a hosted connector from the catalog to add market, document, or support tools to
                                broker chat.
                            </p>
                        </div>
                    )}
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
                                <LlmProviderSetupGuideDialog label={provider.label} provider={provider.provider} />
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
