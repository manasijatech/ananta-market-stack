"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { Badge } from "@/components/ui/badge";
import {
    asToolEnvelope,
    isRecord,
    stringFrom,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";

function feedItems(envelope: Record<string, unknown> | null) {
    const items = envelope && Array.isArray(envelope.items) ? envelope.items.filter(isRecord) : [];
    return items.map((item, index) => ({
        headline: stringFrom(item, ["headline", "specific_title", "title", "summary", "reason"], "Untitled item"),
        id: `${stringFrom(item, ["symbol"], "item")}-${index}`,
        published: stringFrom(item, ["published_at", "publishedAt"], ""),
        symbol: stringFrom(item, ["symbol"], "")
    }));
}

export function IntelFeedCard({ input, name, output, status }: CustomToolRendererProps) {
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const rows = ok ? feedItems(envelope) : [];
    const product = stringFrom(envelope ?? {}, ["product"], "intel");

    return (
        <ToolCardShell
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel="Loading market intelligence"
            title={product ? `${product} feed` : "Market intelligence"}
        >
            {rows.length ? (
                <ul className="grid gap-2">
                    {rows.map((row) => (
                        <li className="rounded-md border border-border/70 px-2.5 py-2" key={row.id}>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {row.symbol ? (
                                    <Badge size="sm" variant="outline">
                                        {row.symbol}
                                    </Badge>
                                ) : null}
                                {row.published ? <span className="text-[11px] text-muted-foreground">{row.published}</span> : null}
                            </div>
                            <p className="mt-1 text-sm leading-5">{row.headline}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground">
                    No cached {product || "intel"} items for these symbols yet.
                </p>
            )}
        </ToolCardShell>
    );
}
