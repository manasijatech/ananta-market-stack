import { IconBrain } from "@tabler/icons-react";
import { StatusBadge } from "@/components/brokers/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { aggregateCostSource, costSourceLabel, formatDisplayLlmCost, requestKindDisplay } from "@/lib/llm-usage";
import type { WorkflowLlmUsageSummary } from "@/service/types/llm-usage";

const numberFormatter = new Intl.NumberFormat("en-IN");

function formatNumber(value: number): string {
    return numberFormatter.format(value || 0);
}

export function WorkflowLlmUsagePanel({ summary }: { summary: WorkflowLlmUsageSummary }) {
    const maxTokens = Math.max(...summary.daily.map((bucket) => bucket.total_tokens), 0);

    return (
        <section className="border border-border p-4">
            <div className="mb-4 flex flex-col justify-between gap-3 min-[760px]:flex-row min-[760px]:items-start">
                <div>
                    <div className="flex items-center gap-2">
                        <IconBrain className="size-5 text-primary" stroke={1.8} />
                        <div className="type-section-title">Workflow LLM usage</div>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Lifetime usage from the LLM ledger for this workflow.
                    </p>
                </div>
                <StatusBadge>{formatNumber(summary.totals.request_count)} requests</StatusBadge>
            </div>

            <div className="grid gap-3 min-[760px]:grid-cols-4">
                <div className="border border-border p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Tokens
                    </p>
                    <div className="mt-2 text-2xl font-semibold leading-none">{formatNumber(summary.totals.total_tokens)}</div>
                </div>
                <div className="border border-border p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Success
                    </p>
                    <div className="mt-2 text-2xl font-semibold leading-none">{formatNumber(summary.totals.success_count)}</div>
                </div>
                <div className="border border-border p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Errors
                    </p>
                    <div className="mt-2 text-2xl font-semibold leading-none">{formatNumber(summary.totals.error_count)}</div>
                </div>
                <div className="border border-border p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Cost
                    </p>
                    <div className="mt-2 text-2xl font-semibold leading-none">
                        {formatDisplayLlmCost(summary.totals.display_cost_total_usd, summary.totals.display_cost_request_count)}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{costSourceLabel(aggregateCostSource(summary.totals))}</p>
                </div>
            </div>

            {summary.daily.length ? (
                <div className="mt-4 flex h-28 items-end gap-1 overflow-x-auto border border-border p-3">
                    {summary.daily.slice(-45).map((bucket) => {
                        const height = maxTokens ? Math.max((bucket.total_tokens / maxTokens) * 100, 5) : 0;
                        return (
                            <div className="flex min-w-4 flex-1 items-end" key={bucket.bucket_key}>
                                <div
                                    className="w-full bg-primary/80"
                                    title={`${bucket.bucket_label}: ${formatNumber(bucket.total_tokens)} tokens`}
                                    style={{ height: `${height}%` }}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="mt-4 border border-border p-3 text-sm text-muted-foreground">
                    No tracked LLM calls for this workflow yet.
                </p>
            )}

            <Table className="mt-4">
                <TableHeader>
                    <TableRow>
                        <TableHead>Request kind</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {summary.request_kinds.map((row) => (
                        <TableRow key={row.request_kind ?? "unknown"}>
                            <TableCell className="font-semibold">
                                <div>{requestKindDisplay(row.request_kind, row.request_kind_label)}</div>
                                {row.request_kind ? <div className="mt-1 text-xs text-muted-foreground">{row.request_kind}</div> : null}
                            </TableCell>
                            <TableCell className="text-right">{formatNumber(row.request_count)}</TableCell>
                            <TableCell className="text-right">{formatNumber(row.total_tokens)}</TableCell>
                            <TableCell className="text-right">
                                <div>{formatDisplayLlmCost(row.display_cost_total_usd, row.display_cost_request_count)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{costSourceLabel(aggregateCostSource(row))}</div>
                            </TableCell>
                        </TableRow>
                    ))}
                    {!summary.request_kinds.length ? (
                        <TableRow>
                            <TableCell className="text-muted-foreground" colSpan={4}>
                                No request-kind breakdown available.
                            </TableCell>
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
        </section>
    );
}
