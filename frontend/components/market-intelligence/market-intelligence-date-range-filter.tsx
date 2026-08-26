"use client";

import { format, subDays, subMonths, subYears } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type MarketIntelligenceDateRangeFilterProps = {
    value?: DateRange;
    onChange: (range: DateRange | undefined) => void;
    disabled?: boolean;
};

type Preset = {
    label: string;
    getRange: () => DateRange;
};

const PRESETS: Preset[] = [
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
        label: "Last 12 months",
        getRange: () => {
            const today = new Date();
            return { from: subYears(today, 1), to: today };
        }
    },
    {
        label: "Last 2 years",
        getRange: () => {
            const today = new Date();
            return { from: subYears(today, 2), to: today };
        }
    }
];

function formatDate(value: Date): string {
    return format(value, "MMM d, yyyy");
}

function rangeLabel(range?: DateRange): string {
    if (!range?.from || !range.to) return "Recent · 30 days";
    if (format(range.from, "yyyy-MM-dd") === format(range.to, "yyyy-MM-dd")) {
        return formatDate(range.from);
    }
    return `${formatDate(range.from)} – ${formatDate(range.to)}`;
}

function rangeSummary(range?: DateRange): string {
    if (!range?.from || !range.to) {
        return "Showing recent feed items. Choose a range to search older market intelligence.";
    }
    return `Showing market intelligence from ${formatDate(range.from)} to ${formatDate(range.to)}.`;
}

export function MarketIntelligenceDateRangeFilter({
    value,
    onChange,
    disabled = false
}: MarketIntelligenceDateRangeFilterProps) {
    const [open, setOpen] = useState(false);
    const [draftRange, setDraftRange] = useState<DateRange | undefined>(value);

    useEffect(() => {
        if (!open) setDraftRange(value);
    }, [open, value]);

    function handleOpenChange(nextOpen: boolean) {
        setOpen(nextOpen);
        if (nextOpen) setDraftRange(value);
    }

    function applyRange() {
        if (!draftRange?.from || !draftRange.to) return;
        onChange(draftRange);
        setOpen(false);
    }

    function clearRange() {
        onChange(undefined);
        setDraftRange(undefined);
        setOpen(false);
    }

    return (
        <Popover onOpenChange={handleOpenChange} open={open}>
            <PopoverTrigger
                aria-label="Filter market intelligence by date range"
                className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-9 min-w-0 max-w-full justify-between gap-2 px-3 font-normal",
                    value ? "text-foreground" : "text-muted-foreground"
                )}
                disabled={disabled}
                title={rangeSummary(value)}
                type="button"
            >
                <span className="flex min-w-0 items-center gap-2">
                    <CalendarDays aria-hidden="true" data-icon="inline-start" />
                    <span className="truncate">{rangeLabel(value)}</span>
                </span>
                <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(42rem,calc(100vw-2rem))] overflow-hidden p-0">
                <div className="grid md:grid-cols-[10.5rem_1fr]">
                    <div className="border-b p-3 md:border-e md:border-b-0">
                        <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Quick ranges</p>
                        <div className="flex flex-col gap-1">
                            {PRESETS.map((preset) => (
                                <Button
                                    className="justify-start"
                                    key={preset.label}
                                    onClick={() => setDraftRange(preset.getRange())}
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                >
                                    {preset.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="min-w-0">
                        <div className="overflow-x-auto p-3">
                            <Calendar
                                captionLayout="dropdown"
                                defaultMonth={draftRange?.from ?? draftRange?.to}
                                disabled={{ after: new Date() }}
                                mode="range"
                                numberOfMonths={2}
                                onSelect={(next) => setDraftRange(next)}
                                selected={draftRange}
                            />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                            <p className="min-w-0 text-xs text-muted-foreground">
                                {draftRange?.from && draftRange.to
                                    ? rangeSummary(draftRange)
                                    : "Pick a start and end date."}
                            </p>
                            <div className="flex items-center gap-2">
                                {value ? (
                                    <Button onClick={clearRange} size="sm" type="button" variant="ghost">
                                        Clear
                                    </Button>
                                ) : null}
                                <Button onClick={() => setOpen(false)} size="sm" type="button" variant="outline">
                                    Cancel
                                </Button>
                                <Button
                                    disabled={!draftRange?.from || !draftRange.to}
                                    onClick={applyRange}
                                    size="sm"
                                    type="button"
                                >
                                    Apply
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
