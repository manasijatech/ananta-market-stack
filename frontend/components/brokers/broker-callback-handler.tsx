"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSession, verifyBrokerAccount } from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { BrokerAccount, BrokerCode, SessionLoginPayload } from "@/service/types/broker";

type CallbackState = {
 tone: "default" | "warning" | "destructive";
 message: string;
};

type PendingBrokerLogin = {
 accountId?: string;
 broker?: BrokerCode;
 createdAt?: number;
};

const pendingLoginKey = "market-stack:pending-broker-login";
const pendingLoginMaxAgeMs = 10 * 60 * 1000;

function callbackPayload(params: URLSearchParams): {
 broker: "zerodha" | "upstox";
 token: string;
 payload: SessionLoginPayload;
} | null {
 const requestToken = params.get("request_token");
 if (requestToken) {
 return {
 broker: "zerodha",
 token: requestToken,
 payload: { broker: "zerodha", request_token: requestToken }
 };
 }

 const code = params.get("code") ?? params.get("authorization_code");
 if (code) {
 return {
 broker: "upstox",
 token: code,
 payload: { broker: "upstox", authorization_code: code }
 };
 }

 return null;
}

function pickAccount(accounts: BrokerAccount[], broker: BrokerCode, state: string | null): BrokerAccount | null {
 const brokerAccounts = accounts.filter((account) => account.broker_code === broker);
 if (state) {
 return brokerAccounts.find((account) => account.id === state) ?? null;
 }

 const pending = readPendingBrokerLogin();
 const pendingIsFresh = typeof pending?.createdAt === "number" && Date.now() - pending.createdAt < pendingLoginMaxAgeMs;
 if (pendingIsFresh && pending?.broker === broker && pending.accountId) {
 const pendingAccount = brokerAccounts.find((account) => account.id === pending.accountId);
 if (pendingAccount) {
 return pendingAccount;
 }
 }

 return brokerAccounts.length === 1 ? brokerAccounts[0] : null;
}

function readPendingBrokerLogin(): PendingBrokerLogin | null {
 try {
 const raw = window.localStorage.getItem(pendingLoginKey);
 if (!raw) {
 return null;
 }
 const parsed = JSON.parse(raw) as unknown;
 if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
 return null;
 }
 return parsed as PendingBrokerLogin;
 } catch {
 return null;
 }
}

export function BrokerCallbackHandler({ accounts }: { accounts: BrokerAccount[] }) {
 const router = useRouter();
 const searchParams = useSearchParams();
 const [callbackState, setCallbackState] = useState<CallbackState | null>(null);
 const handledRef = useRef(false);

 const serializedParams = searchParams.toString();
 const payload = useMemo(() => callbackPayload(new URLSearchParams(serializedParams)), [serializedParams]);

 useEffect(() => {
 if (!payload || handledRef.current) {
 return;
 }

 handledRef.current = true;

 const params = new URLSearchParams(serializedParams);
 const state = params.get("state");
 const account = pickAccount(accounts, payload.broker, state);

 if (!accounts.length) {
 setCallbackState({
 tone: "warning",
 message:
 "Broker login returned successfully, but this browser session cannot see any broker accounts. Open Market Stack using localhost:3000 before starting broker login, then use the same host for the callback."
 });
 return;
 }

 if (!account) {
 setCallbackState({
 tone: "warning",
 message:
 state
 ? `Broker login returned with state ${state}, but no matching ${payload.broker} account was found for this signed-in user.`
 : `Broker login returned, but there is not exactly one ${payload.broker} account to attach it to. Open the correct broker detail page and paste the token manually.`
 });
 return;
 }

 const selectedAccount = account;
 const selectedPayload = payload;

 setCallbackState({
 tone: "default",
 message: `Connecting ${selectedAccount.label} automatically. Keep this tab open for a moment.`
 });

 async function connect() {
 try {
 await createSession(selectedAccount.id, selectedPayload.broker, selectedPayload.payload);
 await verifyBrokerAccount(selectedAccount.id);
 window.localStorage.removeItem(pendingLoginKey);
 router.replace(`/broker-connections/${selectedAccount.id}`);
 router.refresh();
 } catch (caught) {
 const message = parseActionError(caught).message;
 setCallbackState({
 tone: "destructive",
 message: `Broker login returned, but Market Stack could not finish setup automatically. ${message}`
 });
 }
 }

 void connect();
 }, [accounts, payload, router, serializedParams]);

 if (!callbackState) {
 return null;
 }

 return (
 <Alert className="mb-6" variant={callbackState.tone === "destructive" ? "destructive" : "warning"}>
 <AlertDescription>{callbackState.message}</AlertDescription>
 </Alert>
 );
}
