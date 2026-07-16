"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import { CircleHelpIcon, MonitorSpeakerIcon, PlugZapIcon, Trash2Icon } from "lucide-react";
import {
    getDesktopAudioEdgeVoicesSafe,
    getDesktopAudioDevicesSafe,
    getDesktopAudioPairingSafe,
    revokeDesktopAudioDeviceSafe,
    saveAlertChannelSafe,
    sendTestAlert,
    startDesktopAudioPairingSafe,
    testAlertChannelSafe
} from "@/service/actions/alerts";
import type { AlertChannel, DesktopAudioDevice, DesktopAudioVoiceOption, EdgeAudioVoiceOption } from "@/service/types/alerts";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";

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

type SelectOption = {
    label: string;
    value: string;
    disabled?: boolean;
};

const compactFieldClassName = "h-9 w-full max-w-md text-sm";
const compactFieldGridClassName = "grid max-w-md gap-3";
const emptySelectValue = "__channel_settings_empty__";

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
    tts_provider: "edge_tts",
    fallback_to_web_speech: "true",
    spoken_template: "{title}. {message}",
    model_id: "hexgrad/kokoro-82m",
    voice: "af_bella",
    edge_voice: "en-US-EmmaMultilingualNeural",
    edge_rate: "0",
    edge_pitch: "0",
    edge_volume: "0",
    web_speech_voice: "",
    web_speech_lang: "",
    web_speech_rate: "1",
    web_speech_pitch: "1",
    web_speech_volume: "1",
    speed: "1",
    response_format: "mp3",
    retention_days: "15",
    enabled_device_ids: ""
};

const ENGLISH_VOICE_HINT = "Free built-in desktop voice. Uses the local browser speech engine on the paired app.";
const EDGE_VOICE_HINT = "Free hosted voice. Ananta generates MP3 audio through Microsoft's Edge voice catalog so playback stays consistent across devices.";

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

function desktopStateFor(channel?: AlertChannel): ChannelState {
    const state = stateFor(channel, desktopDefaults);
    const config = { ...state.config };
    if (config.model_id === desktopDefaults.model_id && (!config.voice || config.voice === "alloy")) {
        config.voice = desktopDefaults.voice;
    }
    if (config.tts_provider === "edge_tts" && !config.edge_voice) {
        config.edge_voice = config.voice && config.voice !== desktopDefaults.voice ? config.voice : desktopDefaults.edge_voice;
    }
    return { ...state, config };
}

function toSelectValue(value: string): string {
    return value === "" ? emptySelectValue : value;
}

function fromSelectValue(value: string | null): string {
    return value === emptySelectValue ? "" : value ?? "";
}

function SettingsSelect({
    ariaLabel,
    onValueChange,
    options,
    placeholder = "Select...",
    value
}: {
    ariaLabel: string;
    onValueChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    value: string;
}) {
    const selectedLabel = options.find((option) => option.value === value)?.label;

    return (
        <Select onValueChange={(next) => onValueChange(fromSelectValue(next))} value={toSelectValue(value)}>
            <SelectTrigger aria-label={ariaLabel} className={compactFieldClassName}>
                <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="max-w-[min(32rem,var(--available-width))]">
                {options.map((option) => (
                    <SelectItem
                        disabled={option.disabled}
                        key={`${toSelectValue(option.value)}-${option.label}`}
                        value={toSelectValue(option.value)}
                    >
                        <span className="block truncate">{option.label}</span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
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
    const [desktopAudio, setDesktopAudio] = useState(desktopStateFor(desktopInitial));
    const [devices, setDevices] = useState(initialDesktopAudioDevices);
    const [showRevokedDevices, setShowRevokedDevices] = useState(false);
    const [availableVoices, setAvailableVoices] = useState<DesktopAudioVoiceOption[]>([]);
    const [edgeVoices, setEdgeVoices] = useState<EdgeAudioVoiceOption[]>([]);
    const [voiceStatus, setVoiceStatus] = useState("");
    const [edgeVoiceStatus, setEdgeVoiceStatus] = useState("");
    const [pairingStatus, setPairingStatus] = useState("");
    const [message, setMessage] = useState("Ananta Market Stack channel test");
    const [error, setError] = useState("");
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        void loadLocalVoices();
        void loadEdgeVoices();
    }, []);

    async function loadLocalVoices() {
        try {
            const response = await fetch("http://127.0.0.1:17853/voices");
            if (!response.ok) return;
            const payload = (await response.json()) as { voices?: DesktopAudioVoiceOption[] };
            setAvailableVoices((payload.voices ?? []).filter((voice) => String(voice.lang || "").toLowerCase().startsWith("en")));
            if (payload.voices?.length) setVoiceStatus("");
        } catch {
            setVoiceStatus("Desktop app voice list is unavailable until the local helper is running.");
        }
    }

    async function loadEdgeVoices(forceRefresh = false) {
        const result = await getDesktopAudioEdgeVoicesSafe(forceRefresh);
        if (!result.ok) {
            setEdgeVoiceStatus(result.error);
            return;
        }
        const englishVoices = result.data.filter((voice) => voice.locale.toLowerCase().startsWith("en-"));
        setEdgeVoices(englishVoices);
        setEdgeVoiceStatus(englishVoices.length ? "" : "No English Edge voices are currently available.");
    }

    async function previewLocalVoice() {
        setError("");
        setVoiceStatus("Playing local voice preview...");
        try {
            const response = await fetch("http://127.0.0.1:17853/preview", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    text: message,
                    speech: {
                        voice_name: desktopAudio.config.web_speech_voice ?? "",
                        lang: desktopAudio.config.web_speech_lang ?? "",
                        rate: Number(desktopAudio.config.web_speech_rate ?? "1"),
                        pitch: Number(desktopAudio.config.web_speech_pitch ?? "1"),
                        volume: Number(desktopAudio.config.web_speech_volume ?? "1")
                    }
                })
            });
            if (!response.ok) throw new Error("Could not preview voice.");
            setVoiceStatus("Preview sent to the desktop app.");
        } catch (caught) {
            setVoiceStatus("");
            setError(caught instanceof Error ? caught.message : "Could not preview local voice.");
        }
    }

    function save(channelType: "discord" | "telegram" | "desktop_audio") {
        setError("");
        startTransition(async () => {
            try {
                const payload = channelType === "discord" ? discord : channelType === "telegram" ? telegram : desktopAudio;
                const saved = await saveAlertChannelSafe(channelType, payload);
                if (!saved.ok) {
                    setError(saved.error);
                    return;
                }
                if (channelType === "discord") {
                    setDiscord(stateFor(saved.data, { webhook_url: "" }));
                } else if (channelType === "telegram") {
                    setTelegram(stateFor(saved.data, { bot_token: "", chat_id: "" }));
                } else {
                    setDesktopAudio(desktopStateFor(saved.data));
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
                if (channelType === "desktop_audio") {
                    const savedBeforeTest = await saveAlertChannelSafe("desktop_audio", desktopAudio);
                    if (!savedBeforeTest.ok) {
                        setError(savedBeforeTest.error);
                        return;
                    }
                    setDesktopAudio(desktopStateFor(savedBeforeTest.data));
                }
                const saved = await testAlertChannelSafe(channelType, message);
                if (!saved.ok) {
                    setError(saved.error);
                    return;
                }
                if (channelType === "discord") {
                    setDiscord(stateFor(saved.data, { webhook_url: "" }));
                } else if (channelType === "telegram") {
                    setTelegram(stateFor(saved.data, { bot_token: "", chat_id: "" }));
                } else {
                    setDesktopAudio(desktopStateFor(saved.data));
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

    function connectDesktopApp() {
        setError("");
        setPairingStatus("Preparing pairing request...");
        startTransition(async () => {
            try {
                const pairing = await startDesktopAudioPairingSafe({
                    app_url: window.location.origin,
                    metadata: { source: "settings" }
                });
                if (!pairing.ok) {
                    setError(pairing.error);
                    setPairingStatus("");
                    return;
                }
                const payload = {
                    pairingId: pairing.data.pairing_id,
                    secret: pairing.data.secret,
                    stackUrl: window.location.origin
                };
                const localResponse = await fetch("http://127.0.0.1:17853/pair", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(payload)
                }).catch(() => null);
                const sentLocal = Boolean(localResponse?.ok);
                if (!sentLocal) {
                    window.location.href = `ananta-audio://pair?payload=${encodeURIComponent(JSON.stringify(payload))}`;
                    setPairingStatus("Opened the desktop app pairing link. Return here after the app confirms connection.");
                } else {
                    setPairingStatus("Pairing request sent to the local desktop app.");
                }
                window.setTimeout(async () => {
                    const status = await getDesktopAudioPairingSafe(pairing.data.pairing_id);
                    if (status.ok && status.data.status === "completed") {
                        setPairingStatus("Desktop app connected.");
                        const devicesResult = await getDesktopAudioDevicesSafe(showRevokedDevices);
                        if (devicesResult.ok) setDevices(devicesResult.data);
                        void loadLocalVoices();
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
                const revoked = await revokeDesktopAudioDeviceSafe(deviceId);
                if (!revoked.ok) {
                    setError(revoked.error);
                    return;
                }
                const devicesResult = await getDesktopAudioDevicesSafe(showRevokedDevices);
                if (!devicesResult.ok) {
                    setError(devicesResult.error);
                    return;
                }
                setDevices(devicesResult.data);
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not revoke desktop device.");
            }
        });
    }

    function toggleRevokedDevices(next: boolean) {
        setShowRevokedDevices(next);
        startTransition(async () => {
            const devicesResult = await getDesktopAudioDevicesSafe(next);
            if (devicesResult.ok) {
                setDevices(devicesResult.data);
                return;
            }
            setError(devicesResult.error);
        });
    }

    return (
        <div className="grid gap-5">
            {error ? (
                <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">
                    {error}
                </div>
            ) : null}
            <CardFrame>
                <CardFrameHeader>
                    <CardFrameTitle>Shared test message</CardFrameTitle>
                    <CardFrameDescription>Use one message to test each alert delivery path.</CardFrameDescription>
                </CardFrameHeader>
                <Card>
                    <CardPanel className="grid max-w-md gap-2">
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
                    </CardPanel>
                </Card>
            </CardFrame>
            <DesktopAudioCard
                channel={desktopAudio}
                devices={devices}
                isPending={isPending}
                onChange={setDesktopAudio}
                onConnect={connectDesktopApp}
                onRevoke={revokeDevice}
                onSave={() => save("desktop_audio")}
                onTest={() => test("desktop_audio")}
                onPreviewVoice={previewLocalVoice}
                onRefreshVoices={() => {
                    void loadLocalVoices();
                }}
                onRefreshEdgeVoices={() => {
                    void loadEdgeVoices(true);
                }}
                pairingStatus={pairingStatus}
                voiceStatus={voiceStatus}
                edgeVoiceStatus={edgeVoiceStatus}
                availableVoices={availableVoices}
                edgeVoices={edgeVoices}
                showRevokedDevices={showRevokedDevices}
                onShowRevokedChange={toggleRevokedDevices}
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
    onPreviewVoice,
    onRefreshVoices,
    onRefreshEdgeVoices,
    onShowRevokedChange,
    pairingStatus,
    voiceStatus,
    edgeVoiceStatus,
    availableVoices,
    edgeVoices,
    showRevokedDevices
}: {
    channel: ChannelState;
    devices: DesktopAudioDevice[];
    isPending: boolean;
    onChange: (value: ChannelState) => void;
    onConnect: () => void;
    onRevoke: (deviceId: string) => void;
    onSave: () => void;
    onTest: () => void;
    onPreviewVoice: () => void;
    onRefreshVoices: () => void;
    onRefreshEdgeVoices: () => void;
    onShowRevokedChange: (checked: boolean) => void;
    pairingStatus: string;
    voiceStatus: string;
    edgeVoiceStatus: string;
    availableVoices: DesktopAudioVoiceOption[];
    edgeVoices: EdgeAudioVoiceOption[];
    showRevokedDevices: boolean;
}) {
    const activeDevices = devices.filter((device) => device.status === "active");
    const ttsProviderOptions: SelectOption[] = [
        { label: "Edge voice - free", value: "edge_tts" },
        { label: "Desktop app voice - free local", value: "web_speech" },
        { label: "OpenRouter audio - paid", value: "openrouter" }
    ];
    const edgeVoiceOptions: SelectOption[] = edgeVoices.length
        ? edgeVoices.map((voice) => ({
              label: `${voice.friendly_name} (${voice.gender}, ${voice.locale})`,
              value: voice.short_name
          }))
        : [{ label: "Loading Edge voices...", value: desktopDefaults.edge_voice }];
    const desktopVoiceOptions: SelectOption[] = [
        { label: "System default voice - free", value: "" },
        ...availableVoices.map((voice) => ({
            label: `${voice.name} (${voice.lang})${voice.default ? " default" : ""}`,
            value: voice.name
        }))
    ];

    return (
        <CardFrame>
            <CardFrameHeader>
                <CardFrameTitle className="flex items-center gap-3">
                        <MonitorSpeakerIcon className="size-5 text-primary" />
                        Desktop Audio
                </CardFrameTitle>
                <CardFrameDescription className="max-w-2xl leading-5">
                        Pair the tray app once, then Ananta sends spoken alerts to all active devices. Edge voice is
                        the default free hosted path, desktop voice stays available as a local fallback, and OpenRouter
                        remains optional when you want a different paid model.
                </CardFrameDescription>
                <CardFrameAction>
                <Button className="h-9 gap-2 px-4" disabled={isPending} onClick={onConnect} type="button">
                    <PlugZapIcon className="size-4" />
                    Connect app
                </Button>
                </CardFrameAction>
            </CardFrameHeader>
            <Card>
                <CardPanel>
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
                <LabeledField label="TTS provider" required>
                    <SettingsSelect
                        ariaLabel="TTS provider"
                        onValueChange={(value) => onChange({ ...channel, config: { ...channel.config, tts_provider: value } })}
                        options={ttsProviderOptions}
                        value={channel.config.tts_provider ?? desktopDefaults.tts_provider}
                    />
                </LabeledField>
                <LabeledField label="Spoken template" required>
                    <Input
                        className={compactFieldClassName}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, spoken_template: event.target.value } })
                        }
                        value={channel.config.spoken_template ?? desktopDefaults.spoken_template}
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
                <LabeledField label="Edge voice" required={false}>
                    <SettingsSelect
                        ariaLabel="Edge voice"
                        onValueChange={(value) => onChange({ ...channel, config: { ...channel.config, edge_voice: value } })}
                        options={edgeVoiceOptions}
                        value={channel.config.edge_voice ?? desktopDefaults.edge_voice}
                    />
                    <span className="mt-1 block max-w-md text-xs text-muted-foreground">{EDGE_VOICE_HINT}</span>
                </LabeledField>
                <LabeledField label="Edge speech rate" required={false}>
                    <Input
                        className={compactFieldClassName}
                        max={100}
                        min={-100}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, edge_rate: event.target.value } })
                        }
                        type="number"
                        value={channel.config.edge_rate ?? desktopDefaults.edge_rate}
                    />
                </LabeledField>
                <LabeledField label="Edge speech pitch" required={false}>
                    <Input
                        className={compactFieldClassName}
                        max={100}
                        min={-100}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, edge_pitch: event.target.value } })
                        }
                        type="number"
                        value={channel.config.edge_pitch ?? desktopDefaults.edge_pitch}
                    />
                </LabeledField>
                <LabeledField label="Edge speech volume" required={false}>
                    <Input
                        className={compactFieldClassName}
                        max={100}
                        min={-100}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, edge_volume: event.target.value } })
                        }
                        type="number"
                        value={channel.config.edge_volume ?? desktopDefaults.edge_volume}
                    />
                </LabeledField>
                <LabeledField label="Desktop voice" required={false}>
                    <SettingsSelect
                        ariaLabel="Desktop voice"
                        onValueChange={(value) => {
                            const nextVoice = availableVoices.find((voice) => voice.name === value);
                            onChange({
                                ...channel,
                                config: {
                                    ...channel.config,
                                    web_speech_voice: value,
                                    web_speech_lang: nextVoice?.lang ?? channel.config.web_speech_lang ?? ""
                                }
                            });
                        }}
                        options={desktopVoiceOptions}
                        value={channel.config.web_speech_voice ?? desktopDefaults.web_speech_voice}
                    />
                    <span className="mt-1 block max-w-md text-xs text-muted-foreground">{ENGLISH_VOICE_HINT}</span>
                </LabeledField>
                <LabeledField label="Desktop speech rate" required={false}>
                    <Input
                        className={compactFieldClassName}
                        min={0.5}
                        max={2}
                        step={0.1}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, web_speech_rate: event.target.value } })
                        }
                        type="number"
                        value={channel.config.web_speech_rate ?? desktopDefaults.web_speech_rate}
                    />
                </LabeledField>
                <LabeledField label="Desktop speech pitch" required={false}>
                    <Input
                        className={compactFieldClassName}
                        min={0}
                        max={2}
                        step={0.1}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, web_speech_pitch: event.target.value } })
                        }
                        type="number"
                        value={channel.config.web_speech_pitch ?? desktopDefaults.web_speech_pitch}
                    />
                </LabeledField>
                <LabeledField label="Desktop speech volume" required={false}>
                    <Input
                        className={compactFieldClassName}
                        min={0}
                        max={1}
                        step={0.1}
                        onChange={(event) =>
                            onChange({ ...channel, config: { ...channel.config, web_speech_volume: event.target.value } })
                        }
                        type="number"
                        value={channel.config.web_speech_volume ?? desktopDefaults.web_speech_volume}
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
                <LabeledField label="OpenRouter voice" required={false}>
                    <Input
                        className={compactFieldClassName}
                        onChange={(event) => onChange({ ...channel, config: { ...channel.config, voice: event.target.value } })}
                        value={channel.config.voice ?? desktopDefaults.voice}
                    />
                </LabeledField>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <Label className="flex items-center gap-2">
                    <Checkbox
                        checked={(channel.config.fallback_to_web_speech ?? desktopDefaults.fallback_to_web_speech) !== "false"}
                        onCheckedChange={(checked) =>
                            onChange({
                                ...channel,
                                config: { ...channel.config, fallback_to_web_speech: checked ? "true" : "false" }
                            })
                        }
                    />
                    Fallback to desktop voice when OpenRouter audio fails
                </Label>
                {voiceStatus ? <span className="text-xs text-muted-foreground">{voiceStatus}</span> : null}
                {edgeVoiceStatus ? <span className="text-xs text-muted-foreground">{edgeVoiceStatus}</span> : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
                <Button className="h-9 px-4" onClick={onSave} type="button">
                    Save
                </Button>
                <Button className="h-9 px-4" onClick={onPreviewVoice} type="button" variant="outline">
                    Preview desktop voice
                </Button>
                <Button
                    className="h-9 px-4"
                    onClick={onRefreshVoices}
                    type="button"
                    variant="ghost"
                >
                    Refresh desktop voices
                </Button>
                <Button className="h-9 px-4" onClick={onRefreshEdgeVoices} type="button" variant="ghost">
                    Refresh Edge voices
                </Button>
                <Button className="h-9 px-4" disabled={!activeDevices.length} onClick={onTest} type="button" variant="outline">
                    Test selected provider
                </Button>
            </div>
            <div className="mt-5 grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-bold">Paired devices</div>
                    <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox checked={showRevokedDevices} onCheckedChange={(checked) => onShowRevokedChange(Boolean(checked))} />
                        Show revoked
                    </Label>
                </div>
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
                        {showRevokedDevices ? "No desktop audio devices are paired yet." : "No active desktop audio app is paired yet."}
                    </div>
                )}
            </div>
                </CardPanel>
            </Card>
        </CardFrame>
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
        <CardFrame>
            <CardFrameHeader>
                <CardFrameTitle className="flex items-center gap-3">
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
                </CardFrameTitle>
                <CardFrameAction>
                    <SetupGuide guide={guide} />
                </CardFrameAction>
            </CardFrameHeader>
            <Card>
                <CardPanel>
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
                </CardPanel>
            </Card>
        </CardFrame>
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
