"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
    AlphaEarningsTableExtraction,
    AlphaEarningsTablePayload,
    AlphaEarningsTableMetric,
    AlphaEarningsTableSection
} from "@/service/types/alpha/announcements";
import { cn } from "@/lib/utils";

const METRIC_ROWS: ReadonlyArray<{
    key: keyof Pick<
        AlphaEarningsTableSection,
        "revenue" | "operating_profit" | "ebitda_margin" | "pat" | "eps" | "pbt" | "npas" | "provisions"
    >;
    label: string;
}> = [
    { key: "revenue", label: "Revenue" },
    { key: "operating_profit", label: "Operating profit" },
    { key: "ebitda_margin", label: "EBITDA margin" },
    { key: "pat", label: "PAT" },
    { key: "eps", label: "EPS" },
    { key: "pbt", label: "PBT" },
    { key: "npas", label: "NPAs" },
    { key: "provisions", label: "Provisions" }
];

function formatValue(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return "—";
    return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatPercent(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return "—";
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function percentClass(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value) || value === 0) {
        return "text-muted-foreground";
    }
    return value > 0 ? "text-success-foreground" : "text-destructive-foreground";
}

function metricLabel(label: string, metric: AlphaEarningsTableMetric): string {
    const unit = metric.unit?.trim();
    return unit ? `${label} (${unit})` : label;
}

function PercentCell({ value }: { value: number | null | undefined }) {
    return (
        <TableCell className={cn("text-right font-medium tabular-nums", percentClass(value))}>
            {formatPercent(value)}
        </TableCell>
    );
}

function EarningsSectionTable({ section }: { section: AlphaEarningsTableSection }) {
    const rows = METRIC_ROWS.filter(({ key }) => section[key] != null);
    if (!rows.length) {
        return <p className="text-sm text-muted-foreground">No structured metrics in this section.</p>;
    }

    const showFullYear = rows.some(({ key }) => {
        const metric = section[key];
        return (
            metric?.current_year_value != null ||
            metric?.previous_year_full_value != null ||
            metric?.year_yoy_percent != null
        );
    });
    const showCumulative = rows.some(({ key }) => {
        const metric = section[key];
        return (
            metric?.current_cumulative_value != null ||
            metric?.previous_year_cumulative_value != null ||
            metric?.cumulative_yoy_percent != null
        );
    });

    return (
        <div className="max-w-full rounded-lg border border-border/60">
            <Table className="w-max min-w-full table-auto">
                <TableHeader>
                    <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead className="text-right">{section.current_period_label ?? "Current"}</TableHead>
                        <TableHead className="text-right">{section.previous_quarter_label ?? "Prev Q"}</TableHead>
                        <TableHead className="text-right">{section.previous_year_label ?? "Prev Y"}</TableHead>
                        <TableHead className="text-right">QoQ</TableHead>
                        <TableHead className="text-right">YoY</TableHead>
                        {showFullYear ? (
                            <>
                                <TableHead className="text-right">
                                    {section.current_full_year_label ?? "Current FY/CY"}
                                </TableHead>
                                <TableHead className="text-right">
                                    {section.previous_full_year_label ?? "Prev FY/CY"}
                                </TableHead>
                                <TableHead className="text-right">FY/CY YoY</TableHead>
                            </>
                        ) : null}
                        {showCumulative ? (
                            <>
                                <TableHead className="text-right">
                                    {section.current_cumulative_period_label ?? "Current Cumulative"}
                                </TableHead>
                                <TableHead className="text-right">
                                    {section.previous_year_cumulative_period_label ?? "Prev Cumulative"}
                                </TableHead>
                                <TableHead className="text-right">Cumulative YoY</TableHead>
                            </>
                        ) : null}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map(({ key, label }) => {
                        const metric = section[key];
                        if (!metric) return null;
                        return (
                            <TableRow key={key}>
                                <TableCell className="font-medium text-foreground">
                                    {metricLabel(label, metric)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatValue(metric.current_period_value)}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground tabular-nums">
                                    {formatValue(metric.previous_quarter_value)}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground tabular-nums">
                                    {formatValue(metric.previous_year_value)}
                                </TableCell>
                                <PercentCell value={metric.qoq_percent} />
                                <PercentCell value={metric.yoy_percent} />
                                {showFullYear ? (
                                    <>
                                        <TableCell className="text-right tabular-nums">
                                            {formatValue(metric.current_year_value)}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground tabular-nums">
                                            {formatValue(metric.previous_year_full_value)}
                                        </TableCell>
                                        <PercentCell value={metric.year_yoy_percent} />
                                    </>
                                ) : null}
                                {showCumulative ? (
                                    <>
                                        <TableCell className="text-right tabular-nums">
                                            {formatValue(metric.current_cumulative_value)}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground tabular-nums">
                                            {formatValue(metric.previous_year_cumulative_value)}
                                        </TableCell>
                                        <PercentCell value={metric.cumulative_yoy_percent} />
                                    </>
                                ) : null}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

function isExtractionPayload(extraction: AlphaEarningsTablePayload): extraction is AlphaEarningsTableExtraction {
    return "consolidated" in extraction || "standalone" in extraction;
}

function normalizeSections(extraction: AlphaEarningsTablePayload): Array<{
    id: string;
    title: string;
    section: AlphaEarningsTableSection;
}> {
    if (isExtractionPayload(extraction) && (extraction.consolidated || extraction.standalone)) {
        return [
            ...(extraction.consolidated
                ? [{ id: "consolidated", title: "Consolidated", section: extraction.consolidated }]
                : []),
            ...(extraction.standalone
                ? [{ id: "standalone", title: "Standalone", section: extraction.standalone }]
                : [])
        ];
    }

    return [{ id: "results", title: "Results", section: extraction as AlphaEarningsTableSection }];
}

export function EarningsExtractedTable({ extraction }: { extraction: AlphaEarningsTablePayload | null | undefined }) {
    if (!extraction) return null;

    const sections = normalizeSections(extraction);
    const firstSection = sections[0];
    if (!firstSection) return null;

    if (sections.length === 1) {
        return <EarningsSectionTable section={firstSection.section} />;
    }

    return (
        <Tabs className="min-w-0" defaultValue={firstSection.id}>
            <TabsList>
                {sections.map((entry) => (
                    <TabsTrigger key={entry.id} value={entry.id}>
                        {entry.title}
                    </TabsTrigger>
                ))}
            </TabsList>
            {sections.map((entry) => (
                <TabsContent key={entry.id} className="mt-1" value={entry.id}>
                    <EarningsSectionTable section={entry.section} />
                </TabsContent>
            ))}
        </Tabs>
    );
}
