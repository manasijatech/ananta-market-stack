"use client";

import Link from "next/link";
import {
	useEffect,
	useState,
	useTransition,
	type FormEvent,
	type ReactNode,
} from "react";
import {
	IconArrowRight,
	IconBook,
	IconBrain,
	IconBuildingBank,
	IconChartBar,
	IconPlugConnected,
	IconRocket,
} from "@tabler/icons-react";
import { parseActionError } from "@/components/brokers/action-error";
import { BrokerLogo, brokerNames } from "@/components/brokers/ui";
import { useOnboardingMotion } from "@/components/onboarding/onboarding-motion";
import { LlmProviderSetupGuideDialog } from "@/components/system/llm-provider-setup-guide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import {
	onboardingStepPath,
	type OnboardingSetupData,
} from "@/lib/setup-readiness";
import { cn } from "@/lib/utils";
import { brokerGuides } from "@/service/broker-guides";
import {
	createBrokerAccount,
	createMcpServerConfig,
	upsertAlphaApiCredential,
	upsertLlmProviderCredential,
} from "@/service/actions/broker";
import type {
	BrokerCode,
	CreateBrokerAccountPayload,
	LlmProvider,
	SystemConfig,
} from "@/service/types/broker";

type GrowwMode = "approval" | "totp" | "token";

const fallbackBrokers: BrokerCode[] = [
	"zerodha",
	"upstox",
	"angel",
	"dhan",
	"groww",
	"indmoney",
	"kotak",
];
const providerLabels: Record<LlmProvider, string> = {
	openai: "OpenAI",
	openrouter: "OpenRouter",
	gemini: "Gemini",
	anthropic: "Anthropic",
};
const providerLogos: Record<LlmProvider, { src: string; alt: string }> = {
	openai: {
		src: "/brand/providers/openai.svg",
		alt: "OpenAI logo",
	},
	openrouter: {
		src: "/brand/providers/openrouter.svg",
		alt: "OpenRouter logo",
	},
	gemini: {
		src: "/brand/providers/gemini.svg",
		alt: "Google Gemini logo",
	},
	anthropic: {
		src: "/brand/providers/anthropic.svg",
		alt: "Anthropic logo",
	},
};
const stepCardClassName =
	"onboarding-step-card grid w-full gap-4 rounded-lg border-border/70 bg-card/80 px-3 py-3 sm:px-4 sm:py-4 min-[760px]:gap-5 min-[760px]:px-5 min-[760px]:py-5 2xl:px-6 2xl:py-5";
const stepFormClassName = "grid gap-3 min-[760px]:gap-4";
const twoColumnFieldClassName = "grid items-start gap-3 min-[900px]:grid-cols-2";

const stepCopy = {
	broker: {
		title: "Connect a broker",
		description: "Add one broker account for live data and portfolio context.",
		sectionTitle: "Credentials",
		sectionDescription: "Use the credentials from your broker developer dashboard.",
	},
	drishti: {
		title: "Add Drishti",
		description: "Connect the market data API used for symbols, filings, and summaries.",
		sectionTitle: "API access",
		sectionDescription: "Paste your Drishti key and keep calls enabled for setup.",
	},
	llm: {
		title: "Configure an LLM provider",
		description: "Save one provider key for broker chat and alert analysis.",
		sectionTitle: "Provider key",
		sectionDescription: "Choose the provider you use, then paste its API key.",
	},
	mcp: {
		title: "Connect MCP servers",
		description: "Add a hosted MCP server now, or skip this step.",
		sectionTitle: "Server details",
		sectionDescription: "Use an API-key-auth server. OAuth can be configured later.",
	},
};

const providerKeyPlaceholders: Record<LlmProvider, string> = {
	openai: "Paste your OpenAI API key",
	openrouter: "Paste your OpenRouter API key",
	gemini: "Paste your Gemini API key",
	anthropic: "Paste your Anthropic API key",
};
const drishtiDeveloperPortalUrl = "https://platform.manasija.in/developer-portal";

function brokerFieldPlaceholder(
	broker: BrokerCode,
	name: string,
	defaultRedirectUri: string,
): string {
	if (name === "label") return defaultBrokerLabel(broker);

	const placeholders: Partial<Record<BrokerCode, Record<string, string>>> = {
		angel: {
			api_key: "Paste Angel One API key",
			client_code: "Enter Angel One client code",
		},
		dhan: {
			app_id: "Enter Dhan app ID",
			app_secret: "Paste Dhan app secret",
			client_id: "Enter Dhan client ID",
		},
		groww: {
			api_key: "Paste Groww API key",
			api_secret: "Paste Groww API secret",
			totp_token: "Enter current TOTP code",
			totp_secret: "Paste TOTP secret",
			access_token: "Paste Groww access token",
		},
		indmoney: {
			access_token: "Paste INDmoney access token",
		},
		kotak: {
			ucc: "Enter Kotak UCC",
			portal_access_token: "Paste portal access token",
		},
		upstox: {
			api_key: "Paste Upstox API key",
			api_secret: "Paste Upstox API secret",
			redirect_uri: defaultRedirectUri,
		},
		zerodha: {
			api_key: "Paste Zerodha API key",
			api_secret: "Paste Zerodha API secret",
		},
	};

	return placeholders[broker]?.[name] ?? "";
}

function brokerFieldDescription(
	broker: BrokerCode,
	name: string,
): string | undefined {
	if (name === "label")
		return "A friendly name for this broker connection inside Ananta.";
	if (name === "redirect_uri")
		return "Use this exact URL in your broker developer dashboard.";

	const brokerName = brokerNames[broker];
	const descriptions: Record<string, string> = {
		api_key: `From your ${brokerName} developer dashboard.`,
		api_secret: `Secret generated with your ${brokerName} app credentials.`,
		app_id: `App identifier from your ${brokerName} developer console.`,
		app_secret: `Secret generated for your ${brokerName} app.`,
		client_code: `Your ${brokerName} trading client code.`,
		client_id: `Client ID assigned to your ${brokerName} app.`,
		totp_token: "Current six-digit authenticator code.",
		totp_secret: "TOTP seed from your broker setup flow.",
		access_token: `Access token generated by ${brokerName}.`,
		ucc: "Your Kotak Unique Client Code.",
		portal_access_token: "Token copied from the Kotak developer portal.",
	};

	return descriptions[name];
}

function fieldValue(formData: FormData, key: string): string {
	return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string): string | null {
	return fieldValue(formData, key) || null;
}

function defaultBrokerLabel(broker: BrokerCode) {
	return `${brokerNames[broker]} main`;
}

function OnboardingFormError({ message }: { message: string }) {
	return (
		<p className="text-xs text-destructive-foreground" role="alert">
			{message}
		</p>
	);
}

function StepIntro({
	badge,
	description,
	icon,
	title,
}: {
	badge?: ReactNode;
	description: string;
	icon?: ReactNode;
	title: string;
}) {
	return (
		<div data-onboarding-motion-item>
			{badge || icon ? (
				<div className="mb-3 flex flex-wrap items-center gap-2">
					{icon}
					{badge}
				</div>
			) : null}
			<h1 className="text-2xl font-bold tracking-tight">{title}</h1>
			<p className="mt-2 text-sm leading-6 text-muted-foreground">
				{description}
			</p>
		</div>
	);
}

function SetupSectionIntro({
	description,
	title,
}: {
	description: string;
	title: string;
}) {
	return (
		<div className="border-t border-border pt-4" data-onboarding-motion-item>
			<p className="text-sm font-semibold text-foreground">{title}</p>
			<p className="mt-1 text-xs text-muted-foreground">{description}</p>
		</div>
	);
}

function StepActions({ children }: { children: ReactNode }) {
	return (
		<div
			className="flex flex-col justify-end gap-2 border-t border-border pt-4 min-[520px]:flex-row"
			data-onboarding-motion-item
		>
			{children}
		</div>
	);
}

function makeBrokerPayload(
	broker: BrokerCode,
	growwMode: GrowwMode,
	formData: FormData,
	defaultRedirectUri: string,
): CreateBrokerAccountPayload {
	const label = fieldValue(formData, "label") || defaultBrokerLabel(broker);

	switch (broker) {
		case "zerodha":
			return {
				broker,
				label,
				api_key: fieldValue(formData, "api_key"),
				api_secret: fieldValue(formData, "api_secret"),
			};
		case "upstox":
			return {
				broker,
				label,
				api_key: fieldValue(formData, "api_key"),
				api_secret: fieldValue(formData, "api_secret"),
				redirect_uri:
					fieldValue(formData, "redirect_uri") || defaultRedirectUri,
			};
		case "angel":
			return {
				broker,
				label,
				api_key: fieldValue(formData, "api_key"),
				client_code: fieldValue(formData, "client_code"),
			};
		case "dhan":
			return {
				broker,
				label,
				app_id: fieldValue(formData, "app_id"),
				app_secret: fieldValue(formData, "app_secret"),
				client_id: fieldValue(formData, "client_id"),
			};
		case "groww":
			return {
				broker,
				label,
				api_key:
					growwMode === "approval" ? nullableValue(formData, "api_key") : null,
				api_secret:
					growwMode === "approval"
						? nullableValue(formData, "api_secret")
						: null,
				totp_token:
					growwMode === "totp" ? nullableValue(formData, "totp_token") : null,
				totp_secret:
					growwMode === "totp" ? nullableValue(formData, "totp_secret") : null,
				access_token:
					growwMode === "token"
						? nullableValue(formData, "access_token")
						: null,
			};
		case "indmoney":
			return {
				broker,
				label,
				access_token: nullableValue(formData, "access_token"),
			};
		case "kotak":
			return {
				broker,
				label,
				ucc: fieldValue(formData, "ucc"),
				portal_access_token: fieldValue(formData, "portal_access_token"),
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
	readOnly,
	type = "text",
	defaultValue,
}: {
	resetKey?: string;
	description?: string;
	error?: string;
	label: string;
	name: string;
	placeholder?: string;
	readOnly?: boolean;
	type?: string;
	defaultValue?: string;
}) {
	const [value, setValue] = useState(defaultValue ?? "");

	useEffect(() => {
		setValue(defaultValue ?? "");
	}, [defaultValue, resetKey]);

	return (
		<Field
			className="onboarding-field"
			data-onboarding-motion-item
			invalid={Boolean(error)}
		>
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
				readOnly={readOnly}
				type={type}
				value={value}
				aria-invalid={error ? true : undefined}
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
		<Card className={stepCardClassName}>
			<div
				className="flex size-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"
				data-onboarding-motion-item
			>
				<IconRocket className="size-6" stroke={1.8} />
			</div>
			<div className="grid gap-2" data-onboarding-motion-item>
				<Badge className="w-fit" variant="secondary">
					First run
				</Badge>
				<h1 className="text-2xl font-bold tracking-tight">
					Set up your market workspace
				</h1>
				<p className="max-w-2xl text-sm leading-6 text-muted-foreground">
					Complete broker, Drishti, and LLM setup before entering the app. MCP
					is optional and can be skipped.
				</p>
			</div>
			<div
				className="grid gap-3 min-[760px]:grid-cols-3"
				data-onboarding-motion-item
			>
				<div className="border border-border p-4">
					<IconBuildingBank className="mb-3 size-5 text-primary" stroke={1.8} />
					<div className="text-sm font-bold">Connect a broker</div>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						Live data and portfolio context.
					</p>
				</div>
				<div className="border border-border p-4">
					<IconChartBar className="mb-3 size-5 text-primary" stroke={1.8} />
					<div className="text-sm font-bold">Add Drishti</div>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						Market intelligence and metadata.
					</p>
				</div>
				<div className="border border-border p-4">
					<IconBrain className="mb-3 size-5 text-primary" stroke={1.8} />
					<div className="text-sm font-bold">Configure LLM</div>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						Chat and alert analysis.
					</p>
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
	const supportedBrokers = data.supportedBrokers.length
		? data.supportedBrokers
		: fallbackBrokers;
	const [broker, setBroker] = useState<BrokerCode>(
		supportedBrokers[0] ?? "zerodha",
	);
	const [growwMode, setGrowwMode] = useState<GrowwMode>("approval");
	const [defaultRedirectUri, setDefaultRedirectUri] = useState(
		"http://localhost:3000/broker-connections",
	);
	const { fieldErrors, formError, isPending, run } = useOnboardingMutation();
	const guide = brokerGuides[broker];

	useEffect(() => {
		setDefaultRedirectUri(`${window.location.origin}/broker-connections`);
	}, []);

	function submitBroker(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const payload = makeBrokerPayload(
			broker,
			growwMode,
			formData,
			defaultRedirectUri,
		);
		run(() => createBrokerAccount(payload), onboardingStepPath("drishti"));
	}

	return (
		<Card className={stepCardClassName}>
			<StepIntro {...stepCopy.broker} />
			<form className={stepFormClassName} onSubmit={submitBroker}>
				<Field className="gap-2" data-onboarding-motion-item>
					<div className="grid w-full grid-cols-2 gap-2 min-[760px]:grid-cols-4">
						{supportedBrokers.map((code) => {
							const selected = code === broker;

							return (
								<button
									aria-pressed={selected}
									className={cn(
										"flex min-h-11 w-full items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background min-[760px]:min-h-12",
										selected
											? "border-primary bg-primary/10 text-foreground"
											: "border-border text-muted-foreground",
									)}
									key={code}
									onClick={() => setBroker(code)}
									type="button"
								>
									<BrokerLogo
										broker={code}
										className="size-7"
										imageClassName="size-6 rounded-md"
									/>
									<span className="min-w-0 truncate font-medium">
										{brokerNames[code]}
									</span>
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
				<SetupSectionIntro
					description={stepCopy.broker.sectionDescription}
					title={stepCopy.broker.sectionTitle}
				/>
				{broker !== "groww" ? (
					<SetupField
						defaultValue={defaultBrokerLabel(broker)}
						description={brokerFieldDescription(broker, "label")}
						error={fieldErrors.label}
						label="Account label"
						name="label"
						placeholder={brokerFieldPlaceholder(
							broker,
							"label",
							defaultRedirectUri,
						)}
						resetKey={broker}
					/>
				) : null}
				{broker === "zerodha" ? (
					<div className={twoColumnFieldClassName}>
						<SetupField
							description={brokerFieldDescription(broker, "api_key")}
							error={fieldErrors.api_key}
							label="API key"
							name="api_key"
							placeholder={brokerFieldPlaceholder(
								broker,
								"api_key",
								defaultRedirectUri,
							)}
							resetKey={broker}
						/>
						<SetupField
							description={brokerFieldDescription(broker, "api_secret")}
							error={fieldErrors.api_secret}
							label="API secret"
							name="api_secret"
							placeholder={brokerFieldPlaceholder(
								broker,
								"api_secret",
								defaultRedirectUri,
							)}
							resetKey={broker}
							type="password"
						/>
					</div>
				) : null}
				{broker === "upstox" ? (
					<>
						<div className={twoColumnFieldClassName}>
							<SetupField
								description={brokerFieldDescription(broker, "api_key")}
								error={fieldErrors.api_key}
								label="API key"
								name="api_key"
								placeholder={brokerFieldPlaceholder(
									broker,
									"api_key",
									defaultRedirectUri,
								)}
								resetKey={broker}
							/>
							<SetupField
								description={brokerFieldDescription(broker, "api_secret")}
								error={fieldErrors.api_secret}
								label="API secret"
								name="api_secret"
								placeholder={brokerFieldPlaceholder(
									broker,
									"api_secret",
									defaultRedirectUri,
								)}
								resetKey={broker}
								type="password"
							/>
						</div>
						<SetupField
							defaultValue={defaultRedirectUri}
							description={brokerFieldDescription(broker, "redirect_uri")}
							error={fieldErrors.redirect_uri}
							label="Redirect URI"
							name="redirect_uri"
							placeholder={brokerFieldPlaceholder(
								broker,
								"redirect_uri",
								defaultRedirectUri,
							)}
							readOnly
							resetKey={`${broker}:${defaultRedirectUri}`}
						/>
					</>
				) : null}
				{broker === "angel" ? (
					<div className={twoColumnFieldClassName}>
						<SetupField
							description={brokerFieldDescription(broker, "api_key")}
							error={fieldErrors.api_key}
							label="API key"
							name="api_key"
							placeholder={brokerFieldPlaceholder(
								broker,
								"api_key",
								defaultRedirectUri,
							)}
							resetKey={broker}
						/>
						<SetupField
							description={brokerFieldDescription(broker, "client_code")}
							error={fieldErrors.client_code}
							label="Client code"
							name="client_code"
							placeholder={brokerFieldPlaceholder(
								broker,
								"client_code",
								defaultRedirectUri,
							)}
							resetKey={broker}
						/>
					</div>
				) : null}
				{broker === "dhan" ? (
					<>
						<div className={twoColumnFieldClassName}>
							<SetupField
								description={brokerFieldDescription(broker, "app_id")}
								error={fieldErrors.app_id}
								label="App ID"
								name="app_id"
								placeholder={brokerFieldPlaceholder(
									broker,
									"app_id",
									defaultRedirectUri,
								)}
								resetKey={broker}
							/>
							<SetupField
								description={brokerFieldDescription(broker, "app_secret")}
								error={fieldErrors.app_secret}
								label="App secret"
								name="app_secret"
								placeholder={brokerFieldPlaceholder(
									broker,
									"app_secret",
									defaultRedirectUri,
								)}
								resetKey={broker}
								type="password"
							/>
						</div>
						<SetupField
							description={brokerFieldDescription(broker, "client_id")}
							error={fieldErrors.client_id}
							label="Client ID"
							name="client_id"
							placeholder={brokerFieldPlaceholder(
								broker,
								"client_id",
								defaultRedirectUri,
							)}
							resetKey={broker}
						/>
					</>
				) : null}
				{broker === "groww" ? (
					<>
						<div className={twoColumnFieldClassName}>
							<SetupField
								defaultValue={defaultBrokerLabel(broker)}
								description={brokerFieldDescription(broker, "label")}
								error={fieldErrors.label}
								label="Account label"
								name="label"
								placeholder={brokerFieldPlaceholder(
									broker,
									"label",
									defaultRedirectUri,
								)}
								resetKey={broker}
							/>
							<Field data-onboarding-motion-item>
								<FieldLabel>Groww auth mode</FieldLabel>
								<SimpleSelect
									onValueChange={(value) => setGrowwMode(value as GrowwMode)}
									options={[
										{ value: "approval", label: "Approval API key" },
										{ value: "totp", label: "TOTP" },
										{ value: "token", label: "Access token" },
									]}
									value={growwMode}
								/>
							</Field>
						</div>
						{growwMode === "approval" ? (
							<div className={twoColumnFieldClassName}>
								<SetupField
									description={brokerFieldDescription(broker, "api_key")}
									error={fieldErrors.api_key}
									label="API key"
									name="api_key"
									placeholder={brokerFieldPlaceholder(
										broker,
										"api_key",
										defaultRedirectUri,
									)}
									resetKey={`${broker}:${growwMode}`}
								/>
								<SetupField
									description={brokerFieldDescription(broker, "api_secret")}
									error={fieldErrors.api_secret}
									label="API secret"
									name="api_secret"
									placeholder={brokerFieldPlaceholder(
										broker,
										"api_secret",
										defaultRedirectUri,
									)}
									resetKey={`${broker}:${growwMode}`}
									type="password"
								/>
							</div>
						) : null}
						{growwMode === "totp" ? (
							<div className={twoColumnFieldClassName}>
								<SetupField
									description={brokerFieldDescription(broker, "totp_token")}
									error={fieldErrors.totp_token}
									label="TOTP token"
									name="totp_token"
									placeholder={brokerFieldPlaceholder(
										broker,
										"totp_token",
										defaultRedirectUri,
									)}
									resetKey={`${broker}:${growwMode}`}
								/>
								<SetupField
									description={brokerFieldDescription(broker, "totp_secret")}
									error={fieldErrors.totp_secret}
									label="TOTP secret"
									name="totp_secret"
									placeholder={brokerFieldPlaceholder(
										broker,
										"totp_secret",
										defaultRedirectUri,
									)}
									resetKey={`${broker}:${growwMode}`}
									type="password"
								/>
							</div>
						) : null}
						{growwMode === "token" ? (
							<SetupField
								description={brokerFieldDescription(broker, "access_token")}
								error={fieldErrors.access_token}
								label="Access token"
								name="access_token"
								placeholder={brokerFieldPlaceholder(
									broker,
									"access_token",
									defaultRedirectUri,
								)}
								resetKey={`${broker}:${growwMode}`}
								type="password"
							/>
						) : null}
					</>
				) : null}
				{broker === "indmoney" ? (
					<SetupField
						description={brokerFieldDescription(broker, "access_token")}
						error={fieldErrors.access_token}
						label="Access token"
						name="access_token"
						placeholder={brokerFieldPlaceholder(
							broker,
							"access_token",
							defaultRedirectUri,
						)}
						resetKey={broker}
						type="password"
					/>
				) : null}
				{broker === "kotak" ? (
					<div className={twoColumnFieldClassName}>
						<SetupField
							description={brokerFieldDescription(broker, "ucc")}
							error={fieldErrors.ucc}
							label="UCC"
							name="ucc"
							placeholder={brokerFieldPlaceholder(
								broker,
								"ucc",
								defaultRedirectUri,
							)}
							resetKey={broker}
						/>
						<SetupField
							description={brokerFieldDescription(
								broker,
								"portal_access_token",
							)}
							error={fieldErrors.portal_access_token}
							label="Portal access token"
							name="portal_access_token"
							placeholder={brokerFieldPlaceholder(
								broker,
								"portal_access_token",
								defaultRedirectUri,
							)}
							resetKey={broker}
							type="password"
						/>
					</div>
				) : null}
				{formError ? <OnboardingFormError message={formError} /> : null}
				<StepActions>
					<Button
						className="onboarding-cta h-11 min-w-40"
						disabled={isPending}
						type="submit"
					>
						{isPending ? "Saving..." : "Connect broker"}
					</Button>
				</StepActions>
			</form>
		</Card>
	);
}

export function DrishtiStep({ config }: { config: SystemConfig }) {
	const { fieldErrors, formError, isPending, run } = useOnboardingMutation();

	function submitAlpha(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		run(
			() =>
				upsertAlphaApiCredential({
					api_key: fieldValue(formData, "alpha_api_key"),
					is_enabled: true,
				}),
			onboardingStepPath("llm-provider"),
		);
	}

	return (
		<Card className={stepCardClassName}>
			<StepIntro {...stepCopy.drishti} />
			<form className={stepFormClassName} onSubmit={submitAlpha}>
				<SetupSectionIntro
					description={stepCopy.drishti.sectionDescription}
					title={stepCopy.drishti.sectionTitle}
				/>
				<SetupField
					error={fieldErrors.api_key || fieldErrors.alpha_api_key}
					label="Drishti API key"
					name="alpha_api_key"
					placeholder={
						config.alpha_api.has_api_key
							? "Replace saved Drishti key"
							: "Paste Drishti API key"
					}
					type="password"
				/>
				<p
					className="text-xs text-muted-foreground"
					data-onboarding-motion-item
				>
					Need a Drishti API key?{" "}
					<a
						className="font-medium text-primary underline-offset-4 hover:underline"
						href={drishtiDeveloperPortalUrl}
						rel="noreferrer"
						target="_blank"
					>
						Open the developer portal
					</a>
					.
				</p>
				{formError ? <OnboardingFormError message={formError} /> : null}
				<StepActions>
					<Button
						className="onboarding-cta h-11 min-w-40"
						disabled={isPending}
						type="submit"
					>
						{isPending ? "Saving..." : "Save Drishti key"}
					</Button>
				</StepActions>
			</form>
		</Card>
	);
}

export function LlmProviderStep({ config }: { config: SystemConfig }) {
	const [llmProvider, setLlmProvider] = useState<LlmProvider>(
		config.llm_providers[0]?.provider ?? "openai",
	);
	const { fieldErrors, formError, isPending, run } = useOnboardingMutation();
	const selectedProvider = config.llm_providers.find(
		(provider) => provider.provider === llmProvider,
	);

	function submitLlm(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		run(
			() =>
				upsertLlmProviderCredential(llmProvider, {
					api_key: fieldValue(formData, "llm_api_key"),
					is_enabled: true,
				}),
			onboardingStepPath("mcp"),
		);
	}

	return (
		<Card className={stepCardClassName}>
			<StepIntro {...stepCopy.llm} />
			<form className={stepFormClassName} onSubmit={submitLlm}>
				<Field className="gap-2" data-onboarding-motion-item>
					<FieldLabel>Provider</FieldLabel>
					<div
						aria-label="LLM provider"
						className="grid w-full grid-cols-2 gap-2 min-[760px]:grid-cols-4"
						role="group"
					>
						{config.llm_providers.map((provider) => {
							const selected = provider.provider === llmProvider;
							const logo = providerLogos[provider.provider];

							return (
								<button
									aria-pressed={selected}
									className={cn(
										"flex min-h-11 w-full items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background min-[760px]:min-h-12",
										selected
											? "border-primary bg-primary/10 text-foreground"
											: "border-border text-muted-foreground",
									)}
									key={provider.provider}
									onClick={() => setLlmProvider(provider.provider)}
									type="button"
								>
									<span
										aria-hidden="true"
										className="flex size-7 shrink-0 items-center justify-center"
									>
										<img
											alt={logo.alt}
											className="block size-6 object-contain"
											draggable={false}
											src={logo.src}
										/>
									</span>
									<span className="min-w-0 truncate font-medium">
										{provider.label || providerLabels[provider.provider]}
									</span>
								</button>
							);
						})}
					</div>
					<LlmProviderSetupGuideDialog
						label={selectedProvider?.label || providerLabels[llmProvider]}
						provider={llmProvider}
						triggerClassName="text-xs text-primary"
						triggerLabel={`View ${selectedProvider?.label || providerLabels[llmProvider]} setup guide`}
						triggerVariant="link"
					/>
				</Field>
				<SetupSectionIntro
					description={stepCopy.llm.sectionDescription}
					title={stepCopy.llm.sectionTitle}
				/>
				<Field
					className="gap-1.5"
					data-onboarding-motion-item
					invalid={Boolean(fieldErrors.api_key || fieldErrors.llm_api_key)}
				>
					<FieldLabel htmlFor="onboarding-llm_api_key">
						{providerLabels[llmProvider]} API key
					</FieldLabel>
					<Input
						autoComplete="off"
						className="h-9"
						data-1p-ignore="true"
						data-form-type="other"
						data-lpignore="true"
						id="onboarding-llm_api_key"
						inputClassName="onboarding-input"
						key={llmProvider}
						name="llm_api_key"
						placeholder={providerKeyPlaceholders[llmProvider]}
						type="password"
						aria-invalid={
							fieldErrors.api_key || fieldErrors.llm_api_key ? true : undefined
						}
					/>
					{fieldErrors.api_key || fieldErrors.llm_api_key ? (
						<FieldError>
							{fieldErrors.api_key || fieldErrors.llm_api_key}
						</FieldError>
					) : null}
				</Field>
				{formError ? <OnboardingFormError message={formError} /> : null}
				<StepActions>
					<Button
						className="onboarding-cta h-11 min-w-40"
						disabled={isPending}
						type="submit"
					>
						{isPending ? "Saving..." : "Save LLM provider"}
					</Button>
				</StepActions>
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
					timeout_seconds: 15,
				}),
			"/broker-connections",
		);
	}

	return (
		<Card className={stepCardClassName}>
			<StepIntro
				{...stepCopy.mcp}
				badge={<Badge variant="secondary">Optional</Badge>}
				icon={<IconPlugConnected className="size-5 text-primary" stroke={1.8} />}
			/>
			<form className={stepFormClassName} onSubmit={submitMcp}>
				<SetupSectionIntro
					description={stepCopy.mcp.sectionDescription}
					title={stepCopy.mcp.sectionTitle}
				/>
				<div className={twoColumnFieldClassName}>
					<SetupField
						error={fieldErrors.name}
						label="Server name"
						name="mcp_name"
						placeholder="Research tools"
					/>
					<SetupField
						error={fieldErrors.url}
						label="Server URL"
						name="mcp_url"
						placeholder="https://example.com/mcp"
					/>
				</div>
				<div className={twoColumnFieldClassName}>
					<SetupField
						description="Saved as an Authorization Bearer token."
						error={fieldErrors.api_key}
						label="API key"
						name="mcp_api_key"
						placeholder="Paste MCP server API key"
						type="password"
					/>
				</div>
				{formError ? <OnboardingFormError message={formError} /> : null}
				<StepActions>
					<Button
						className="onboarding-cta h-11 min-w-40"
						disabled={isPending}
						type="submit"
					>
						{isPending ? "Saving..." : "Connect MCP"}
					</Button>
					<Button
						className="onboarding-cta h-11 min-w-40"
						disabled={isPending}
						onClick={() => navigateTo("/broker-connections")}
						type="button"
						variant="outline"
					>
						Skip to Broker Connections
					</Button>
				</StepActions>
			</form>
		</Card>
	);
}
