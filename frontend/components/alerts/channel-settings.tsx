"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { CircleHelpIcon } from "lucide-react";
import { saveAlertChannel, sendTestAlert, testAlertChannel } from "@/service/actions/alerts";
import type { AlertChannel } from "@/service/types/alerts";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogPanel,
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

const CHANNEL_GUIDES: Record<"discord" | "telegram", ChannelGuide> = {
    discord: {
        title: "Discord setup guide",
        summary: "Ananta sends alerts to Discord by posting to one incoming webhook URL.",
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
            "Ananta sends alerts through the Telegram Bot API using your bot token and a destination chat id.",
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

const DISCORD_FIELDS: ChannelField[] = [
    { key: "webhook_url", label: "Webhook URL", placeholder: "Paste webhook URL", required: true }
];

const TELEGRAM_FIELDS: ChannelField[] = [
    { key: "bot_token", label: "Bot token", placeholder: "Paste bot token", required: true },
    { key: "chat_id", label: "Chat ID", placeholder: "Paste destination chat id", required: true }
];

const BRAND_ICONS: Record<string, { src: string; className: string }> = {
    Discord: { src: "/brand/providers/discord.svg", className: "h-5 w-5" },
    Telegram: { src: "/brand/providers/telegram.svg", className: "h-6 w-6" }
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

function isConfigured(channel: ChannelState, fields: ChannelField[]): boolean {
    return fields.every((field) => !field.required || (channel.config[field.key] ?? "").trim().length > 0);
}

export function ChannelSettings({ initialChannels }: { initialChannels: AlertChannel[] }) {
    const discordInitial = initialChannels.find((item) => item.channel_type === "discord");
    const telegramInitial = initialChannels.find((item) => item.channel_type === "telegram");
    const [discord, setDiscord] = useState(stateFor(discordInitial, { webhook_url: "" }));
    const [telegram, setTelegram] = useState(stateFor(telegramInitial, { bot_token: "", chat_id: "" }));
    const [message, setMessage] = useState("Ananta channel test");
    const [error, setError] = useState("");
    const [isPending, startTransition] = useTransition();

    const [openChannels, setOpenChannels] = useState<string[]>(() => {
        if (!discord.is_enabled || !isConfigured(discord, DISCORD_FIELDS)) {
            return ["discord"];
        }
        if (!telegram.is_enabled || !isConfigured(telegram, TELEGRAM_FIELDS)) {
            return ["telegram"];
        }
        return [];
    });

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
        <div className="grid gap-4">
            {error ? (
                <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">
                    {error}
                </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
                <Label className="grid flex-1 gap-1.5 text-sm font-medium">
                    Shared test message
                    <Input
                        className="h-9 w-full text-sm"
                        onChange={(event) => setMessage(event.target.value)}
                        value={message}
                    />
                </Label>
                <Button
                    className="h-9 shrink-0 px-4"
                    disabled={isPending}
                    onClick={sendInAppTest}
                    type="button"
                    variant="outline"
                >
                    Test in-app alert
                </Button>
            </div>
            <Accordion
                className="overflow-hidden rounded-lg border border-border"
                multiple={false}
                onValueChange={(value) => setOpenChannels(value as string[])}
                value={openChannels}
            >
                <ChannelItem
                    channel={discord}
                    fields={DISCORD_FIELDS}
                    guide={CHANNEL_GUIDES.discord}
                    onChange={setDiscord}
                    onSave={() => save("discord")}
                    onTest={() => test("discord")}
                    title="Discord"
                    value="discord"
                />
                <ChannelItem
                    channel={telegram}
                    fields={TELEGRAM_FIELDS}
                    guide={CHANNEL_GUIDES.telegram}
                    onChange={setTelegram}
                    onSave={() => save("telegram")}
                    onTest={() => test("telegram")}
                    title="Telegram"
                    value="telegram"
                />
            </Accordion>
        </div>
    );
}

function ChannelItem({
    channel,
    fields,
    guide,
    onChange,
    onSave,
    onTest,
    title,
    value
}: {
    channel: ChannelState;
    fields: ChannelField[];
    guide: ChannelGuide;
    onChange: (value: ChannelState) => void;
    onSave: () => void;
    onTest: () => void;
    title: string;
    value: string;
}) {
    const brandIcon = BRAND_ICONS[title] ?? null;
    const configured = isConfigured(channel, fields);
    const needsSetup = channel.is_enabled && !configured;

    return (
        <AccordionItem className="@container px-4" value={value}>
            <AccordionTrigger className="items-center gap-3 py-3">
                {brandIcon ? (
                    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">
                        <img
                            alt=""
                            className={`${brandIcon.className} object-contain`}
                            draggable={false}
                            src={brandIcon.src}
                        />
                    </span>
                ) : null}
                <span className="min-w-0 flex-1 text-left font-heading text-sm font-semibold tracking-tight text-foreground">
                    {title}
                </span>
                {channel.is_default ? (
                    <span className="hidden text-xs text-muted-foreground @sm:inline">Default</span>
                ) : null}
                {needsSetup ? (
                    <Badge
                        className="border-[var(--warning)]/40 bg-[var(--warning)]/10 font-normal text-[var(--warning)]"
                        variant="outline"
                    >
                        Needs setup
                    </Badge>
                ) : null}
                <Badge
                    className={
                        channel.is_enabled
                            ? "border-[var(--success)] bg-[var(--success-subtle)] font-normal text-[var(--success)]"
                            : "font-normal text-muted-foreground"
                    }
                    variant="outline"
                >
                    {channel.is_enabled ? "Enabled" : "Disabled"}
                </Badge>
            </AccordionTrigger>
            <AccordionPanel className="grid gap-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
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
                    <SetupGuide guide={guide} />
                </div>
                <div className="grid gap-4 @lg:grid-cols-2">
                    <LabeledField label="Label" required={false}>
                        <Input
                            className="h-9 w-full text-sm"
                            onChange={(event) => onChange({ ...channel, label: event.target.value })}
                            placeholder="Optional label"
                            value={channel.label}
                        />
                    </LabeledField>
                    {fields.map((field) => (
                        <LabeledField key={field.key} label={field.label} required={Boolean(field.required)}>
                            <Input
                                autoComplete="off"
                                className="h-9 w-full text-sm"
                                data-1p-ignore="true"
                                data-form-type="other"
                                data-lpignore="true"
                                onChange={(event) =>
                                    onChange({
                                        ...channel,
                                        config: { ...channel.config, [field.key]: event.target.value }
                                    })
                                }
                                placeholder={field.placeholder ?? field.label}
                                value={channel.config[field.key] ?? ""}
                            />
                        </LabeledField>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button className="h-9 px-4" onClick={onSave} type="button">
                        Save
                    </Button>
                    <Button className="h-9 px-4" onClick={onTest} type="button" variant="outline">
                        Test
                    </Button>
                </div>
            </AccordionPanel>
        </AccordionItem>
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
                    className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-primary"
                    size="sm"
                    type="button"
                    variant="ghost"
                >
                    <CircleHelpIcon className="size-4" />
                    Setup guide
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{guide.title}</DialogTitle>
                    <DialogDescription>{guide.summary}</DialogDescription>
                </DialogHeader>
                <DialogPanel>
                    <div className="grid gap-6 text-sm">
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
                </DialogPanel>
            </DialogContent>
        </Dialog>
    );
}
