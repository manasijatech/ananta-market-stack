"use client";

import { format, isSameDay, subDays, subMonths } from "date-fns";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { IconCalendar, IconChevronDown } from "@tabler/icons-react";
import { Calendar } from "@/components/ui/calendar";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function parseFilterDate(value?: string | null): Date | undefined {
    const clean = value?.trim();
    if (!clean) return undefined;
    const parsed = new Date(`${clean}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toFilterDateValue(date?: Date): string {
    if (!date) return "";
    return format(date, "yyyy-MM-dd");
}

type PeriodPreset = {
    label: string;
    getRange: () => DateRange;
};

const PERIOD_PRESETS: PeriodPreset[] = [
    {
        label: "Today",
        getRange: () => {
            const today = new Date();
            return { from: today, to: today };
        }
    },
    {
        label: "Last 7 days",
        getRange: () => {
            const today = new Date();
            return { from: subDays(today, 6), to: today };
        }
    },
    {
        label: "Last 30 days",
        getRange: () => {
            const today = new Date();
            return { from: subDays(today, 29), to: today };
        }
    },
    {
        label: "Last 3 months",
        getRange: () => {
            const today = new Date();
            return { from: subMonths(today, 3), to: today };
        }
    },
    {
        label: "Last 6 months",
        getRange: () => {
            const today = new Date();
            return { from: subMonths(today, 6), to: today };
        }
    },
    {
        label: "Last 12 months",
        getRange: () => {
            const today = new Date();
            return { from: subMonths(today, 12), to: today };
        }
    },
    {
        label: "All",
        getRange: () => ({ from: undefined, to: undefined })
    }
];

function sameRange(left: DateRange, right: DateRange): boolean {
    const fromMatches = left.from && right.from ? isSameDay(left.from, right.from) : !left.from && !right.from;
    const toMatches = left.to && right.to ? isSameDay(left.to, right.to) : !left.to && !right.to;
    return fromMatches && toMatches;
}

function formatRangeLabel(range: DateRange): string {
    if (!range.from && !range.to) return "Select period";
    if (range.from && range.to && isSameDay(range.from, range.to)) {
        return format(range.from, "MMM d, yyyy");
    }
    const from = range.from ? format(range.from, "MMM d") : "Start";
    const to = range.to ? format(range.to, "MMM d, yyyy") : "End";
    return `${from} - ${to}`;
}

function activePresetLabel(range: DateRange): string | undefined {
    return PERIOD_PRESETS.find((preset) => sameRange(preset.getRange(), range))?.label;
}

type LlmUsageDateRangeFilterProps = {
    dateFrom?: string | null;
    dateTo?: string | null;
};

export function LlmUsageDateRangeFilter({ dateFrom, dateTo }: LlmUsageDateRangeFilterProps) {
    const [open, setOpen] = useState(false);
    const [range, setRange] = useState<DateRange>({
        from: parseFilterDate(dateFrom),
        to: parseFilterDate(dateTo)
    });

    useEffect(() => {
        setRange({
            from: parseFilterDate(dateFrom),
            to: parseFilterDate(dateTo)
        });
    }, [dateFrom, dateTo]);

    const presetLabel = activePresetLabel(range);

    return (
        <>
            {range.from ? <input name="date_from" type="hidden" value={toFilterDateValue(range.from)} /> : null}
            {range.to ? <input name="date_to" type="hidden" value={toFilterDateValue(range.to)} /> : null}
            <Popover onOpenChange={setOpen} open={open}>
                <PopoverTrigger
                    className={cn(
                        buttonVariants({ variant: "outline" }),
                        "h-9 min-w-[16rem] justify-between bg-background px-3 font-normal"
                    )}
                    data-empty={!range.from && !range.to}
                    type="button"
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <IconCalendar aria-hidden data-icon="inline-start" />
                        <span className="truncate">{presetLabel || formatRangeLabel(range)}</span>
                    </span>
                    <IconChevronDown aria-hidden data-icon="inline-end" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(42rem,calc(100vw-2rem))] p-0">
                    <div className="grid md:grid-cols-[13rem_1fr]">
                        <div className="border-b p-3 md:border-e md:border-b-0">
                            <div className="flex flex-col gap-1">
                                {PERIOD_PRESETS.map((preset) => {
                                    const nextRange = preset.getRange();
                                    const selected = sameRange(nextRange, range);
                                    return (
                                        <Button
                                            className="justify-start"
                                            key={preset.label}
                                            onClick={() => setRange(nextRange)}
                                            size="sm"
                                            type="button"
                                            variant={selected ? "secondary" : "ghost"}
                                        >
                                            {preset.label}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="min-w-0">
                            <div className="p-3">
                                <Calendar
                                    defaultMonth={range.from || range.to}
                                    mode="range"
                                    onSelect={(next) => setRange(next || { from: undefined, to: undefined })}
                                    selected={range}
                                />
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                                <div className="min-w-0 text-sm text-muted-foreground">
                                    {formatRangeLabel(range)}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        onClick={() => setOpen(false)}
                                        size="sm"
                                        type="button"
                                        variant="outline"
                                    >
                                        Cancel
                                    </Button>
                                    <Button size="sm" type="submit">
                                        Apply
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </>
    );
}
