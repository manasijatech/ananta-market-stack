"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { createBrokerAccount } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { BrokerLogo, brokerNames } from "@/components/brokers/ui";
import { brokerGuides } from "@/service/broker-guides";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BrokerCode, CreateBrokerAccountPayload, FieldErrors } from "@/service/types/broker";

type GrowwMode = "approval" | "totp" | "token";

const fallbackBrokerRedirectUrl = "http://localhost:3000/broker-connections";

function brokerCredentialInputName(key: string): string {
    return `market_stack_broker_credential_${key}`;
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
    growwMode: GrowwMode,
    defaultBrokerRedirectUrl: string
): CreateBrokerAccountPayload {
    const label = stringField(formData, "label");
    switch (broker) {
        case "zerodha":
            return {
                broker,
                label,
                api_key: stringField(formData, "api_key"),
                api_secret: stringField(formData, "api_secret")
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
                pin: stringField(formData, "pin"),
                totp_secret: nullableField(formData, "totp_secret")
            };
        case "dhan":
            return {
                broker,
                label,
                app_id: stringField(formData, "app_id"),
                app_secret: stringField(formData, "app_secret"),
                client_id: stringField(formData, "client_id"),
                pin: nullableField(formData, "pin"),
                totp_secret: nullableField(formData, "totp_secret")
            };
        case "kotak":
            return {
                broker,
                label,
                ucc: stringField(formData, "ucc"),
                portal_access_token: stringField(formData, "portal_access_token"),
                mobile_number: nullableField(formData, "mobile_number"),
                mpin: nullableField(formData, "mpin"),
                totp_secret: nullableField(formData, "totp_secret")
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

function Field({
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
        <div className="grid gap-2">
            <Label htmlFor={inputName}>
                {label}
                {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
            </Label>
            <Input
                autoComplete={autocomplete}
                aria-invalid={Boolean(error)}
                data-1p-ignore="true"
                data-form-type="other"
                data-lpignore="true"
                defaultValue={defaultValue}
                id={inputName}
                name={inputName}
                required={!optional}
                type={type}
            />
            {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
            {error ? <span className="text-xs font-semibold text-destructive">{error}</span> : null}
        </div>
    );
}

function BrokerGuidePanel({ broker }: { broker: BrokerCode }) {
    const guide = brokerGuides[broker];

    return (
        <div className=" border bg-muted/40 p-4">
            <div className="flex flex-col gap-3 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between">
                <div>
                    <p className="text-sm font-medium text-muted-foreground">{guide.summary}</p>
                    <div className="mt-4 grid gap-3 min-[720px]:grid-cols-2">
                        <div>
                            <h3 className="text-xs font-extrabold uppercase text-muted-foreground">Required here</h3>
                            <ul className="mt-2 grid gap-1.5 text-sm">
                                {guide.required.map((item) => (
                                    <li className="flex gap-2" key={item}>
                                        <span className="mt-2 size-1.5 shrink-0 bg-primary" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h3 className="text-xs font-extrabold uppercase text-muted-foreground">Setup notes</h3>
                            <ul className="mt-2 grid gap-1.5 text-sm">
                                {guide.notes.map((item) => (
                                    <li className="flex gap-2" key={item}>
                                        <span className="mt-2 size-1.5 shrink-0 bg-primary" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
                <Button asChild size="sm" variant="outline">
                    <Link href={`/docs/${broker}`} target="_blank" rel="noreferrer">
                        Docs
                        <BookOpen className="size-3.5" />
                    </Link>
                </Button>
            </div>
        </div>
    );
}

export function AddBrokerForm({ supportedBrokers }: { supportedBrokers: BrokerCode[] }) {
    const router = useRouter();
    const [broker, setBroker] = useState<BrokerCode>(supportedBrokers[0] ?? "zerodha");
    const [growwMode, setGrowwMode] = useState<GrowwMode>("approval");
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
        const payload = makePayload(broker, formData, growwMode, defaultBrokerRedirectUrl);
        setFieldErrors({});
        setMessage("");

        startTransition(async () => {
            try {
                const created = await createBrokerAccount(payload);
                router.push(`/broker-connections/${created.id}`);
            } catch (error) {
                const parsed = parseActionError(error);
                setMessage(parsed.message);
                setFieldErrors(parsed.fieldErrors);
            }
        });
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <aside className="grid gap-3 self-start">
                {supportedBrokers.map((code) => (
                    <Button
                        className={cn(
                            "h-auto justify-start border bg-card p-4 text-left transition hover:border-primary/40",
                            broker === code && "border-primary bg-[var(--accent-glow)] text-primary"
                        )}
                        key={code}
                        onClick={() => setBroker(code)}
                        variant="ghost"
                        type="button"
                    >
                        <div className="flex items-center gap-3">
                            <BrokerLogo broker={code} className="h-12 w-16" />
                            <div>
                                <span className="block text-lg font-bold">{brokerNames[code]}</span>
                            </div>
                        </div>
                    </Button>
                ))}
            </aside>

            <Card>
                <CardHeader>
                    <p className="text-sm font-bold uppercase text-primary">Add {selectedName}</p>
                    <CardTitle className="text-2xl">Broker credentials</CardTitle>
                    <CardDescription>
                        Secrets are encrypted by the FastAPI backend before storage. Use the built-in docs for broker
                        setup.
                    </CardDescription>
                </CardHeader>

                <CardContent>
                    <form autoComplete="off" className="grid gap-4" data-form-type="other" onSubmit={onSubmit}>
                        <BrokerGuidePanel broker={broker} />
                        <Field error={fieldErrors.label} label="Account label" name="label" />

                        {broker === "zerodha" ? (
                            <>
                                <Field error={fieldErrors.api_key} label="API key" name="api_key" />
                                <Field
                                    error={fieldErrors.api_secret}
                                    label="API secret"
                                    name="api_secret"
                                    type="password"
                                />
                            </>
                        ) : null}

                        {broker === "upstox" ? (
                            <>
                                <Field error={fieldErrors.api_key} label="API key" name="api_key" />
                                <Field
                                    error={fieldErrors.api_secret}
                                    label="API secret"
                                    name="api_secret"
                                    type="password"
                                />
                                <Field
                                    key={defaultBrokerRedirectUrl}
                                    error={fieldErrors.redirect_uri}
                                    label="Redirect URI"
                                    name="redirect_uri"
                                    defaultValue={defaultBrokerRedirectUrl}
                                    description="Use the same URL in the Upstox developer app. The backend must exchange the code with this exact value."
                                />
                            </>
                        ) : null}

                        {broker === "angel" ? (
                            <>
                                <Field error={fieldErrors.api_key} label="API key" name="api_key" />
                                <Field error={fieldErrors.client_code} label="Client code" name="client_code" />
                                <Field error={fieldErrors.pin} label="PIN" name="pin" type="password" />
                                <Field
                                    error={fieldErrors.totp_secret}
                                    label="TOTP secret"
                                    name="totp_secret"
                                    optional
                                />
                            </>
                        ) : null}

                        {broker === "dhan" ? (
                            <>
                                <Field error={fieldErrors.app_id} label="API key" name="app_id" />
                                <Field
                                    error={fieldErrors.app_secret}
                                    label="API secret"
                                    name="app_secret"
                                    type="password"
                                />
                                <Field error={fieldErrors.client_id} label="Client ID" name="client_id" />
                                <Field error={fieldErrors.pin} label="PIN" name="pin" optional type="password" />
                                <Field
                                    error={fieldErrors.totp_secret}
                                    label="TOTP secret"
                                    name="totp_secret"
                                    optional
                                />
                            </>
                        ) : null}

                        {broker === "kotak" ? (
                            <>
                                <Field error={fieldErrors.ucc} label="UCC" name="ucc" />
                                <Field
                                    error={fieldErrors.portal_access_token}
                                    label="Portal access token"
                                    name="portal_access_token"
                                    type="password"
                                />
                                <Field
                                    error={fieldErrors.mobile_number}
                                    label="Mobile number"
                                    name="mobile_number"
                                    optional
                                />
                                <Field error={fieldErrors.mpin} label="MPIN" name="mpin" optional type="password" />
                                <Field
                                    error={fieldErrors.totp_secret}
                                    label="TOTP secret"
                                    name="totp_secret"
                                    optional
                                />
                            </>
                        ) : null}

                        {broker === "groww" ? (
                            <>
                                <div className="flex flex-wrap gap-2">
                                    {(["approval", "totp", "token"] as GrowwMode[]).map((mode) => (
                                        <Button
                                            size="sm"
                                            variant={growwMode === mode ? "default" : "outline"}
                                            key={mode}
                                            onClick={() => setGrowwMode(mode)}
                                            type="button"
                                        >
                                            {mode === "approval"
                                                ? "API approval"
                                                : mode === "totp"
                                                  ? "TOTP"
                                                  : "Access token"}
                                        </Button>
                                    ))}
                                </div>
                                {growwMode === "approval" ? (
                                    <>
                                        <Field error={fieldErrors.api_key} label="API key" name="api_key" />
                                        <Field
                                            error={fieldErrors.api_secret}
                                            label="API secret"
                                            name="api_secret"
                                            type="password"
                                        />
                                    </>
                                ) : null}
                                {growwMode === "totp" ? (
                                    <>
                                        <Field
                                            error={fieldErrors.totp_token}
                                            label="TOTP API key"
                                            name="totp_token"
                                            type="password"
                                        />
                                        <Field
                                            error={fieldErrors.totp_secret}
                                            label="TOTP secret"
                                            name="totp_secret"
                                            type="password"
                                        />
                                    </>
                                ) : null}
                                {growwMode === "token" ? (
                                    <Field
                                        error={fieldErrors.access_token}
                                        label="Access token"
                                        name="access_token"
                                        type="password"
                                    />
                                ) : null}
                            </>
                        ) : null}

                        {broker === "indmoney" ? (
                            <Field
                                error={fieldErrors.access_token}
                                label="Access token"
                                name="access_token"
                                type="password"
                            />
                        ) : null}

                        {message ? (
                            <Alert variant="destructive">
                                <AlertDescription>{message}</AlertDescription>
                            </Alert>
                        ) : null}

                        <Button className="mt-2 min-h-11 w-full font-extrabold" disabled={isPending} type="submit">
                            {isPending ? "Saving..." : `Add ${selectedName}`}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
