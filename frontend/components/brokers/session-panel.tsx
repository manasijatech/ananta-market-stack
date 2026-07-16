"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, ExternalLink, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { createSession, refreshSession, startDhanSession } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { brokerNames, formatDate } from "@/components/brokers/ui";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { brokerCallbackUrl, brokerSessionSetup } from "@/service/broker-setup";
import type {
    BrokerAccount,
    BrokerCode,
    SessionLoginPayload,
    SessionStartResponse,
    SessionStatus,
    ZerodhaSessionStatus
} from "@/service/types/broker";

function canRefresh(broker: BrokerCode): boolean {
    return broker === "zerodha" || broker === "angel" || broker === "dhan" || broker === "kotak";
}

function isZerodhaStatus(status: SessionStatus): status is ZerodhaSessionStatus {
    return status.broker === "zerodha" && "access_token_generated_at" in status;
}

function isRedirectLoginBroker(broker: BrokerCode): boolean {
    return broker === "zerodha" || broker === "upstox" || broker === "dhan";
}

function brokerSessionInputName(key: string): string {
    return `ananta_market_stack_broker_session_${key}`;
}

function isExpiredTokenStatus(sessionStatus: SessionStatus, expiresAt?: string | null): boolean {
    if (sessionStatus.session_active || !sessionStatus.has_access_token) {
        return false;
    }

    if (expiresAt) {
        const expiryTime = Date.parse(expiresAt);
        if (Number.isFinite(expiryTime) && expiryTime <= Date.now()) {
            return true;
        }
    }

    return /\bexpired\b/i.test(sessionStatus.guidance);
}

function payloadFromForm(broker: BrokerCode, formData: FormData): SessionLoginPayload {
    const value = (key: string) => String(formData.get(brokerSessionInputName(key)) ?? formData.get(key) ?? "").trim();
    switch (broker) {
        case "zerodha":
            return { broker, request_token: value("request_token") };
        case "upstox":
            return { broker, authorization_code: value("authorization_code") };
        case "angel":
            return { broker, client_code: value("client_code"), pin: value("pin"), totp: value("totp") };
        case "dhan":
            return { broker, token_id: value("token_id") };
        case "groww":
            return { broker, access_token: value("access_token") || null, totp: value("totp") || null };
        case "kotak":
            return { broker, mobile_number: value("mobile_number"), totp: value("totp"), mpin: value("mpin") };
        case "indmoney":
            return { broker, access_token: value("access_token") };
    }
}

function TOTPInput({ name = "totp", onComplete }: { name?: string; onComplete?: () => void }) {
    const inputName = brokerSessionInputName(name);
    return (
        <Input
            autoComplete="one-time-code"
            data-1p-ignore="true"
            data-form-type="other"
            data-lpignore="true"
            id={inputName}
            inputMode="numeric"
            maxLength={6}
            name={inputName}
            onChange={(event) => {
                event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
                if (event.currentTarget.value.length === 6) {
                    onComplete?.();
                }
            }}
            placeholder="123456"
            required
        />
    );
}

export function SessionPanel({ account, sessionStatus }: { account: BrokerAccount; sessionStatus: SessionStatus }) {
    const formRef = useRef<HTMLFormElement>(null);
    const growwAutoAttemptedRef = useRef(false);
    const [mode, setMode] = useState<"auto" | "totp" | "token">("auto");
    const [message, setMessage] = useState("");
    const [callbackUrl, setCallbackUrl] = useState("/broker-connections");
    const [dhanStart, setDhanStart] = useState<SessionStartResponse | null>(null);
    const [isPending, startTransition] = useTransition();
    const broker = account.broker_code;
    const setup = brokerSessionSetup[broker];
    const canManageSessions = account.access_permissions?.includes("broker.manage_sessions") ?? false;
    const refreshedAt = isZerodhaStatus(sessionStatus)
        ? sessionStatus.access_token_generated_at
        : sessionStatus.token_generated_at;
    const expiresAt = isZerodhaStatus(sessionStatus)
        ? sessionStatus.access_token_expires_at
        : sessionStatus.token_expires_at;
    const shouldHighlightLogin =
        !sessionStatus.session_active && "login_url" in sessionStatus && Boolean(sessionStatus.login_url);
    const shouldPulseLogin = shouldHighlightLogin && isExpiredTokenStatus(sessionStatus, expiresAt);
    const shouldUseManualFallback = isRedirectLoginBroker(broker);
    const hasManualSessionForm =
        broker === "indmoney" ||
        (!sessionStatus.session_active &&
            (broker === "zerodha" ||
                broker === "upstox" ||
                broker === "angel" ||
                broker === "dhan" ||
                broker === "kotak" ||
                (broker === "groww" && mode !== "auto")));
    const sessionTitle = sessionStatus.session_active ? "Broker session is active" : "Activate broker session";
    const sessionDescription = sessionStatus.session_active
        ? "Portfolio, quotes, orders, trades, positions, and holdings can refresh from this broker."
        : canManageSessions
          ? setup.activationDescription
          : "This broker needs a session update from someone with session-management access.";
    const sessionTimingItems = [
        refreshedAt ? { label: "Last refreshed", value: formatDate(refreshedAt) } : null,
        expiresAt ? { label: "Session expires", value: formatDate(expiresAt) } : null
    ].filter((item): item is { label: string; value: string } => Boolean(item));

    useEffect(() => {
        setCallbackUrl(brokerCallbackUrl(window.location.origin));
    }, []);

    useEffect(() => {
        if (broker !== "groww" || mode !== "auto" || sessionStatus.session_active || growwAutoAttemptedRef.current) {
            return;
        }

        growwAutoAttemptedRef.current = true;
        const timer = window.setTimeout(() => {
            runGrowwAutoSession({ automatic: true });
        }, 300);
        return () => window.clearTimeout(timer);
    }, [broker, mode, sessionStatus.session_active]);

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const payload = payloadFromForm(broker, new FormData(event.currentTarget));
        setMessage("");
        startTransition(async () => {
            try {
                const result = await createSession(account.id, broker, payload);
                const parts = [
                    result.message || (result.ok ? "Session updated." : "Session update failed."),
                    result.instrument_sync_message
                ].filter(Boolean);
                setMessage(parts.join(" "));
                if (result.ok) {
                    toast.success(`${account.label} session is active.`, {
                        description: result.instrument_sync_message || undefined
                    });
                } else {
                    toast.error(`${account.label} session failed.`, { description: result.message || undefined });
                }
            } catch (error) {
                const message = parseActionError(error).message;
                setMessage(message);
                toast.error(`${account.label} session failed.`, { description: message });
            }
        });
    }

    function refresh() {
        setMessage("");
        startTransition(async () => {
            try {
                const result = await refreshSession(account.id, broker);
                const message = "message" in result ? result.message : result.guidance;
                setMessage(message);
                toast.success(`${account.label} session refreshed.`, { description: message || undefined });
            } catch (error) {
                const message = parseActionError(error).message;
                setMessage(message);
                toast.error(`Could not refresh ${account.label}.`, { description: message });
            }
        });
    }

    function runGrowwAutoSession(options: { automatic?: boolean } = {}) {
        setMessage(options.automatic ? "Starting Groww session automatically..." : "");
        startTransition(async () => {
            try {
                const result = await createSession(account.id, "groww", { broker: "groww" });
                const parts = [
                    result.message || (result.ok ? "Groww session updated." : "Groww session update failed."),
                    result.instrument_sync_message
                ].filter(Boolean);
                setMessage(parts.join(" "));
            } catch (error) {
                setMessage(parseActionError(error).message);
            }
        });
    }

    function startDhan() {
        setMessage("Preparing Dhan login...");
        rememberPendingBrokerLogin();
        startTransition(async () => {
            try {
                const started = await startDhanSession(account.id);
                setDhanStart(started);
                window.location.assign(started.login_url);
            } catch (error) {
                setMessage(parseActionError(error).message);
            }
        });
    }

    function rememberPendingBrokerLogin() {
        window.localStorage.setItem(
            "ananta-market-stack:pending-broker-login",
            JSON.stringify({
                accountId: account.id,
                broker,
                createdAt: Date.now()
            })
        );
    }

    function copyCallbackUrl() {
        void navigator.clipboard?.writeText(callbackUrl);
        toast.success("Callback URL copied.");
    }

    function manualSessionForm(className?: string) {
        return (
            <form
                ref={formRef}
                autoComplete="off"
                className={cn("grid gap-3 rounded-lg border border-border p-4", className)}
                data-form-type="other"
                onSubmit={submit}
            >
                <div>
                    <h3 className="text-sm font-semibold">
                        {shouldUseManualFallback ? setup.manualFallbackLabel : setup.activationLabel}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{setup.manualFallbackDescription}</p>
                </div>
                {broker === "zerodha" ? (
                    <Input
                        autoComplete="off"
                        data-1p-ignore="true"
                        data-form-type="other"
                        data-lpignore="true"
                        name={brokerSessionInputName("request_token")}
                        placeholder="Paste request_token from redirect URL"
                        required
                    />
                ) : null}
                {broker === "upstox" ? (
                    <Input
                        autoComplete="off"
                        data-1p-ignore="true"
                        data-form-type="other"
                        data-lpignore="true"
                        name={brokerSessionInputName("authorization_code")}
                        placeholder="Paste authorization code from redirect URL"
                        required
                    />
                ) : null}
                {broker === "angel" ? (
                    <>
                        <Input
                            autoComplete="off"
                            data-1p-ignore="true"
                            data-form-type="other"
                            data-lpignore="true"
                            name={brokerSessionInputName("client_code")}
                            placeholder="Client code"
                            required
                        />
                        <Input
                            autoComplete="new-password"
                            data-1p-ignore="true"
                            data-form-type="other"
                            data-lpignore="true"
                            name={brokerSessionInputName("pin")}
                            placeholder="PIN"
                            required
                            type="password"
                        />
                        <TOTPInput onComplete={() => formRef.current?.requestSubmit()} />
                    </>
                ) : null}
                {broker === "dhan" ? (
                    <Input
                        autoComplete="off"
                        data-1p-ignore="true"
                        data-form-type="other"
                        data-lpignore="true"
                        name={brokerSessionInputName("token_id")}
                        placeholder="Paste tokenId from Dhan redirect URL"
                        required
                    />
                ) : null}
                {broker === "groww" && mode === "totp" ? (
                    <TOTPInput onComplete={() => formRef.current?.requestSubmit()} />
                ) : null}
                {broker === "groww" && mode === "token" ? (
                    <Input
                        autoComplete="new-password"
                        data-1p-ignore="true"
                        data-form-type="other"
                        data-lpignore="true"
                        name={brokerSessionInputName("access_token")}
                        placeholder="Paste access token"
                        required
                        type="password"
                    />
                ) : null}
                {broker === "kotak" ? (
                    <>
                        <Input
                            autoComplete="off"
                            data-1p-ignore="true"
                            data-form-type="other"
                            data-lpignore="true"
                            name={brokerSessionInputName("mobile_number")}
                            placeholder="Mobile number"
                            required
                        />
                        <TOTPInput onComplete={() => undefined} />
                        <Input
                            autoComplete="new-password"
                            data-1p-ignore="true"
                            data-form-type="other"
                            data-lpignore="true"
                            name={brokerSessionInputName("mpin")}
                            placeholder="MPIN"
                            required
                            type="password"
                        />
                    </>
                ) : null}
                {broker === "indmoney" ? (
                    <Input
                        autoComplete="new-password"
                        data-1p-ignore="true"
                        data-form-type="other"
                        data-lpignore="true"
                        name={brokerSessionInputName("access_token")}
                        placeholder="Paste access token"
                        required
                        type="password"
                    />
                ) : null}
                <Button className="w-fit" disabled={isPending} type="submit">
                    {isPending ? "Submitting..." : setup.manualSubmitLabel}
                </Button>
            </form>
        );
    }

    return (
        <CardFrame>
            <CardFrameHeader>
                <CardFrameTitle className="flex items-center gap-2 text-lg font-semibold">
                    {sessionStatus.session_active ? (
                        <CheckCircle2 className="size-5 text-[var(--success)]" aria-hidden="true" />
                    ) : (
                        <KeyRound className="size-5 text-primary" aria-hidden="true" />
                    )}
                    {sessionTitle}
                </CardFrameTitle>
                <CardFrameDescription className="max-w-3xl">{sessionDescription}</CardFrameDescription>
                {canManageSessions && canRefresh(broker) ? (
                    <CardFrameAction>
                        <Button disabled={isPending} onClick={refresh} type="button" variant="outline">
                            Refresh status
                        </Button>
                    </CardFrameAction>
                ) : null}
            </CardFrameHeader>
            <Card>
                <CardPanel className="grid gap-5">
                    <div className="flex flex-wrap gap-2">
                        <Badge variant={sessionStatus.session_active ? "success" : "warning"}>
                            {sessionStatus.session_active ? "Ready" : "Action needed"}
                        </Badge>
                        {sessionTimingItems.map((item) => (
                            <Badge key={item.label} variant="secondary">
                                {item.label}: {item.value}
                            </Badge>
                        ))}
                    </div>

                    {canManageSessions && setup.requiresCallbackUrl && !sessionStatus.session_active ? (
                        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
                            <div>
                                <h3 className="text-sm font-semibold">Broker callback URL</h3>
                                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                                    If {brokerNames[broker]} asks for a redirect or callback URL, use this exact value.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 text-sm">
                                    {callbackUrl}
                                </code>
                                <Button className="shrink-0" onClick={copyCallbackUrl} type="button" variant="outline">
                                    Copy URL
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {canManageSessions &&
                    broker !== "dhan" &&
                    "login_url" in sessionStatus &&
                    sessionStatus.login_url &&
                    !sessionStatus.session_active ? (
                        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4">
                            <div>
                                <h3 className="text-sm font-semibold">{setup.activationLabel}</h3>
                                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                                    {setup.activationDescription}
                                </p>
                            </div>
                            <Button
                                asChild
                                className={cn(
                                    "w-fit",
                                    shouldHighlightLogin &&
                                        "border-primary bg-[var(--accent-glow)] text-primary hover:bg-[var(--accent-subtle)]",
                                    shouldPulseLogin && "broker-login-attention"
                                )}
                            >
                                <a
                                    href={sessionStatus.login_url}
                                    onClick={rememberPendingBrokerLogin}
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    {setup.activationLabel}
                                    <ExternalLink className="size-4" aria-hidden="true" />
                                </a>
                            </Button>
                        </div>
                    ) : null}

                    {canManageSessions && broker === "dhan" && !sessionStatus.session_active ? (
                        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4">
                            <div>
                                <h3 className="text-sm font-semibold">{setup.activationLabel}</h3>
                                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                                    {setup.activationDescription}
                                </p>
                            </div>
                            <Button className="w-fit" disabled={isPending} onClick={startDhan} type="button">
                                {isPending ? "Preparing login..." : setup.activationLabel}
                                <ExternalLink className="size-4" aria-hidden="true" />
                            </Button>
                        </div>
                    ) : null}

                    {dhanStart ? (
                        <Alert>
                            <AlertDescription>
                                Dhan login is opening. If it did not open, use{" "}
                                <a
                                    className="font-semibold text-primary hover:underline"
                                    href={dhanStart.login_url}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    this Dhan login link
                                </a>
                                .
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {canManageSessions && broker === "groww" ? (
                        <div className="flex flex-wrap gap-2">
                            {(["auto", "totp", "token"] as const).map((item) => (
                                <Button
                                    size="sm"
                                    variant={mode === item ? "default" : "outline"}
                                    key={item}
                                    onClick={() => setMode(item)}
                                    type="button"
                                >
                                    {item === "auto" ? "Auto" : item === "totp" ? "TOTP" : "Access token"}
                                </Button>
                            ))}
                        </div>
                    ) : null}

                    {canManageSessions && broker === "groww" && mode === "auto" && !sessionStatus.session_active ? (
                        <div className="rounded-lg border border-border p-4">
                            <Button
                                className="border-primary bg-[var(--accent-glow)] text-primary hover:bg-[var(--accent-subtle)]"
                                disabled={isPending}
                                onClick={() => runGrowwAutoSession()}
                                type="button"
                            >
                                {isPending ? "Refreshing..." : "Run automatic refresh"}
                            </Button>
                            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                                Uses saved Groww credentials to activate the session.
                            </p>
                        </div>
                    ) : null}

                    {canManageSessions && hasManualSessionForm ? (
                        shouldUseManualFallback ? (
                            <details className="rounded-lg border border-border bg-muted/20 p-4">
                                <summary className="cursor-pointer text-sm font-semibold">
                                    {setup.manualFallbackLabel}
                                </summary>
                                <div className="pt-3">{manualSessionForm("border-dashed bg-background")}</div>
                            </details>
                        ) : (
                            manualSessionForm()
                        )
                    ) : null}

                    {message ? (
                        <Alert>
                            <AlertDescription>{message}</AlertDescription>
                        </Alert>
                    ) : null}
                    {!canManageSessions ? (
                        <p className="text-sm text-muted-foreground">
                            You can view this broker account, but a workspace admin must activate or refresh the
                            session.
                        </p>
                    ) : null}
                </CardPanel>
            </Card>
        </CardFrame>
    );
}
