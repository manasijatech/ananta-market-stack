"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createBrokerAccount } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { BrokerLogo, brokerNames } from "@/components/brokers/ui";
import { brokerGuides } from "@/service/broker-guides";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardPanel
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { BrokerCode, CreateBrokerAccountPayload, FieldErrors } from "@/service/types/broker";

type ZerodhaMode = "official" | "automation";
type AngelMode = "manual" | "automation";
type DhanMode = "consent" | "automation";
type GrowwMode = "approval" | "totp" | "token";
type KotakMode = "manual" | "automation";

const fallbackBrokerRedirectUrl = "http://localhost:3000/broker-connections";

function brokerCredentialInputName(key: string): string {
    return `ananta_market_stack_broker_credential_${key}`;
}

function stringField(formData: FormData, key: string): string {
    return String(formData.get(brokerCredentialInputName(key)) ?? formData.get(key) ?? "").trim();
}

function nullableField(formData: FormData, key: string): string | null {
    const value = stringField(formData, key);
    return value || null;
}

function makePayload(
    broker: BrokerCode,
    formData: FormData,
    zerodhaMode: ZerodhaMode,
    angelMode: AngelMode,
    dhanMode: DhanMode,
    growwMode: GrowwMode,
    kotakMode: KotakMode,
    defaultBrokerRedirectUrl: string
): CreateBrokerAccountPayload {
    const label = stringField(formData, "label");
    switch (broker) {
        case "zerodha":
            return {
                broker,
                label,
                api_key: stringField(formData, "api_key"),
                api_secret: stringField(formData, "api_secret"),
                login_user_id: zerodhaMode === "automation" ? nullableField(formData, "login_user_id") : null,
                login_password: zerodhaMode === "automation" ? nullableField(formData, "login_password") : null,
                totp_secret: zerodhaMode === "automation" ? nullableField(formData, "totp_secret") : null
            };
        case "upstox":
            return {
                broker,
                label,
                api_key: stringField(formData, "api_key"),
                api_secret: stringField(formData, "api_secret"),
                redirect_uri: stringField(formData, "redirect_uri") || defaultBrokerRedirectUrl
            };
        case "angel":
            return {
                broker,
                label,
                api_key: stringField(formData, "api_key"),
                client_code: stringField(formData, "client_code"),
                pin: angelMode === "automation" ? stringField(formData, "pin") : "",
                totp_secret: angelMode === "automation" ? nullableField(formData, "totp_secret") : null
            };
        case "dhan":
            return {
                broker,
                label,
                app_id: stringField(formData, "app_id"),
                app_secret: stringField(formData, "app_secret"),
                client_id: stringField(formData, "client_id"),
                pin: dhanMode === "automation" ? nullableField(formData, "pin") : null,
                totp_secret: dhanMode === "automation" ? nullableField(formData, "totp_secret") : null
            };
        case "kotak":
            return {
                broker,
                label,
                ucc: stringField(formData, "ucc"),
                portal_access_token: stringField(formData, "portal_access_token"),
                mobile_number: kotakMode === "automation" ? nullableField(formData, "mobile_number") : null,
                mpin: kotakMode === "automation" ? nullableField(formData, "mpin") : null,
                totp_secret: kotakMode === "automation" ? nullableField(formData, "totp_secret") : null
            };
        case "groww":
            return {
                broker,
                label,
                api_key: growwMode === "approval" ? nullableField(formData, "api_key") : null,
                api_secret: growwMode === "approval" ? nullableField(formData, "api_secret") : null,
                totp_token: growwMode === "totp" ? nullableField(formData, "totp_token") : null,
                totp_secret: growwMode === "totp" ? nullableField(formData, "totp_secret") : null,
                access_token: growwMode === "token" ? nullableField(formData, "access_token") : null
            };
        case "indmoney":
            return {
                broker,
                label,
                access_token: nullableField(formData, "access_token")
            };
    }
}

function BrokerModeSwitch<TMode extends string>({
    modes,
    value,
    onChange
}: {
    modes: readonly { value: TMode; label: string }[];
    value: TMode;
    onChange: (value: TMode) => void;
}) {
    return (
        <ToggleGroup
            onValueChange={(next) => {
                if (next.length === 1) {
                    onChange(next[0] as TMode);
                }
            }}
            size="sm"
            value={[value]}
            variant="outline"
        >
            {modes.map((mode) => (
                <ToggleGroupItem key={mode.value} value={mode.value}>
                    {mode.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

function brokerFieldPlaceholder(name: string, label: string): string {
    const placeholders: Record<string, string> = {
        access_token: "Paste access token",
        api_key: "Paste API key",
        api_secret: "Paste API secret",
        app_id: "Paste API key",
        app_secret: "Paste API secret",
        client_code: "Enter client code",
        client_id: "Enter client ID",
        label: "Enter account label",
        login_password: "Enter login password",
        login_user_id: "Enter login user ID",
        mobile_number: "Enter mobile number",
        mpin: "Enter MPIN",
        pin: "Enter PIN",
        portal_access_token: "Paste portal access token",
        redirect_uri: "Enter redirect URI",
        totp_secret: "Paste TOTP secret",
        totp_token: "Paste TOTP API key",
        ucc: "Enter UCC"
    };

    return placeholders[name] ?? `Enter ${label.toLowerCase()}`;
}

function BrokerField({
    name,
    label,
    error,
    optional = false,
    defaultValue = "",
    description,
    type = "text"
}: {
    name: string;
    label: string;
    error?: string;
    optional?: boolean;
    defaultValue?: string;
    description?: string;
    type?: string;
}) {
    const inputName = brokerCredentialInputName(name);
    const autocomplete = name.includes("totp") ? "one-time-code" : type === "password" ? "new-password" : "off";

    return (
        <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={inputName}>
                {label}
                {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
            </FieldLabel>
            <Input
                aria-invalid={Boolean(error)}
                autoComplete={autocomplete}
                data-1p-ignore="true"
                data-form-type="other"
                data-lpignore="true"
                defaultValue={defaultValue}
                id={inputName}
                name={inputName}
                placeholder={brokerFieldPlaceholder(name, label)}
                required={!optional}
                type={type}
            />
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            {error ? <FieldError>{error}</FieldError> : null}
        </Field>
    );
}

function BrokerGuidePanel({ broker }: { broker: BrokerCode }) {
    const guide = brokerGuides[broker];

    return (
        <Card className="bg-muted/30 shadow-none">
            <CardPanel className="flex flex-col gap-4 p-4">
                <p className="text-sm text-muted-foreground">{guide.summary}</p>
                <div className="grid gap-4 min-[720px]:grid-cols-2">
                    <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Required here
                        </h3>
                        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                            {guide.required.map((item) => (
                                <li className="flex gap-2" key={item}>
                                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Setup notes
                        </h3>
                        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                            {guide.notes.map((item) => (
                                <li className="flex gap-2" key={item}>
                                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </CardPanel>
        </Card>
    );
}

function BrokerSelector({
    broker,
    onSelect,
    supportedBrokers
}: {
    broker: BrokerCode;
    onSelect: (code: BrokerCode) => void;
    supportedBrokers: BrokerCode[];
}) {
    return (
        <nav aria-label="Choose broker" className="flex flex-col gap-2">
            {supportedBrokers.map((code) => {
                const isSelected = broker === code;

                return (
                    <Card
                        className={cn(
                            "w-full shadow-none transition-colors",
                            isSelected && "border-primary ring-1 ring-primary/25"
                        )}
                        key={code}
                        render={<button aria-pressed={isSelected} onClick={() => onSelect(code)} type="button" />}
                    >
                        <CardPanel className="flex items-center gap-3 p-3">
                            <BrokerLogo broker={code} className="size-10" imageClassName="size-8" />
                            <span className="font-semibold">{brokerNames[code]}</span>
                        </CardPanel>
                    </Card>
                );
            })}
        </nav>
    );
}

export function AddBrokerForm({
    compact = false,
    initialBroker,
    showBrokerSelector = true,
    supportedBrokers
}: {
    compact?: boolean;
    initialBroker?: BrokerCode;
    showBrokerSelector?: boolean;
    supportedBrokers: BrokerCode[];
}) {
    const router = useRouter();
    const [broker, setBroker] = useState<BrokerCode>(initialBroker ?? supportedBrokers[0] ?? "zerodha");
    const [zerodhaMode, setZerodhaMode] = useState<ZerodhaMode>("official");
    const [angelMode, setAngelMode] = useState<AngelMode>("manual");
    const [dhanMode, setDhanMode] = useState<DhanMode>("consent");
    const [growwMode, setGrowwMode] = useState<GrowwMode>("approval");
    const [kotakMode, setKotakMode] = useState<KotakMode>("manual");
    const [isPending, startTransition] = useTransition();
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [message, setMessage] = useState("");
    const [defaultBrokerRedirectUrl, setDefaultBrokerRedirectUrl] = useState(fallbackBrokerRedirectUrl);

    const selectedName = useMemo(() => brokerNames[broker], [broker]);

    useEffect(() => {
        setDefaultBrokerRedirectUrl(`${window.location.origin}/broker-connections`);
    }, []);

    function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const payload = makePayload(
            broker,
            formData,
            zerodhaMode,
            angelMode,
            dhanMode,
            growwMode,
            kotakMode,
            defaultBrokerRedirectUrl
        );
        setFieldErrors({});
        setMessage("");

        startTransition(async () => {
            try {
                const created = await createBrokerAccount(payload);
                toast.success(`${selectedName} account added.`, {
                    description: "Next, finish the broker login to start receiving data."
                });
                router.push(`/broker-connections/${created.id}`);
            } catch (error) {
                const parsed = parseActionError(error);
                setMessage(parsed.message);
                setFieldErrors(parsed.fieldErrors);
                toast.error(parsed.message || `Could not add ${selectedName}.`);
            }
        });
    }

    return (
        <div
            className={cn(
                "grid gap-6 lg:items-start",
                showBrokerSelector ? "lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]" : "lg:grid-cols-1"
            )}
        >
            {showBrokerSelector ? (
                <BrokerSelector broker={broker} onSelect={setBroker} supportedBrokers={supportedBrokers} />
            ) : null}

            <CardFrame
                className={cn(
                    "min-w-0",
                    compact &&
                        "overflow-visible border-0 bg-transparent before:hidden *:data-[slot=card]:!m-0 *:data-[slot=card]:!overflow-visible *:data-[slot=card]:![clip-path:none]"
                )}
            >
                {compact ? null : (
                    <CardFrameHeader>
                        <CardFrameTitle className="text-lg font-semibold">Broker credentials</CardFrameTitle>
                        <CardFrameDescription className="leading-6">
                            Add {selectedName}. Secrets are encrypted by the FastAPI backend before storage.
                        </CardFrameDescription>
                        <CardFrameAction>
                            <Badge
                                render={<Link href={`/docs/${broker}`} rel="noreferrer" target="_blank" />}
                                variant="outline"
                            >
                                <BookOpen data-icon="inline-start" />
                                Docs
                            </Badge>
                        </CardFrameAction>
                    </CardFrameHeader>
                )}
                <Card className={cn(compact && "!m-0 !overflow-visible border-0 bg-transparent ![clip-path:none] shadow-none")}>
                    <CardPanel className={cn(compact && "p-0")}>
                        <Form
                            autoComplete="off"
                            className="flex flex-col gap-4"
                            data-form-type="other"
                            onSubmit={onSubmit}
                        >
                            {compact ? null : <BrokerGuidePanel broker={broker} />}

                            <FieldGroup>
                                <BrokerField error={fieldErrors.label} label="Account label" name="label" />

                                {broker === "zerodha" ? (
                                    <>
                                        <BrokerModeSwitch
                                            modes={[
                                                { value: "official", label: "API only" },
                                                { value: "automation", label: "Web login automation" }
                                            ]}
                                            onChange={setZerodhaMode}
                                            value={zerodhaMode}
                                        />
                                        <BrokerField error={fieldErrors.api_key} label="API key" name="api_key" />
                                        <BrokerField
                                            error={fieldErrors.api_secret}
                                            label="API secret"
                                            name="api_secret"
                                            type="password"
                                        />
                                        {zerodhaMode === "automation" ? (
                                            <>
                                                <BrokerField
                                                    description="Zerodha user ID used for the optional automated web-login flow."
                                                    error={fieldErrors.login_user_id}
                                                    label="Login user ID"
                                                    name="login_user_id"
                                                />
                                                <BrokerField
                                                    description="Stored encrypted and used only for optional automated refresh."
                                                    error={fieldErrors.login_password}
                                                    label="Login password"
                                                    name="login_password"
                                                    type="password"
                                                />
                                                <BrokerField
                                                    description="Base32 authenticator secret, not the current 6-digit OTP."
                                                    error={fieldErrors.totp_secret}
                                                    label="TOTP secret"
                                                    name="totp_secret"
                                                    type="password"
                                                />
                                            </>
                                        ) : null}
                                    </>
                                ) : null}

                                {broker === "upstox" ? (
                                    <>
                                        <BrokerField error={fieldErrors.api_key} label="API key" name="api_key" />
                                        <BrokerField
                                            error={fieldErrors.api_secret}
                                            label="API secret"
                                            name="api_secret"
                                            type="password"
                                        />
                                        <BrokerField
                                            key={defaultBrokerRedirectUrl}
                                            defaultValue={defaultBrokerRedirectUrl}
                                            description="Use the same URL in the Upstox developer app. The backend must exchange the code with this exact value."
                                            error={fieldErrors.redirect_uri}
                                            label="Redirect URI"
                                            name="redirect_uri"
                                        />
                                    </>
                                ) : null}

                                {broker === "angel" ? (
                                    <>
                                        <BrokerModeSwitch
                                            modes={[
                                                { value: "manual", label: "Manual TOTP" },
                                                { value: "automation", label: "Stored TOTP automation" }
                                            ]}
                                            onChange={setAngelMode}
                                            value={angelMode}
                                        />
                                        <BrokerField error={fieldErrors.api_key} label="API key" name="api_key" />
                                        <BrokerField
                                            error={fieldErrors.client_code}
                                            label="Client code"
                                            name="client_code"
                                        />
                                        {angelMode === "automation" ? (
                                            <>
                                                <BrokerField
                                                    error={fieldErrors.pin}
                                                    label="PIN"
                                                    name="pin"
                                                    type="password"
                                                />
                                                <BrokerField
                                                    description="Base32 authenticator secret for SmartAPI automation."
                                                    error={fieldErrors.totp_secret}
                                                    label="TOTP secret"
                                                    name="totp_secret"
                                                    type="password"
                                                />
                                            </>
                                        ) : null}
                                    </>
                                ) : null}

                                {broker === "dhan" ? (
                                    <>
                                        <BrokerModeSwitch
                                            modes={[
                                                { value: "consent", label: "Manual consent" },
                                                { value: "automation", label: "TOTP automation" }
                                            ]}
                                            onChange={setDhanMode}
                                            value={dhanMode}
                                        />
                                        <BrokerField error={fieldErrors.app_id} label="API key" name="app_id" />
                                        <BrokerField
                                            error={fieldErrors.app_secret}
                                            label="API secret"
                                            name="app_secret"
                                            type="password"
                                        />
                                        <BrokerField error={fieldErrors.client_id} label="Client ID" name="client_id" />
                                        {dhanMode === "automation" ? (
                                            <>
                                                <BrokerField
                                                    error={fieldErrors.pin}
                                                    label="PIN"
                                                    name="pin"
                                                    type="password"
                                                />
                                                <BrokerField
                                                    description="QR/authenticator secret used for official Dhan TOTP automation."
                                                    error={fieldErrors.totp_secret}
                                                    label="TOTP secret"
                                                    name="totp_secret"
                                                    type="password"
                                                />
                                            </>
                                        ) : null}
                                    </>
                                ) : null}

                                {broker === "kotak" ? (
                                    <>
                                        <BrokerModeSwitch
                                            modes={[
                                                { value: "manual", label: "Manual session" },
                                                { value: "automation", label: "Stored TOTP + MPIN" }
                                            ]}
                                            onChange={setKotakMode}
                                            value={kotakMode}
                                        />
                                        <BrokerField error={fieldErrors.ucc} label="UCC" name="ucc" />
                                        <BrokerField
                                            error={fieldErrors.portal_access_token}
                                            label="Portal access token"
                                            name="portal_access_token"
                                            type="password"
                                        />
                                        {kotakMode === "automation" ? (
                                            <>
                                                <BrokerField
                                                    error={fieldErrors.mobile_number}
                                                    label="Mobile number"
                                                    name="mobile_number"
                                                />
                                                <BrokerField
                                                    error={fieldErrors.mpin}
                                                    label="MPIN"
                                                    name="mpin"
                                                    type="password"
                                                />
                                                <BrokerField
                                                    description="Base32 authenticator secret used for Kotak TOTP generation."
                                                    error={fieldErrors.totp_secret}
                                                    label="TOTP secret"
                                                    name="totp_secret"
                                                    type="password"
                                                />
                                            </>
                                        ) : null}
                                    </>
                                ) : null}

                                {broker === "groww" ? (
                                    <>
                                        <BrokerModeSwitch
                                            modes={[
                                                { value: "approval", label: "API approval" },
                                                { value: "totp", label: "TOTP" },
                                                { value: "token", label: "Access token" }
                                            ]}
                                            onChange={setGrowwMode}
                                            value={growwMode}
                                        />
                                        {growwMode === "approval" ? (
                                            <>
                                                <BrokerField
                                                    error={fieldErrors.api_key}
                                                    label="API key"
                                                    name="api_key"
                                                />
                                                <BrokerField
                                                    error={fieldErrors.api_secret}
                                                    label="API secret"
                                                    name="api_secret"
                                                    type="password"
                                                />
                                            </>
                                        ) : null}
                                        {growwMode === "totp" ? (
                                            <>
                                                <BrokerField
                                                    error={fieldErrors.totp_token}
                                                    label="TOTP API key"
                                                    name="totp_token"
                                                    type="password"
                                                />
                                                <BrokerField
                                                    error={fieldErrors.totp_secret}
                                                    label="TOTP secret"
                                                    name="totp_secret"
                                                    type="password"
                                                />
                                            </>
                                        ) : null}
                                        {growwMode === "token" ? (
                                            <BrokerField
                                                error={fieldErrors.access_token}
                                                label="Access token"
                                                name="access_token"
                                                type="password"
                                            />
                                        ) : null}
                                    </>
                                ) : null}

                                {broker === "indmoney" ? (
                                    <BrokerField
                                        error={fieldErrors.access_token}
                                        label="Access token"
                                        name="access_token"
                                        type="password"
                                    />
                                ) : null}
                            </FieldGroup>

                            {message ? (
                                <Alert variant="destructive">
                                    <AlertDescription>{message}</AlertDescription>
                                </Alert>
                            ) : null}

                            <Button className="min-h-11 w-full font-semibold" disabled={isPending} type="submit">
                                {isPending ? "Saving..." : `Add ${selectedName}`}
                            </Button>
                        </Form>
                    </CardPanel>
                </Card>
            </CardFrame>
        </div>
    );
}
