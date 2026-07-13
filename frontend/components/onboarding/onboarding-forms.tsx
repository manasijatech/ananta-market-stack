"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import {
    IconArrowRight,
    IconBook,
    IconBrain,
    IconBuildingBank,
    IconChartBar,
    IconPlugConnected,
    IconRocket
} from "@tabler/icons-react";
import { parseActionError } from "@/components/brokers/action-error";
import { BrokerLogo, brokerNames } from "@/components/brokers/ui";
import { useOnboardingMotion } from "@/components/onboarding/onboarding-motion";
import { LlmProviderSetupGuideDialog } from "@/components/system/llm-provider-setup-guide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { onboardingStepPath, type OnboardingSetupData } from "@/lib/setup-readiness";
import { cn } from "@/lib/utils";
import { brokerGuides } from "@/service/broker-guides";
import {
    createBrokerAccount,
    createMcpServerConfig,
    upsertAlphaApiCredential,
    upsertLlmProviderCredential
} from "@/service/actions/broker";
import type { BrokerCode, CreateBrokerAccountPayload, LlmProvider, SystemConfig } from "@/service/types/broker";

type GrowwMode = "approval" | "totp" | "token";

const fallbackBrokers: BrokerCode[] = ["zerodha", "upstox", "angel", "dhan", "groww", "indmoney", "kotak"];
const providerLabels: Record<LlmProvider, string> = {
    openai: "OpenAI",
    openrouter: "OpenRouter",
    gemini: "Gemini",
    anthropic: "Anthropic"
};

function fieldValue(formData: FormData, key: string): string {
    return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string): string | null {
    return fieldValue(formData, key) || null;
}

function defaultBrokerLabel(broker: BrokerCode) {
    return `${brokerNames[broker]} main`;
}

function makeBrokerPayload(
    broker: BrokerCode,
    growwMode: GrowwMode,
    formData: FormData,
    defaultRedirectUri: string
): CreateBrokerAccountPayload {
    const label = fieldValue(formData, "label") || defaultBrokerLabel(broker);

    switch (broker) {
        case "zerodha":
            return { broker, label, api_key: fieldValue(formData, "api_key"), api_secret: fieldValue(formData, "api_secret") };
        case "upstox":
            return {
                broker,
                label,
                api_key: fieldValue(formData, "api_key"),
                api_secret: fieldValue(formData, "api_secret"),
                redirect_uri: fieldValue(formData, "redirect_uri") || defaultRedirectUri
            };
        case "angel":
            return { broker, label, api_key: fieldValue(formData, "api_key"), client_code: fieldValue(formData, "client_code") };
        case "dhan":
            return {
                broker,
                label,
                app_id: fieldValue(formData, "app_id"),
                app_secret: fieldValue(formData, "app_secret"),
                client_id: fieldValue(formData, "client_id")
            };
        case "groww":
            return {
                broker,
                label,
                api_key: growwMode === "approval" ? nullableValue(formData, "api_key") : null,
                api_secret: growwMode === "approval" ? nullableValue(formData, "api_secret") : null,
                totp_token: growwMode === "totp" ? nullableValue(formData, "totp_token") : null,
                totp_secret: growwMode === "totp" ? nullableValue(formData, "totp_secret") : null,
                access_token: growwMode === "token" ? nullableValue(formData, "access_token") : null
            };
        case "indmoney":
            return { broker, label, access_token: nullableValue(formData, "access_token") };
        case "kotak":
            return {
                broker,
                label,
                ucc: fieldValue(formData, "ucc"),
                portal_access_token: fieldValue(formData, "portal_access_token")
            };
    }
}

function SetupField({
    resetKey,
    description,
    error,
    label,
    name,
    placeholder,
    type = "text",
    defaultValue
}: {
    resetKey?: string;
    description?: string;
    error?: string;
    label: string;
    name: string;
    placeholder?: string;
    type?: string;
    defaultValue?: string;
}) {
    const [value, setValue] = useState(defaultValue ?? "");

    useEffect(() => {
        setValue(defaultValue ?? "");
    }, [defaultValue, resetKey]);

    return (
        <Field data-onboarding-motion-item>
            <FieldLabel htmlFor={`onboarding-${name}`}>{label}</FieldLabel>
            <Input
                autoComplete="off"
                className="onboarding-input-control"
                data-1p-ignore="true"
                data-form-type="other"
                data-lpignore="true"
                inputClassName="onboarding-input"
                id={`onboarding-${name}`}
                name={name}
                onChange={(event) => setValue(event.currentTarget.value)}
                placeholder={placeholder}
                type={type}
                value={value}
            />
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            {error ? <FieldError>{error}</FieldError> : null}
        </Field>
    );
}

function useOnboardingMutation() {
    const { navigateTo } = useOnboardingMotion();
    const [formError, setFormError] = useState("");
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isPending, startTransition] = useTransition();

    function run<T>(fn: () => Promise<T>, nextPath: string) {
        setFormError("");
        setFieldErrors({});
        startTransition(() => {
            void (async () => {
                try {
                    await fn();
                    navigateTo(nextPath);
                } catch (error) {
                    const parsed = parseActionError(error);
                    setFormError(parsed.message);
                    setFieldErrors(parsed.fieldErrors);
                }
            })();
        });
    }

    return { fieldErrors, formError, isPending, run };
}

export function WelcomeStep() {
    const { navigateTo } = useOnboardingMotion();

    return (
        <Card className="grid gap-6 rounded-lg p-6">
            <div
                className="flex size-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"
                data-onboarding-motion-item
            >
                <IconRocket className="size-6" stroke={1.8} />
            </div>
            <div className="grid gap-2" data-onboarding-motion-item>
                <Badge className="w-fit" variant="secondary">First run</Badge>
                <h1 className="text-2xl font-bold tracking-tight">Set up your market workspace</h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                    Complete broker, Drishti, and LLM setup before entering the app. MCP is optional and can be skipped.
                </p>
            </div>
            <div className="grid gap-3 min-[760px]:grid-cols-3" data-onboarding-motion-item>
                <div className="border border-border p-4">
                    <IconBuildingBank className="mb-3 size-5 text-primary" stroke={1.8} />
                    <div className="text-sm font-bold">Connect a broker</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Live data and portfolio context.</p>
                </div>
                <div className="border border-border p-4">
                    <IconChartBar className="mb-3 size-5 text-primary" stroke={1.8} />
                    <div className="text-sm font-bold">Add Drishti</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Market intelligence and metadata.</p>
                </div>
                <div className="border border-border p-4">
                    <IconBrain className="mb-3 size-5 text-primary" stroke={1.8} />
                    <div className="text-sm font-bold">Configure LLM</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Chat and alert analysis.</p>
                </div>
            </div>
            <div data-onboarding-motion-item>
                <Button
                    className="onboarding-cta"
                    render={
                        <Link
                            href={onboardingStepPath("broker")}
                            onClick={(event) => {
                                event.preventDefault();
                                navigateTo(onboardingStepPath("broker"));
                            }}
                        />
                    }
                >
                    Start setup
                    <IconArrowRight className="size-4" stroke={1.8} />
                </Button>
            </div>
        </Card>
    );
}

export function BrokerStep({ data }: { data: OnboardingSetupData }) {
    const supportedBrokers = data.supportedBrokers.length ? data.supportedBrokers : fallbackBrokers;
    const [broker, setBroker] = useState<BrokerCode>(supportedBrokers[0] ?? "zerodha");
    const [growwMode, setGrowwMode] = useState<GrowwMode>("approval");
    const [defaultRedirectUri, setDefaultRedirectUri] = useState("http://localhost:3000/broker-connections");
    const { fieldErrors, formError, isPending, run } = useOnboardingMutation();
    const guide = brokerGuides[broker];

    useEffect(() => {
        setDefaultRedirectUri(`${window.location.origin}/broker-connections`);
    }, []);

    function submitBroker(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const payload = makeBrokerPayload(broker, growwMode, formData, defaultRedirectUri);
        run(() => createBrokerAccount(payload), onboardingStepPath("drishti"));
    }

    return (
        <Card className="grid gap-5 rounded-lg p-6">
            <div data-onboarding-motion-item>
                <h1 className="text-2xl font-bold tracking-tight">Connect a broker</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Add one broker account to unlock broker-backed data.
                </p>
            </div>
            <form className="grid gap-4" onSubmit={submitBroker}>
                <Field data-onboarding-motion-item>
                    <FieldLabel>Broker</FieldLabel>
                    <div className="grid w-full gap-2 min-[560px]:grid-cols-2 min-[900px]:grid-cols-4">
                        {supportedBrokers.map((code) => {
                            const selected = code === broker;

                            return (
                                <button
                                    aria-pressed={selected}
                                    className={cn(
                                        "flex min-h-14 w-full items-center gap-3 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                                        selected
                                            ? "border-primary bg-primary/10 text-foreground"
                                            : "border-border text-muted-foreground"
                                    )}
                                    key={code}
                                    onClick={() => setBroker(code)}
                                    type="button"
                                >
                                    <BrokerLogo
                                        broker={code}
                                        className="size-8"
                                        imageClassName="size-7 rounded-md"
                                    />
                                    <span className="min-w-0 truncate font-medium">{brokerNames[code]}</span>
                                </button>
                            );
                        })}
                    </div>
                    {guide ? (
                        <Link
                            className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                            href={`/docs/${broker}`}
                            rel="noreferrer"
                            target="_blank"
                        >
                            <IconBook className="size-3.5" stroke={1.8} />
                            View {brokerNames[broker]} setup docs
                        </Link>
                    ) : null}
                </Field>
                <SetupField
                    defaultValue={defaultBrokerLabel(broker)}
                    error={fieldErrors.label}
                    label="Account label"
                    name="label"
                    resetKey={broker}
                />
                {broker === "zerodha" ? (
                    <>
                        <SetupField error={fieldErrors.api_key} label="API key" name="api_key" resetKey={broker} />
                        <SetupField
                            error={fieldErrors.api_secret}
                            label="API secret"
                            name="api_secret"
                            resetKey={broker}
                            type="password"
                        />
                    </>
                ) : null}
                {broker === "upstox" ? (
                    <>
                        <SetupField error={fieldErrors.api_key} label="API key" name="api_key" resetKey={broker} />
                        <SetupField
                            error={fieldErrors.api_secret}
                            label="API secret"
                            name="api_secret"
                            resetKey={broker}
                            type="password"
                        />
                        <SetupField
                            defaultValue={defaultRedirectUri}
                            error={fieldErrors.redirect_uri}
                            label="Redirect URI"
                            name="redirect_uri"
                            resetKey={`${broker}:${defaultRedirectUri}`}
                        />
                    </>
                ) : null}
                {broker === "angel" ? (
                    <>
                        <SetupField error={fieldErrors.api_key} label="API key" name="api_key" resetKey={broker} />
                        <SetupField error={fieldErrors.client_code} label="Client code" name="client_code" resetKey={broker} />
                    </>
                ) : null}
                {broker === "dhan" ? (
                    <>
                        <SetupField error={fieldErrors.app_id} label="App ID" name="app_id" resetKey={broker} />
                        <SetupField
                            error={fieldErrors.app_secret}
                            label="App secret"
                            name="app_secret"
                            resetKey={broker}
                            type="password"
                        />
                        <SetupField error={fieldErrors.client_id} label="Client ID" name="client_id" resetKey={broker} />
                    </>
                ) : null}
                {broker === "groww" ? (
                    <>
                        <Field data-onboarding-motion-item>
                            <FieldLabel>Groww auth mode</FieldLabel>
                            <SimpleSelect
                                onValueChange={(value) => setGrowwMode(value as GrowwMode)}
                                options={[
                                    { value: "approval", label: "Approval API key" },
                                    { value: "totp", label: "TOTP" },
                                    { value: "token", label: "Access token" }
                                ]}
                                value={growwMode}
                            />
                        </Field>
                        {growwMode === "approval" ? (
                            <>
                                <SetupField
                                    error={fieldErrors.api_key}
                                    label="API key"
                                    name="api_key"
                                    resetKey={`${broker}:${growwMode}`}
                                />
                                <SetupField
                                    error={fieldErrors.api_secret}
                                    label="API secret"
                                    name="api_secret"
                                    resetKey={`${broker}:${growwMode}`}
                                    type="password"
                                />
                            </>
                        ) : null}
                        {growwMode === "totp" ? (
                            <>
                                <SetupField
                                    error={fieldErrors.totp_token}
                                    label="TOTP token"
                                    name="totp_token"
                                    resetKey={`${broker}:${growwMode}`}
                                />
                                <SetupField
                                    error={fieldErrors.totp_secret}
                                    label="TOTP secret"
                                    name="totp_secret"
                                    resetKey={`${broker}:${growwMode}`}
                                    type="password"
                                />
                            </>
                        ) : null}
                        {growwMode === "token" ? (
                            <SetupField
                                error={fieldErrors.access_token}
                                label="Access token"
                                name="access_token"
                                resetKey={`${broker}:${growwMode}`}
                                type="password"
                            />
                        ) : null}
                    </>
                ) : null}
                {broker === "indmoney" ? (
                    <SetupField
                        error={fieldErrors.access_token}
                        label="Access token"
                        name="access_token"
                        resetKey={broker}
                        type="password"
                    />
                ) : null}
                {broker === "kotak" ? (
                    <>
                        <SetupField error={fieldErrors.ucc} label="UCC" name="ucc" resetKey={broker} />
                        <SetupField
                            error={fieldErrors.portal_access_token}
                            label="Portal access token"
                            name="portal_access_token"
                            resetKey={broker}
                            type="password"
                        />
                    </>
                ) : null}
                {formError ? <FieldError>{formError}</FieldError> : null}
                <Button className="onboarding-cta w-fit" data-onboarding-motion-item disabled={isPending} type="submit">
                    {isPending ? "Saving..." : "Connect broker"}
                </Button>
            </form>
        </Card>
    );
}

export function DrishtiStep({ config }: { config: SystemConfig }) {
    const [alphaEnabled, setAlphaEnabled] = useState(true);
    const { fieldErrors, formError, isPending, run } = useOnboardingMutation();

    function submitAlpha(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        run(
            () =>
                upsertAlphaApiCredential({
                    api_key: fieldValue(formData, "alpha_api_key"),
                    is_enabled: alphaEnabled
                }),
            onboardingStepPath("llm-provider")
        );
    }

    return (
        <Card className="grid gap-5 rounded-lg p-6">
            <div data-onboarding-motion-item>
                <h1 className="text-2xl font-bold tracking-tight">Add Drishti API key</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Enable market intelligence, symbol metadata, announcements, concalls, and summaries.
                </p>
            </div>
            <form className="grid gap-4" onSubmit={submitAlpha}>
                <SetupField
                    error={fieldErrors.api_key || fieldErrors.alpha_api_key}
                    label="Drishti API key"
                    name="alpha_api_key"
                    placeholder={config.alpha_api.has_api_key ? "Replace saved key" : "Paste API key"}
                    type="password"
                />
                <Field orientation="horizontal">
                    <Switch checked={alphaEnabled} onCheckedChange={(checked) => setAlphaEnabled(Boolean(checked))} />
                    <div className="grid gap-1">
                        <FieldLabel>Enable Drishti calls</FieldLabel>
                        <FieldDescription>Keep this enabled for setup readiness.</FieldDescription>
                    </div>
                </Field>
                {formError ? <FieldError>{formError}</FieldError> : null}
                <Button
                    className="onboarding-cta w-fit"
                    data-onboarding-motion-item
                    disabled={isPending || !alphaEnabled}
                    type="submit"
                >
                    {isPending ? "Saving..." : "Save Drishti key"}
                </Button>
            </form>
        </Card>
    );
}

export function LlmProviderStep({ config }: { config: SystemConfig }) {
    const [llmProvider, setLlmProvider] = useState<LlmProvider>(config.llm_providers[0]?.provider ?? "openai");
    const { fieldErrors, formError, isPending, run } = useOnboardingMutation();
    const selectedProvider = config.llm_providers.find((provider) => provider.provider === llmProvider);

    function submitLlm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        run(
            () =>
                upsertLlmProviderCredential(llmProvider, {
                    api_key: fieldValue(formData, "llm_api_key"),
                    is_enabled: true
                }),
            onboardingStepPath("mcp")
        );
    }

    return (
        <Card className="grid gap-5 rounded-lg p-6">
            <div data-onboarding-motion-item>
                <h1 className="text-2xl font-bold tracking-tight">Configure an LLM provider</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Store one provider key for broker chat and alert analysis.
                </p>
            </div>
            <form className="grid gap-4" onSubmit={submitLlm}>
                <Field data-onboarding-motion-item>
                    <div className="flex items-center gap-1.5">
                        <FieldLabel>Provider</FieldLabel>
                        <LlmProviderSetupGuideDialog
                            label={selectedProvider?.label || providerLabels[llmProvider]}
                            provider={llmProvider}
                            triggerClassName="size-5 border-transparent bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3.5"
                        />
                    </div>
                    <SimpleSelect
                        onValueChange={(value) => setLlmProvider(value as LlmProvider)}
                        options={config.llm_providers.map((provider) => ({
                            value: provider.provider,
                            label: provider.label || providerLabels[provider.provider]
                        }))}
                        value={llmProvider}
                    />
                </Field>
                <SetupField
                    error={fieldErrors.api_key || fieldErrors.llm_api_key}
                    label={`${providerLabels[llmProvider]} API key`}
                    name="llm_api_key"
                    placeholder="Paste API key"
                    type="password"
                />
                {formError ? <FieldError>{formError}</FieldError> : null}
                <Button className="onboarding-cta w-fit" data-onboarding-motion-item disabled={isPending} type="submit">
                    {isPending ? "Saving..." : "Save LLM provider"}
                </Button>
            </form>
        </Card>
    );
}

export function McpStep() {
    const { navigateTo } = useOnboardingMotion();
    const { fieldErrors, formError, isPending, run } = useOnboardingMutation();

    function submitMcp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        run(
            () =>
                createMcpServerConfig({
                    is_enabled: true,
                    use_by_default: true,
                    name: nullableValue(formData, "mcp_name"),
                    url: fieldValue(formData, "mcp_url"),
                    transport: "streamable_http",
                    auth_mode: "api_key",
                    api_key: nullableValue(formData, "mcp_api_key"),
                    api_key_header_name: "Authorization",
                    api_key_prefix: "Bearer",
                    extra_headers: {},
                    timeout_seconds: 15
                }),
            "/dashboard"
        );
    }

    return (
        <Card className="grid gap-5 rounded-lg p-6">
            <div data-onboarding-motion-item>
                <div className="flex flex-wrap items-center gap-2">
                    <IconPlugConnected className="size-5 text-primary" stroke={1.8} />
                    <Badge variant="secondary">Optional</Badge>
                </div>
                <h1 className="mt-3 text-2xl font-bold tracking-tight">Connect MCP servers</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Add an API-key-auth hosted MCP server now, or skip and configure OAuth later in Settings.
                </p>
            </div>
            <form className="grid gap-4" onSubmit={submitMcp}>
                <SetupField error={fieldErrors.name} label="Server name" name="mcp_name" placeholder="Research tools" />
                <SetupField error={fieldErrors.url} label="Server URL" name="mcp_url" placeholder="https://example.com/mcp" />
                <SetupField
                    description="Saved as an Authorization Bearer token."
                    error={fieldErrors.api_key}
                    label="API key"
                    name="mcp_api_key"
                    type="password"
                />
                {formError ? <FieldError>{formError}</FieldError> : null}
                <div className="flex flex-col gap-2 min-[520px]:flex-row">
                    <Button className="onboarding-cta" disabled={isPending} type="submit">
                        {isPending ? "Saving..." : "Connect MCP"}
                    </Button>
                    <Button
                        className="onboarding-cta"
                        disabled={isPending}
                        onClick={() => navigateTo("/dashboard")}
                        type="button"
                        variant="outline"
                    >
                        Skip and go to dashboard
                    </Button>
                    <Button
                        className="onboarding-cta"
                        disabled={isPending}
                        onClick={() => navigateTo("/dashboard")}
                        type="button"
                        variant="ghost"
                    >
                        Finish setup
                    </Button>
                </div>
            </form>
        </Card>
    );
}
