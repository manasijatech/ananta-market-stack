"use client";

import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { ToolCardShell } from "@/components/adaptive-workspace/tool-card-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    asToolEnvelope,
    isRecord,
    stringFrom,
    toolEnvelopeMessage,
    toolEnvelopeOk
} from "@/lib/adaptive-workspace/tool-envelope";

function watchlistRows(envelope: Record<string, unknown> | null) {
    if (!envelope) return [];
    if (Array.isArray(envelope.symbols)) {
        return envelope.symbols.filter(isRecord).map((row, index) => ({
            extra: stringFrom(row, ["company_name", "exchange", "industry"], ""),
            id: `${stringFrom(row, ["symbol"], "sym")}-${index}`,
            name: stringFrom(row, ["company_name", "name"], ""),
            symbol: stringFrom(row, ["symbol", "tradingsymbol"], `Symbol ${index + 1}`)
        }));
    }
    const lists = Array.isArray(envelope.watchlists) ? envelope.watchlists.filter(isRecord) : [];
    return lists.map((row, index) => ({
        extra: stringFrom(row, ["kind"], ""),
        id: stringFrom(row, ["watchlist_id", "id"], `watchlist-${index}`),
        name: stringFrom(row, ["name"], "Watchlist"),
        symbol: `${row.symbol_count ?? "—"} symbols`
    }));
}

export function WatchlistCard({ input, name, output, status }: CustomToolRendererProps) {
    const pending = status === "pending" || status === "streaming";
    const envelope = pending ? null : asToolEnvelope(output);
    const ok = toolEnvelopeOk(envelope);
    const rows = ok ? watchlistRows(envelope) : [];
    const watchlistMeta = isRecord(envelope) && isRecord(envelope.watchlist) ? envelope.watchlist : {};
    const title =
        name === "broker_get_watchlist_symbols"
            ? stringFrom(watchlistMeta, ["name"], "Watchlist")
            : "Watchlists";

    return (
        <ToolCardShell
            error={pending || ok ? null : toolEnvelopeMessage(envelope)}
            pending={pending}
            pendingLabel="Loading watchlist"
            title={title}
        >
            {rows.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{name === "broker_get_watchlist_symbols" ? "Symbol" : "List"}</TableHead>
                            <TableHead>{name === "broker_get_watchlist_symbols" ? "Name" : "Symbols"}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell className="font-semibold">{row.symbol}</TableCell>
                                <TableCell className="text-muted-foreground">
                                    {row.name || row.extra || "—"}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <p className="text-sm text-muted-foreground">No watchlist rows in this response.</p>
            )}
        </ToolCardShell>
    );
}
