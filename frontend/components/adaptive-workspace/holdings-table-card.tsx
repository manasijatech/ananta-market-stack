"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { PinButton, ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { useAdaptiveWorkspacePins } from "@/components/adaptive-workspace/workspace-provider";
import { normalizeFunds, normalizeHoldings, normalizePositions } from "@/components/brokers/normalizers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    asToolEnvelope,
    isRecord,
    provenanceFromEnvelope,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";
import type { JsonObject } from "@/service/types/broker";

function money(value?: number | null) {
    if (value == null) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

export function HoldingsTableCard({ input, name, output, status }: CustomToolRendererProps) {
    const { pin } = useAdaptiveWorkspacePins();
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const data = envelope && ok && isRecord(envelope.data) ? (envelope.data as JsonObject) : {};
    const holdings = normalizeHoldings(data);
    const positions = normalizePositions(data);
    const funds = Object.keys(data).length ? normalizeFunds(data) : null;
    const rows = holdings.length
        ? holdings.map((row) => ({
              average_price: row.average_price,
              id: row.id,
              last_price: row.last_price,
              pnl: row.pnl,
              quantity: row.quantity,
              symbol: row.symbol
          }))
        : positions.map((row) => ({
              average_price: null,
              id: row.id,
              last_price: null,
              pnl: row.pnl,
              quantity: row.quantity,
              symbol: row.symbol
          }));

    return (
        <ToolCardShell
            actions={<PinButton disabled={pending || !ok} onClick={() => pin({ input, output, toolName: name })} />}
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel="Loading portfolio"
            provenance={provenanceFromEnvelope(envelope, name)}
            title="Portfolio"
        >
            {funds && (funds.available != null || funds.used != null || funds.total != null) ? (
                <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                        <p className="text-muted-foreground">Available</p>
                        <p className="font-mono font-semibold">{money(funds.available)}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Used</p>
                        <p className="font-mono font-semibold">{money(funds.used)}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Total</p>
                        <p className="font-mono font-semibold">{money(funds.total)}</p>
                    </div>
                </div>
            ) : null}
            {rows.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Avg</TableHead>
                            <TableHead className="text-right">LTP</TableHead>
                            <TableHead className="text-right">P&amp;L</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.slice(0, 12).map((row) => (
                            <TableRow key={row.id}>
                                <TableCell className="font-semibold">{row.symbol}</TableCell>
                                <TableCell className="text-right font-mono">{row.quantity}</TableCell>
                                <TableCell className="text-right font-mono">{money(row.average_price)}</TableCell>
                                <TableCell className="text-right font-mono">{money(row.last_price)}</TableCell>
                                <TableCell className="text-right font-mono">{money(row.pnl)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <p className="text-sm text-muted-foreground">No holdings or positions in this response.</p>
            )}
            {rows.length > 12 ? (
                <p className="mt-2 text-xs text-muted-foreground">Showing 12 of {rows.length} rows.</p>
            ) : null}
        </ToolCardShell>
    );
}
