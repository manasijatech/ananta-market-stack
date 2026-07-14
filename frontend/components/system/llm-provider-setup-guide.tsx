"use client";

import { CircleHelpIcon } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/service/types/broker";

const providerLabels: Record<LlmProvider, string> = {
    openai: "OpenAI",
    openrouter: "OpenRouter",
    gemini: "Gemini",
    anthropic: "Anthropic"
};

export const PROVIDER_SETUP_GUIDES: Record<
    LlmProvider,
    {
        summary: string;
        steps: Array<{
            before: string;
            label?: string;
            href?: string;
            after?: string;
        }>;
        modelExamples: string[];
        notes: string[];
    }
> = {
    openai: {
        summary: "Use an OpenAI project API key and save one or more OpenAI model IDs.",
        steps: [
            {
                before: "Open ",
                label: "OpenAI API keys",
                href: "https://platform.openai.com/api-keys",
                after: " and create a project API key."
            },
            {
                before: "Copy the full key once from the key creation screen. OpenAI will not show it again later."
            },
            { before: "Paste the key in the OpenAI API key field and click Save key." },
            {
                before: "Choose a model from the ",
                label: "OpenAI model catalog",
                href: "https://developers.openai.com/api/docs/models",
                after: ", paste the model ID, then click Add model."
            }
        ],
        modelExamples: ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4", "gpt-5.5"],
        notes: [
            "Cheapest option: use gpt-5.4-nano for simple, high-volume alert analysis.",
            "Use gpt-5.4-mini when you want a stronger low-cost default.",
            "Use gpt-5.5 only when you need stronger reasoning and accept higher cost.",
            "Do not paste an organization ID, project ID, or environment variable name here."
        ]
    },
    openrouter: {
        summary: "Use one OpenRouter key to access many providers through OpenRouter model IDs.",
        steps: [
            {
                before: "Open ",
                label: "OpenRouter API keys",
                href: "https://openrouter.ai/settings/keys",
                after: " and create a new key."
            },
            {
                before: "Check ",
                label: "OpenRouter credits",
                href: "https://openrouter.ai/settings/credits",
                after: " so the selected model can run."
            },
            { before: "Paste the key in the OpenRouter API key field and click Save key." },
            {
                before: "Pick the exact provider/model slug from ",
                label: "OpenRouter models",
                href: "https://openrouter.ai/models",
                after: ", paste it as the model ID, then click Add model."
            }
        ],
        modelExamples: ["openai/gpt-5.4-nano", "google/gemini-3.5-flash", "openrouter/free"],
        notes: [
            "OpenRouter model IDs normally look like provider/model-name.",
            "If a model fails, check credits, model availability, and whether the model needs a paid account.",
            "OpenRouter is useful when you want to switch model providers without changing Ananta Market Stack code."
        ]
    },
    gemini: {
        summary: "Use a Gemini API key from Google AI Studio with Gemini's OpenAI-compatible endpoint.",
        steps: [
            {
                before: "Open ",
                label: "Google AI Studio API keys",
                href: "https://aistudio.google.com/app/apikey",
                after: " and create a Gemini API key."
            },
            { before: "Copy the API key from AI Studio." },
            { before: "Paste the key in the Gemini API key field and click Save key." },
            {
                before: "Use a Gemini model ID from the ",
                label: "Gemini OpenAI-compatible model guide",
                href: "https://ai.google.dev/gemini-api/docs/openai",
                after: ", paste it, then click Add model."
            }
        ],
        modelExamples: ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-2.5-flash"],
        notes: [
            "Gemini is a good choice for fast, lower-cost analysis.",
            "Use Flash models first for alerts unless you specifically need a larger Pro model.",
            "The key should be a Gemini API key, not a Google Cloud service-account JSON file."
        ]
    },
    anthropic: {
        summary: "Use an Anthropic API key with Claude's OpenAI SDK compatibility endpoint.",
        steps: [
            {
                before: "Open ",
                label: "Anthropic Console API keys",
                href: "https://console.anthropic.com/settings/keys",
                after: " and create a Claude API key."
            },
            { before: "Copy the key from the console." },
            { before: "Paste the key in the Anthropic API key field and click Save key." },
            {
                before: "Use a Claude model ID from the ",
                label: "Claude OpenAI SDK compatibility guide",
                href: "https://platform.claude.com/docs/en/api/openai-sdk",
                after: ", paste it, then click Add model."
            }
        ],
        modelExamples: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
        notes: [
            "Ananta Market Stack uses Anthropic through Claude's OpenAI-compatible Chat Completions endpoint.",
            "Prompt caching, citations, PDF processing, and full extended-thinking features need Anthropic's native API.",
            "For broker chat, Claude runs through the Agents SDK Chat Completions model path."
        ]
    }
};

export function LlmProviderSetupGuideDialog({
    label,
    provider,
    triggerClassName,
    triggerLabel,
    triggerVariant = "icon"
}: {
    label?: string;
    provider: LlmProvider;
    triggerClassName?: string;
    triggerLabel?: string;
    triggerVariant?: "icon" | "link";
}) {
    const guide = PROVIDER_SETUP_GUIDES[provider];
    const title = label ?? providerLabels[provider];

    return (
        <Dialog>
            {triggerVariant === "link" ? (
                <DialogTrigger
                    className={cn(
                        "inline-flex h-auto w-fit items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        triggerClassName
                    )}
                >
                    <CircleHelpIcon className="size-4 shrink-0" />
                    {triggerLabel ?? `${title} setup guide`}
                </DialogTrigger>
            ) : (
                <DialogTrigger
                    aria-label={`${title} setup guide`}
                    className={cn(
                        "inline-grid size-6 shrink-0 place-items-center rounded-md border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-transparent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        triggerClassName
                    )}
                >
                    <CircleHelpIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
                </DialogTrigger>
            )}
            <DialogContent className="max-w-2xl p-0">
                <DialogHeader className="border-b border-border px-5 py-4 pr-14">
                    <DialogTitle>{title} setup</DialogTitle>
                    <DialogDescription>{guide.summary}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-5 px-5 py-4 text-sm leading-6">
                    <div>
                        <div className="text-xs font-bold uppercase text-muted-foreground">Steps</div>
                        <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
                            {guide.steps.map((step) => (
                                <li key={`${step.before}-${step.label ?? ""}`}>
                                    {step.before}
                                    {step.href && step.label ? (
                                        <a
                                            className="font-medium text-primary underline-offset-4 hover:underline"
                                            href={step.href}
                                            rel="noreferrer"
                                            target="_blank"
                                        >
                                            {step.label}
                                        </a>
                                    ) : null}
                                    {step.after}
                                </li>
                            ))}
                        </ol>
                    </div>
                    <div>
                        <div className="text-xs font-bold uppercase text-muted-foreground">Model IDs to try</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {guide.modelExamples.map((modelId) => (
                                <code className="border border-border bg-muted px-2 py-1 text-xs text-foreground" key={modelId}>
                                    {modelId}
                                </code>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs font-bold uppercase text-muted-foreground">Notes</div>
                        <ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">
                            {guide.notes.map((note) => (
                                <li key={note}>{note}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
