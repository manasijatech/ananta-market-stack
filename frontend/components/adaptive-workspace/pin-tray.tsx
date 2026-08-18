"use client";

import { adaptiveBrokerToolRenderers } from "@/components/adaptive-workspace/broker-tool-renderers";
import { useAdaptiveWorkspacePins } from "@/components/adaptive-workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardPanel } from "@/components/ui/card";
import { formatIstDateTime } from "@/lib/datetime";

export function AdaptiveWorkspacePinTray() {
    const { pins, unpin } = useAdaptiveWorkspacePins();

    return (
        <Card className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <CardHeader className="border-b border-border p-3">
                <p className="text-sm font-semibold">Pinned canvas</p>
                <p className="mt-1 text-xs text-muted-foreground">Session-local only. Persistence comes in Phase 2.</p>
            </CardHeader>
            <CardPanel className="min-h-0 overflow-y-auto p-3">
                {!pins.length ? (
                    <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                        Pin a quote, portfolio, chart, or health card from the transcript to keep it beside chat.
                    </p>
                ) : (
                    <div className="grid gap-3">
                        {pins.map((item) => {
                            const Renderer = adaptiveBrokerToolRenderers[item.toolName];
                            return (
                                <div className="rounded-lg border border-border" key={item.id}>
                                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                                        <div className="min-w-0">
                                            <p className="truncate text-xs font-semibold">{item.title}</p>
                                            <p className="text-[11px] text-muted-foreground">{formatIstDateTime(item.pinnedAt)}</p>
                                        </div>
                                        <Button onClick={() => unpin(item.id)} size="xs" type="button" variant="ghost">
                                            Remove
                                        </Button>
                                    </div>
                                    <div className="px-1">
                                        {Renderer ? (
                                            <Renderer input={item.input} name={item.toolName} output={item.output} status="success" />
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardPanel>
        </Card>
    );
}
