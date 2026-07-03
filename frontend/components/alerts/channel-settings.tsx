"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { CircleHelpIcon, MonitorSpeakerIcon, PlugZapIcon, Trash2Icon } from "lucide-react";
import {
    getDesktopAudioPairing,
    revokeDesktopAudioDevice,
    saveAlertChannel,
    sendTestAlert,
    startDesktopAudioPairing,
    testAlertChannel
} from "@/service/actions/alerts";
import type { AlertChannel, DesktopAudioDevice } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ChannelState = {
    label: string;
    is_enabled: boolean;
    is_default: boolean;
    config: Record<string, string>;
};

type ChannelField = {
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
};

type ChannelGuide = {
    title: string;
    summary: string;
    requiredFields: string[];
    optionalFields: string[];
    steps: string[];
    notes: string[];
};

const compactFieldClassName = "h-9 w-full max-w-md text-sm";
const compactFieldGridClassName = "grid max-w-md gap-3";

const CHANNEL_GUIDES: Record<"discord" | "telegram", ChannelGuide> = {
    discord: {
        title: "Discord setup guide",
        summary: "Ananta Market Stack sends alerts to Discord by posting to one incoming webhook URL.",
        requiredFields: ["Discord webhook URL"],
        optionalFields: ["Label"],
        steps: [
            "Open the Discord server where you want alerts to arrive.",
            "Go to Server Settings > Integrations > Webhooks.",
            "Create a webhook, choose the target text channel, and copy the generated webhook URL.",
            "Paste that value into `Discord webhook URL`, then save and run a test."
        ],
        notes: [
            "The backend only uses `webhook_url` for Discord delivery and test sends.",
            "A webhook posts into one specific Discord channel, so pick the channel during webhook setup."
        ]
    },
    telegram: {
        title: "Telegram setup guide",
        summary:
            "Ananta Market Stack sends alerts through the Telegram Bot API using your bot token and a destination chat id.",
        requiredFields: ["Telegram bot token", "Telegram chat id"],
        optionalFields: ["Label"],
        steps: [
            "In Telegram, open `@BotFather`, create a bot with `/newbot`, and copy the bot token.",
            "Open a direct chat with your bot or add it to the target group/channel.",
            "Send at least one message in that destination so Telegram creates an update for the bot.",
            "Fetch updates from `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` and copy the destination `chat.id`.",
            "Paste the token into `Telegram bot token` and the numeric id into `Telegram chat id`, then save and run a test."
        ],
        notes: [
            "The backend sends Telegram messages with `bot_token` plus `chat_id` only.",
            "Group or channel ids may be negative numbers. Keep the value exactly as Telegram returns it.",
            "If the bot is posting to a group or channel, make sure the bot has permission to send messages there."
        ]
    }
};

const desktopDefaults = {
    spoken_template: "{title}. {message}",
    model_id: "openai/gpt-4o-mini-tts",
    voice: "alloy",
    speed: "1",
    response_format: "mp3",
    retention_days: "15",
    enabled_device_ids: ""
};

function stateFor(channel?: AlertChannel, defaults?: Record<string, string>): ChannelState {
    return {
        label: channel?.label ?? "",
        is_enabled: channel?.is_enabled ?? true,
        is_default: channel?.is_default ?? false,
        config: {
            ...(defaults ?? {}),
            ...Object.fromEntries(
                Object.entries(channel?.config ?? {}).map(([key, value]) => [key, String(value ?? "")])
            )
        }
    };
}

export function ChannelSettings({
    initialChannels,
    initialDesktopAudioDevices
}: {
    initialChannels: AlertChannel[];
    initialDesktopAudioDevices: DesktopAudioDevice[];
}) {
    const discordInitial = initialChannels.find((item) => item.channel_type === "discord");
    const telegramInitial = initialChannels.find((item) => item.channel_type === "telegram");
    const desktopInitial = initialChannels.find((item) => item.channel_type === "desktop_audio");
    const [discord, setDiscord] = useState(stateFor(discordInitial, { webhook_url: "" }));
    const [telegram, setTelegram] = useState(stateFor(telegramInitial, { bot_token: "", chat_id: "" }));
    const [desktopAudio, setDesktopAudio] = useState(stateFor(desktopInitial, desktopDefaults));
    const [devices, setDevices] = useState(initialDesktopAudioDevices);
    const [pairingStatus, setPairingStatus] = useState("");
    const [message, setMessage] = useState("Ananta Market Stack channel test");
    const [error, setError] = useState("");
    const [isPending, startTransition] = useTransition();

    function save(channelType: "discord" | "telegram" | "desktop_audio") {
        setError("");
        startTransition(async () => {
            try {
                const payload = channelType === "discord" ? discord : channelType === "telegram" ? telegram : desktopAudio;
                const saved = await saveAlertChannel(channelType, payload);
                if (channelType === "discord") {
                    setDiscord(stateFor(saved, { webhook_url: "" }));
                } else if (channelType === "telegram") {
                    setTelegram(stateFor(saved, { bot_token: "", chat_id: "" }));
                } else {
                    setDesktopAudio(stateFor(saved, desktopDefaults));
                }
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not save channel.");
            }
        });
    }

    function test(channelType: "discord" | "telegram" | "desktop_audio") {
        setError("");
        startTransition(async () => {
            try {
                const saved = await testAlertChannel(channelType, message);
                if (channelType === "discord") {
                    setDiscord(stateFor(saved, { webhook_url: "" }));
                } else if (channelType === "telegram") {
                    setTelegram(stateFor(saved, { bot_token: "", chat_id: "" }));
                } else {
                    setDesktopAudio(stateFor(saved, desktopDefaults));
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

    function resolvedApiBaseUrl() {
        const configured = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";
        if (configured.startsWith("http://") || configured.startsWith("https://")) return configured.replace(/\/+$/, "");
        return new URL(configured, window.location.origin).toString().replace(/\/+$/, "");
    }

    function connectDesktopApp() {
        setError("");
        setPairingStatus("Preparing pairing request...");
        startTransition(async () => {
            try {
                const pairing = await startDesktopAudioPairing({
                    app_url: window.location.origin,
                    metadata: { source: "settings" }
                });
                const payload = {
                    pairingId: pairing.pairing_id,
                    secret: pairing.secret,
                    stackUrl: window.location.origin,
                    apiBaseUrl: resolvedApiBaseUrl()
                };
                let sentLocal = false;
                for (let port = 17853; port <= 17857; port += 1) {
                    try {
                        const response = await fetch(`http://127.0.0.1:${port}/pair`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify(payload)
                        });
                        if (response.ok) {
                            sentLocal = true;
                            break;
                        }
                    } catch {
                        // Try the next helper port.
                    }
                }
                if (!sentLocal) {
                    window.location.href = `ananta-audio://pair?payload=${encodeURIComponent(JSON.stringify(payload))}`;
                    setPairingStatus("Opened the desktop app pairing link. Return here after the app confirms connection.");
                } else {
                    setPairingStatus("Pairing request sent to the local desktop app.");
                }
                window.setTimeout(async () => {
                    const status = await getDesktopAudioPairing(pairing.pairing_id).catch(() => null);
                    if (status?.status === "completed") {
                        setPairingStatus("Desktop app connected.");
                    }
                }, 2500);
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not start desktop pairing.");
                setPairingStatus("");
            }
        });
    }

    function revokeDevice(deviceId: string) {
        setError("");
        startTransition(async () => {
            try {
                await revokeDesktopAudioDevice(deviceId);
                setDevices((current) => current.map((item) => (item.id === deviceId ? { ...item, status: "revoked" } : item)));
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not revoke desktop device.");
            }
        });
    }

    return (
        <div className="grid gap-5">
            {error ? (
                <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">
                    {error}
                </div>
            ) : null}
            <div className="border border-border p-4">
                <div className="mb-3 text-sm font-bold tracking-tight">Shared test message</div>
                <div className="grid max-w-md gap-2">
                    <Input
                        className={compactFieldClassName}
                        onChange={(event) => setMessage(event.target.value)}
                        value={message}
                    />
                    <Button
                        className="h-9 w-fit px-4"
                        disabled={isPending}
                        onClick={sendInAppTest}
                        type="button"
                        variant="outline"
                    >
                        Test in-app alert
                    </Button>
                </div>
            </div>
            <DesktopAudioCard
                channel={desktopAudio}
                devices={devices}
                isPending={isPending}
                onChange={setDesktopAudio}
                onConnect={connectDesktopApp}
                onRevoke={revokeDevice}
                onSave={() => save("desktop_audio")}
                onTest={() => test("desktop_audio")}
                pairingStatus={pairingStatus}
            />
            <ChannelCard
                channel={discord}
                fields={[
                    { key: "webhook_url", label: "Webhook URL", placeholder: "Paste webhook URL", required: true }
                ]}
                guide={CHANNEL_GUIDES.discord}
                onChange={setDiscord}
                onSave={() => save("discord")}
                onTest={() => test("discord")}
                title="Discord"
            />
            <ChannelCard
                channel={telegram}
                fields={[
                    { key: "bot_token", label: "Bot token", placeholder: "Paste bot token", required: true },
                    { key: "chat_id", label: "Chat ID", placeholder: "Paste destination chat id", required: true }
                ]}
                guide={CHANNEL_GUIDES.telegram}
                onChange={setTelegram}
                onSave={() => save("telegram")}
                onTest={() => test("telegram")}
                title="Telegram"
            />
        </div>
    );
}

function DesktopAudioCard({
    channel,
    devices,
    isPending,
    onChange,
    onConnect,
    onRevoke,
    onSave,
    onTest,
    pairingStatus
}: {
    channel: ChannelState;
    devices: DesktopAudioDevice[];
    isPending: boolean;
    onChange: (value: ChannelState) => void;
    onConnect: () => void;
    onRevoke: (deviceId: string) => void;
    onSave: () => void;
    onTest: () => void;
    pairingStatus: string;
}) {
    const activeDevices = devices.filter((device) => device.status === "active");
    return (
        <div className="border border-border p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-3 text-lg font-bold leading-none tracking-tight">
                        <MonitorSpeakerIcon className="size-5 text-primary" />
                        Desktop Audio
                    </div>
                    <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                        Pair the tray app once, then Ananta generates MP3 alert audio with your saved OpenRouter key
                        and streams it to all active devices. HTTP stack URLs are allowed, but the desktop app will show
                        a warning when a connection is not encrypted.
                    </p>
                </div>
                <Button className="h-9 gap-2 px-4" disabled={isPending} onClick={onConnect} type="button">
                    <PlugZapIcon className="size-4" />
                    Connect app
                </Button>
            </div>
            {pairingStatus ? (
                <div className="mb-4 border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                    {pairingStatus}
                </div>
            ) : null}
            <div className="mb-4 flex flex-col gap-2 text-sm">
                <Label className="flex items-center gap-2">
                    <Checkbox
                        checked={channel.is_enabled}
                        onCheckedChange={(checked) => onChange({ ...channel, is_enabled: Boolean(checked) })}
                    />
                    Enabled
                </Label>
                <Label className="flex items-center gap-2">
                    <Checkbox
                        checked={channel.is_default}
                        onCheckedChange={(checked) => onChange({ ...channel, is_default: Boolean(checked) })}
                    />
                    Default
                </Label>
            </div>
            <div className="grid gap-3 min-[760px]:grid-cols-2">
                <LabeledField label="Spoken template" required>
                    <Input
                        className={compactFieldClassName}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, spoken_template: event.target.value } })
                        }
                        value={channel.config.spoken_template ?? desktopDefaults.spoken_template}
                    />
                </LabeledField>
                <LabeledField label="OpenRouter TTS model" required>
                    <Input
                        className={compactFieldClassName}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, model_id: event.target.value } })
                        }
                        value={channel.config.model_id ?? desktopDefaults.model_id}
                    />
                </LabeledField>
                <LabeledField label="Voice" required={false}>
                    <Input
                        className={compactFieldClassName}
                        onChange={(event) => onChange({ ...channel, config: { ...channel.config, voice: event.target.value } })}
                        value={channel.config.voice ?? desktopDefaults.voice}
                    />
                </LabeledField>
                <LabeledField label="Retention days" required={false}>
                    <Input
                        className={compactFieldClassName}
                        min={1}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, retention_days: event.target.value } })
                        }
                        type="number"
                        value={channel.config.retention_days ?? desktopDefaults.retention_days}
                    />
                </LabeledField>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
                <Button className="h-9 px-4" onClick={onSave} type="button">
                    Save
                </Button>
                <Button className="h-9 px-4" disabled={!activeDevices.length} onClick={onTest} type="button" variant="outline">
                    Test audio
                </Button>
            </div>
            <div className="mt-5 grid gap-2">
                <div className="text-sm font-bold">Paired devices</div>
                {devices.length ? (
                    <div className="grid gap-2">
                        {devices.map((device) => (
                            <div className="flex flex-wrap items-center justify-between gap-3 border border-border px-3 py-2" key={device.id}>
                                <div>
                                    <div className="text-sm font-medium">{device.label || "Ananta Audio App"}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {device.status} {device.last_seen_at ? `- seen ${new Date(device.last_seen_at).toLocaleString()}` : ""}
                                    </div>
                                </div>
                                {device.status === "active" ? (
                                    <Button
                                        aria-label={`Revoke ${device.label}`}
                                        className="size-8"
                                        onClick={() => onRevoke(device.id)}
                                        size="icon"
                                        type="button"
                                        variant="outline"
                                    >
                                        <Trash2Icon className="size-4" />
                                    </Button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                        No desktop audio app is paired yet.
                    </div>
                )}
            </div>
        </div>
    );
}

function ChannelCard({
    channel,
    fields,
    guide,
    onChange,
    onSave,
    onTest,
    title
}: {
    channel: ChannelState;
    fields: ChannelField[];
    guide: ChannelGuide;
    onChange: (value: ChannelState) => void;
    onSave: () => void;
    onTest: () => void;
    title: string;
}) {
    const brandIcon =
        title === "Discord"
            ? "/brand/providers/discord.svg"
            : title === "Telegram"
              ? "/brand/providers/telegram.svg"
              : null;
    const brandIconClassName = title === "Telegram" ? "h-6 w-6" : "h-5 w-5";

    return (
        <div className="border border-border p-4">
            <div className="mb-4 grid gap-3">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-3 text-lg font-bold leading-none tracking-tight">
                        {brandIcon ? (
                            <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center">
                                <img
                                    alt=""
                                    className={`${brandIconClassName} object-contain`}
                                    draggable={false}
                                    src={brandIcon}
                                />
                            </span>
                        ) : null}
                        <span>{title}</span>
                    </div>
                    <SetupGuide guide={guide} />
                </div>
                <div className="flex flex-col gap-2 text-sm">
                    <Label className="flex items-center gap-2">
                        <Checkbox
                            checked={channel.is_enabled}
                            onCheckedChange={(checked) => onChange({ ...channel, is_enabled: Boolean(checked) })}
                        />
                        Enabled
                    </Label>
                    <Label className="flex items-center gap-2">
                        <Checkbox
                            checked={channel.is_default}
                            onCheckedChange={(checked) => onChange({ ...channel, is_default: Boolean(checked) })}
                        />
                        Default
                    </Label>
                </div>
            </div>
            <div className={compactFieldGridClassName}>
                <LabeledField label="Label" required={false}>
                    <Input
                        className={compactFieldClassName}
                        onChange={(event) => onChange({ ...channel, label: event.target.value })}
                        placeholder="Optional label"
                        value={channel.label}
                    />
                </LabeledField>
                {fields.map((field) => (
                    <LabeledField key={field.key} label={field.label} required={Boolean(field.required)}>
                        <Input
                            autoComplete="off"
                            className={compactFieldClassName}
                            data-1p-ignore="true"
                            data-form-type="other"
                            data-lpignore="true"
                            onChange={(event) =>
                                onChange({ ...channel, config: { ...channel.config, [field.key]: event.target.value } })
                            }
                            placeholder={field.placeholder ?? field.label}
                            value={channel.config[field.key] ?? ""}
                        />
                    </LabeledField>
                ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
                <Button className="h-9 px-4" onClick={onSave} type="button">
                    Save
                </Button>
                <Button className="h-9 px-4" onClick={onTest} type="button" variant="outline">
                    Test
                </Button>
            </div>
        </div>
    );
}

function LabeledField({ children, label, required }: { children: ReactNode; label: string; required: boolean }) {
    return (
        <Label className="grid gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
                <span>{label}</span>
                <span
                    className={`rounded border px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] ${required ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                    {required ? "Required" : "Optional"}
                </span>
            </div>
            {children}
        </Label>
    );
}

function SetupGuide({ guide }: { guide: ChannelGuide }) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button
                    aria-label={`${guide.title} help`}
                    className="size-6 border-transparent bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-primary"
                    size="icon"
                    type="button"
                    variant="ghost"
                >
                    <CircleHelpIcon className="size-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto p-0">
                <DialogHeader className="border-b border-border px-6 py-5 pr-14">
                    <DialogTitle>{guide.title}</DialogTitle>
                    <DialogDescription>{guide.summary}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 px-6 py-5 text-sm">
                    <section className="grid gap-3">
                        <div className="font-semibold text-foreground">Fields</div>
                        <div className="grid gap-2">
                            <div>
                                <span className="font-medium">Required:</span> {guide.requiredFields.join(", ")}
                            </div>
                            <div>
                                <span className="font-medium">Optional:</span> {guide.optionalFields.join(", ")}
                            </div>
                        </div>
                    </section>
                    <section className="grid gap-3">
                        <div className="font-semibold text-foreground">Setup</div>
                        <ol className="grid list-decimal gap-2 pl-5">
                            {guide.steps.map((step) => (
                                <li key={step}>{step}</li>
                            ))}
                        </ol>
                    </section>
                    <section className="grid gap-3">
                        <div className="font-semibold text-foreground">Notes</div>
                        <ul className="grid list-disc gap-2 pl-5">
                            {guide.notes.map((note) => (
                                <li key={note}>{note}</li>
                            ))}
                        </ul>
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}
