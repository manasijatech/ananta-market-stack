"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { PinButton, ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { useAdaptiveWorkspacePins } from "@/components/adaptive-workspace/workspace-provider";
import {
    asToolEnvelope,
    isRecord,
    numberFrom,
    provenanceFromEnvelope,
    stringFrom,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function quoteRows(envelope: Record<string, unknown> | null) {
    const rows = envelope && Array.isArray(envelope.rows) ? envelope.rows.filter(isRecord) : [];
    return rows.map((row, index) => {
        const detail = isRecord(row.detail) ? row.detail : {};
        const change = numberFrom(detail, ["netChange", "change", "day_change", "absoluteChange"]);
        const changePercent = numberFrom(detail, ["pChange", "percent_change", "day_change_percentage", "percentageChange"]);
        return {
            change,
            changePercent,
            id: `${stringFrom(row, ["symbol"], "quote")}-${index}`,
            ltp: numberFrom(row, ["ltp", "last_price", "lastPrice"]) ?? numberFrom(detail, ["ltp", "last_price", "lastPrice"]),
            symbol: stringFrom(row, ["symbol", "tradingsymbol", "trading_symbol"], `Instrument ${index + 1}`)
        };
    });
}

export function QuoteTickerCard({ input, name, output, status }: CustomToolRendererProps) {
    const { pin } = useAdaptiveWorkspacePins();
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const rows = ok ? quoteRows(envelope) : [];
    const source = name === "broker_get_cached_quotes" ? "cached" : "live";

    return (
        <ToolCardShell
            actions={
                <PinButton
                    disabled={pending || !ok}
                    onClick={() => pin({ input, output, toolName: name })}
                />
            }
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel="Fetching quotes"
            provenance={provenanceFromEnvelope(envelope, name, source)}
            title="Quotes"
        >
            {rows.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="text-right">LTP</TableHead>
                            <TableHead className="text-right">Change</TableHead>
                            <TableHead className="text-right">Change %</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell className="font-semibold">{row.symbol}</TableCell>
                                <TableCell className="text-right font-mono">{row.ltp ?? "—"}</TableCell>
                                <TableCell className="text-right font-mono">{row.change ?? "—"}</TableCell>
                                <TableCell className="text-right font-mono">
                                    {row.changePercent == null ? "—" : `${row.changePercent.toFixed(2)}%`}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <p className="text-sm text-muted-foreground">No quote rows in this response.</p>
            )}
        </ToolCardShell>
    );
}
