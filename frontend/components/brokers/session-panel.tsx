"use client";

import { FormEvent, useRef, useState, useTransition } from "react";
import { createSession, refreshSession, startDhanSession } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { formatDate } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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

function payloadFromForm(broker: BrokerCode, formData: FormData): SessionLoginPayload {
 const value = (key: string) => String(formData.get(key) ?? "").trim();
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
 return (
 <Input
 inputMode="numeric"
 maxLength={6}
 name={name}
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

export function SessionPanel({
 account,
 sessionStatus
}: {
 account: BrokerAccount;
 sessionStatus: SessionStatus;
}) {
 const formRef = useRef<HTMLFormElement>(null);
 const [mode, setMode] = useState<"auto" | "totp" | "token">("auto");
 const [message, setMessage] = useState("");
 const [dhanStart, setDhanStart] = useState<SessionStartResponse | null>(null);
 const [isPending, startTransition] = useTransition();
 const broker = account.broker_code;
 const refreshedAt = isZerodhaStatus(sessionStatus)
 ? sessionStatus.access_token_generated_at
 : sessionStatus.token_generated_at;
 const expiresAt = isZerodhaStatus(sessionStatus)
 ? sessionStatus.access_token_expires_at
 : sessionStatus.token_expires_at;
 const shouldPulseLogin =
 !sessionStatus.session_active && "login_url" in sessionStatus && Boolean(sessionStatus.login_url);
 const hasManualSessionForm =
 !sessionStatus.session_active &&
 (broker === "zerodha" ||
 broker === "upstox" ||
 broker === "angel" ||
 broker === "dhan" ||
 broker === "kotak" ||
 broker === "indmoney" ||
 (broker === "groww" && mode !== "auto"));

 function submit(event: FormEvent<HTMLFormElement>) {
 event.preventDefault();
 const payload = payloadFromForm(broker, new FormData(event.currentTarget));
 setMessage("");
 startTransition(async () => {
 try {
 const result = await createSession(account.id, broker, payload);
 setMessage(result.message || (result.ok ? "Session updated." : "Session update failed."));
 } catch (error) {
 setMessage(parseActionError(error).message);
 }
 });
 }

 function refresh() {
 setMessage("");
 startTransition(async () => {
 try {
 const result = await refreshSession(account.id, broker);
 setMessage("message" in result ? result.message : result.guidance);
 } catch (error) {
 setMessage(parseActionError(error).message);
 }
 });
 }

 function runGrowwAutoSession() {
 setMessage("");
 startTransition(async () => {
 try {
 const result = await createSession(account.id, "groww", { broker: "groww" });
 setMessage(result.message || (result.ok ? "Groww session updated." : "Groww session update failed."));
 } catch (error) {
 setMessage(parseActionError(error).message);
 }
 });
 }

 function startDhan() {
 setMessage("");
 startTransition(async () => {
 try {
 setDhanStart(await startDhanSession(account.id));
 } catch (error) {
 setMessage(parseActionError(error).message);
 }
 });
 }

 function rememberPendingBrokerLogin() {
 window.localStorage.setItem("market-stack:pending-broker-login", JSON.stringify({
 accountId: account.id,
 broker,
 createdAt: Date.now()
 }));
 }

 return (
 <section className="border-t border-border py-8">
 <div className="flex flex-col justify-between gap-4 min-[760px]:flex-row min-[760px]:items-start">
 <div>
 <h2 className="text-xl font-bold">Session status</h2>
 <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{sessionStatus.guidance}</p>
 <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
 <Badge className={sessionStatus.session_active ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]" : "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]"} variant="outline">
 {sessionStatus.session_active ? "Active" : "Action required"}
 </Badge>
 <Badge variant="secondary">
 Access token: {sessionStatus.has_access_token ? "stored" : "missing"}
 </Badge>
 </div>
 </div>
 {canRefresh(broker) ? (
 <Button className="self-start" disabled={isPending} onClick={refresh} type="button" variant="outline">
 Refresh
 </Button>
 ) : null}
 </div>

 <dl className="mt-6 grid gap-3 text-sm min-[720px]:grid-cols-2">
 <div>
 <dt className="font-bold text-muted-foreground">Last refreshed</dt>
 <dd>{formatDate(refreshedAt)}</dd>
 </div>
 <div>
 <dt className="font-bold text-muted-foreground">Expires</dt>
 <dd>{formatDate(expiresAt)}</dd>
 </div>
 </dl>

 {"login_url" in sessionStatus && sessionStatus.login_url && !sessionStatus.session_active ? (
 <Button
 asChild
 className={cn(
 "mt-5",
 shouldPulseLogin &&
 "border-primary bg-[var(--accent-glow)] text-primary hover:bg-[var(--accent-subtle)]"
 )}
 >
 <a href={sessionStatus.login_url} onClick={rememberPendingBrokerLogin} rel="noreferrer" target="_blank">
 Open broker login
 </a>
 </Button>
 ) : null}

 {"login_url" in sessionStatus && sessionStatus.login_url && !sessionStatus.session_active && hasManualSessionForm ? (
 <div className="my-6 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
 <span className="h-px flex-1 bg-border" />
 <span>or enter manually</span>
 <span className="h-px flex-1 bg-border" />
 </div>
 ) : null}

 {broker === "dhan" ? (
 <Button className="mt-5" disabled={isPending} onClick={startDhan} type="button" variant="outline">
 Start Dhan consent flow
 </Button>
 ) : null}

 {dhanStart ? (
 <Alert className="mt-4">
 <a className="font-bold text-primary hover:underline" href={dhanStart.login_url} target="_blank" rel="noreferrer">
 Open Dhan login
 </a>
 <AlertDescription className="mt-2">{dhanStart.guidance}</AlertDescription>
 </Alert>
 ) : null}

 {broker === "groww" ? (
 <div className="mt-5 flex flex-wrap gap-2">
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

 {broker === "groww" && mode === "auto" && !sessionStatus.session_active ? (
 <div className="mt-5">
 <Button
 className="border-primary bg-[var(--accent-glow)] text-primary hover:bg-[var(--accent-subtle)]"
 disabled={isPending}
 onClick={runGrowwAutoSession}
 type="button"
 >
 {isPending ? "Refreshing..." : "Run automatic refresh"}
 </Button>
 <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
 Uses the saved Groww API key and API secret to request an access token.
 </p>
 </div>
 ) : null}

 {hasManualSessionForm ? (
 <form ref={formRef} className="mt-6 grid gap-3 border-t border-border pt-5" onSubmit={submit}>
 {broker === "zerodha" ? <Input name="request_token" placeholder="request_token" required /> : null}
 {broker === "upstox" ? <Input name="authorization_code" placeholder="authorization_code" required /> : null}
 {broker === "angel" ? (
 <>
 <Input name="client_code" placeholder="Client code" required />
 <Input name="pin" placeholder="PIN" required type="password" />
 <TOTPInput onComplete={() => formRef.current?.requestSubmit()} />
 </>
 ) : null}
 {broker === "dhan" ? <Input name="token_id" placeholder="token_id" required /> : null}
 {broker === "groww" && mode === "totp" ? <TOTPInput onComplete={() => formRef.current?.requestSubmit()} /> : null}
 {broker === "groww" && mode === "token" ? <Input name="access_token" placeholder="Access token" required type="password" /> : null}
 {broker === "kotak" ? (
 <>
 <Input name="mobile_number" placeholder="Mobile number" required />
 <TOTPInput onComplete={() => undefined} />
 <Input name="mpin" placeholder="MPIN" required type="password" />
 </>
 ) : null}
 {broker === "indmoney" ? <Input name="access_token" placeholder="Access token" required type="password" /> : null}
 <Button disabled={isPending} type="submit">
 {isPending ? "Submitting..." : broker === "groww" && mode === "auto" ? "Run automatic refresh" : "Update session"}
 </Button>
 </form>
 ) : null}

 {message ? (
 <Alert className="mt-4">
 <AlertDescription>{message}</AlertDescription>
 </Alert>
 ) : null}
 </section>
 );
}
