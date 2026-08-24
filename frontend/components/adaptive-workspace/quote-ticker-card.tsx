"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { quoteMoveFromRecord } from "@/lib/adaptive-workspace/quote-fields";
import {
    asToolEnvelope,
    isRecord,
    provenanceFromEnvelope,
    stringFrom,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function quoteRows(envelope: Record<string, unknown> | null) {
    const rows = envelope && Array.isArray(envelope.rows) ? envelope.rows.filter(isRecord) : [];
    return rows.map((row, index) => {
        const move = quoteMoveFromRecord(row);
        return {
            change: move.change,
            changePercent: move.changePercent,
            id: `${stringFrom(row, ["symbol"], "quote")}-${index}`,
            ltp: move.ltp,
            symbol: stringFrom(row, ["symbol", "tradingsymbol", "trading_symbol"], `Instrument ${index + 1}`)
        };
    });
}

export function QuoteTickerCard({ input, name, output, status }: CustomToolRendererProps) {
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const rows = ok ? quoteRows(envelope) : [];
    const source = name === "broker_get_cached_quotes" ? "cached" : "live";

    return (
        <ToolCardShell
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
                                <TableCell className={row.change == null ? "text-right font-mono" : row.change >= 0 ? "text-right font-mono text-emerald-400" : "text-right font-mono text-red-400"}>
                                    {row.change == null ? "—" : `${row.change > 0 ? "+" : ""}${row.change.toFixed(2)}`}
                                </TableCell>
                                <TableCell className={row.changePercent == null ? "text-right font-mono" : row.changePercent >= 0 ? "text-right font-mono text-emerald-400" : "text-right font-mono text-red-400"}>
                                    {row.changePercent == null ? "—" : `${row.changePercent > 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`}
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
