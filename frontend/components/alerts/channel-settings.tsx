"use client";

import { useState, useTransition } from "react";
import { saveAlertChannel, sendTestAlert, testAlertChannel } from "@/service/actions/alerts";
import type { AlertChannel } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ChannelState = {
 label: string;
 is_enabled: boolean;
 is_default: boolean;
 config: Record<string, string>;
};

function stateFor(channel?: AlertChannel, defaults?: Record<string, string>): ChannelState {
 return {
 label: channel?.label ?? "",
 is_enabled: channel?.is_enabled ?? true,
 is_default: channel?.is_default ?? false,
 config: { ...(defaults ?? {}), ...Object.fromEntries(Object.entries(channel?.config ?? {}).map(([key, value]) => [key, String(value ?? "")])) }
 };
}

export function ChannelSettings({ initialChannels }: { initialChannels: AlertChannel[] }) {
 const discordInitial = initialChannels.find((item) => item.channel_type === "discord");
 const telegramInitial = initialChannels.find((item) => item.channel_type === "telegram");
 const [discord, setDiscord] = useState(stateFor(discordInitial, { webhook_url: "" }));
 const [telegram, setTelegram] = useState(stateFor(telegramInitial, { bot_token: "", chat_id: "" }));
 const [message, setMessage] = useState("Market Stack channel test");
 const [error, setError] = useState("");
 const [isPending, startTransition] = useTransition();

 function save(channelType: "discord" | "telegram") {
 setError("");
 startTransition(async () => {
 try {
 const payload = channelType === "discord" ? discord : telegram;
 const saved = await saveAlertChannel(channelType, payload);
 if (channelType === "discord") {
 setDiscord(stateFor(saved, { webhook_url: "" }));
 } else {
 setTelegram(stateFor(saved, { bot_token: "", chat_id: "" }));
 }
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not save channel.");
 }
 });
 }

 function test(channelType: "discord" | "telegram") {
 setError("");
 startTransition(async () => {
 try {
 const saved = await testAlertChannel(channelType, message);
 if (channelType === "discord") {
 setDiscord(stateFor(saved, { webhook_url: "" }));
 } else {
 setTelegram(stateFor(saved, { bot_token: "", chat_id: "" }));
 }
 } catch (caught) {
 setError(caught instanceof Error ? caught.message : "Could not test channel.");
 }
 });
 }

 function sendInAppTest() {
 startTransition(async () => {
 await sendTestAlert({ message, channels: ["in_app"] });
 });
 }

 return (
 <div className="grid gap-6">
 {error ? <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div> : null}
 <div className=" border border-border p-4">
 <div className="mb-3 text-sm font-bold">Shared test message</div>
 <div className="grid gap-3 min-[960px]:grid-cols-[1fr_auto]">
 <Input onChange={(event) => setMessage(event.target.value)} value={message} />
 <Button disabled={isPending} onClick={sendInAppTest} type="button" variant="outline">
 Test in-app alert
 </Button>
 </div>
 </div>
 <ChannelCard
 channel={discord}
 fields={[{ key: "webhook_url", label: "Discord webhook URL" }]}
 onChange={setDiscord}
 onSave={() => save("discord")}
 onTest={() => test("discord")}
 title="Discord"
 />
 <ChannelCard
 channel={telegram}
 fields={[
 { key: "bot_token", label: "Telegram bot token" },
 { key: "chat_id", label: "Telegram chat id" }
 ]}
 onChange={setTelegram}
 onSave={() => save("telegram")}
 onTest={() => test("telegram")}
 title="Telegram"
 />
 </div>
 );
}

function ChannelCard({
 channel,
 fields,
 onChange,
 onSave,
 onTest,
 title
}: {
 channel: ChannelState;
 fields: Array<{ key: string; label: string }>;
 onChange: (value: ChannelState) => void;
 onSave: () => void;
 onTest: () => void;
 title: string;
}) {
 return (
 <div className=" border border-border p-4">
 <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
 <div className="text-sm font-bold">{title}</div>
 <div className="flex gap-3 text-sm">
 <label className="flex items-center gap-2"><input checked={channel.is_enabled} onChange={(event) => onChange({ ...channel, is_enabled: event.target.checked })} type="checkbox" />Enabled</label>
 <label className="flex items-center gap-2"><input checked={channel.is_default} onChange={(event) => onChange({ ...channel, is_default: event.target.checked })} type="checkbox" />Default</label>
 </div>
 </div>
 <div className="grid gap-3">
 <Input onChange={(event) => onChange({ ...channel, label: event.target.value })} placeholder={`${title} label`} value={channel.label} />
 {fields.map((field) => (
 <Input
 key={field.key}
 onChange={(event) => onChange({ ...channel, config: { ...channel.config, [field.key]: event.target.value } })}
 placeholder={field.label}
 value={channel.config[field.key] ?? ""}
 />
 ))}
 </div>
 <div className="mt-4 flex flex-wrap gap-3">
 <Button onClick={onSave} type="button">Save</Button>
 <Button onClick={onTest} type="button" variant="outline">Test</Button>
 </div>
 </div>
 );
}
