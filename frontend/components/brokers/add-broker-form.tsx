"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";
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

type GrowwMode = "approval" | "totp" | "token";

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
        <nav aria-label="Choose broker" className="flex flex-col gap-2" data-onboarding="broker-selector">
            {supportedBrokers.map((code) => {
                const isSelected = broker === code;

                return (
                    <Card
                        className={cn(
                            "w-full shadow-none transition-colors",
                            isSelected && "border-primary ring-1 ring-primary/25"
                        )}
                        key={code}
                        render={
                            <button
                                aria-pressed={isSelected}
                                onClick={() => onSelect(code)}
                                type="button"
                            />
                        }
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:items-start">
            <BrokerSelector broker={broker} onSelect={setBroker} supportedBrokers={supportedBrokers} />

            <CardFrame className="min-w-0">
                <CardFrameHeader>
                    <CardFrameTitle className="text-lg font-semibold">Broker credentials</CardFrameTitle>
                    <CardFrameDescription className="leading-6">
                        Add {selectedName}. Secrets are encrypted by the FastAPI backend before storage.
                    </CardFrameDescription>
                    <CardFrameAction>
                        <Badge
                            render={
                                <Link href={`/docs/${broker}`} rel="noreferrer" target="_blank" />
                            }
                            variant="outline"
                        >
                            <BookOpen data-icon="inline-start" />
                            Docs
                        </Badge>
                    </CardFrameAction>
                </CardFrameHeader>
                <Card>
                    <CardPanel>
                        <Form
                            autoComplete="off"
                            className="flex flex-col gap-4"
                            data-form-type="other"
                            onSubmit={onSubmit}
                        >
                            <BrokerGuidePanel broker={broker} />

                            <FieldGroup>
                                <BrokerField error={fieldErrors.label} label="Account label" name="label" />

                                {broker === "zerodha" ? (
                                    <>
                                        <BrokerField error={fieldErrors.api_key} label="API key" name="api_key" />
                                        <BrokerField
                                            error={fieldErrors.api_secret}
                                            label="API secret"
                                            name="api_secret"
                                            type="password"
                                        />
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
                                        <BrokerField error={fieldErrors.api_key} label="API key" name="api_key" />
                                        <BrokerField
                                            error={fieldErrors.client_code}
                                            label="Client code"
                                            name="client_code"
                                        />
                                        <BrokerField error={fieldErrors.pin} label="PIN" name="pin" type="password" />
                                        <BrokerField
                                            error={fieldErrors.totp_secret}
                                            label="TOTP secret"
                                            name="totp_secret"
                                            optional
                                        />
                                    </>
                                ) : null}

                                {broker === "dhan" ? (
                                    <>
                                        <BrokerField error={fieldErrors.app_id} label="API key" name="app_id" />
                                        <BrokerField
                                            error={fieldErrors.app_secret}
                                            label="API secret"
                                            name="app_secret"
                                            type="password"
                                        />
                                        <BrokerField
                                            error={fieldErrors.client_id}
                                            label="Client ID"
                                            name="client_id"
                                        />
                                        <BrokerField
                                            error={fieldErrors.pin}
                                            label="PIN"
                                            name="pin"
                                            optional
                                            type="password"
                                        />
                                        <BrokerField
                                            error={fieldErrors.totp_secret}
                                            label="TOTP secret"
                                            name="totp_secret"
                                            optional
                                        />
                                    </>
                                ) : null}

                                {broker === "kotak" ? (
                                    <>
                                        <BrokerField error={fieldErrors.ucc} label="UCC" name="ucc" />
                                        <BrokerField
                                            error={fieldErrors.portal_access_token}
                                            label="Portal access token"
                                            name="portal_access_token"
                                            type="password"
                                        />
                                        <BrokerField
                                            error={fieldErrors.mobile_number}
                                            label="Mobile number"
                                            name="mobile_number"
                                            optional
                                        />
                                        <BrokerField
                                            error={fieldErrors.mpin}
                                            label="MPIN"
                                            name="mpin"
                                            optional
                                            type="password"
                                        />
                                        <BrokerField
                                            error={fieldErrors.totp_secret}
                                            label="TOTP secret"
                                            name="totp_secret"
                                            optional
                                        />
                                    </>
                                ) : null}

                                {broker === "groww" ? (
                                    <>
                                        <ToggleGroup
                                            onValueChange={(value) => {
                                                if (value.length === 1) {
                                                    setGrowwMode(value[0] as GrowwMode);
                                                }
                                            }}
                                            size="sm"
                                            value={[growwMode]}
                                            variant="outline"
                                        >
                                            <ToggleGroupItem value="approval">API approval</ToggleGroupItem>
                                            <ToggleGroupItem value="totp">TOTP</ToggleGroupItem>
                                            <ToggleGroupItem value="token">Access token</ToggleGroupItem>
                                        </ToggleGroup>
                                        {growwMode === "approval" ? (
                                            <>
                                                <BrokerField error={fieldErrors.api_key} label="API key" name="api_key" />
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
