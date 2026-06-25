"use client";

import { format } from "date-fns";
import { useEffect, useState } from "react";
import { IconCalendar } from "@tabler/icons-react";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldLabel } from "@/components/ui/field";
import { Group, GroupSeparator } from "@/components/ui/group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { typography } from "@/lib/typography";
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

type DatePickerControlProps = {
    name: string;
    placeholder: string;
    value?: string | null;
    className?: string;
};

function DatePickerControl({ name, placeholder, value, className }: DatePickerControlProps) {
    const initialDate = parseFilterDate(value);
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState<Date | undefined>(initialDate);

    useEffect(() => {
        setDate(parseFilterDate(value));
    }, [value]);

    return (
        <>
            <input name={name} type="hidden" value={toFilterDateValue(date)} />
            <Popover onOpenChange={setOpen} open={open}>
                <PopoverTrigger
                    className={cn(
                        buttonVariants({ size: "sm", variant: "outline" }),
                        "h-8 min-w-[8.75rem] flex-1 justify-between gap-2 rounded-none border-0 bg-transparent px-2.5 font-normal shadow-none first:rounded-s-lg last:rounded-e-lg hover:bg-accent/40 data-[empty=true]:text-muted-foreground",
                        className
                    )}
                    data-empty={!date}
                    type="button"
                >
                    <span className="truncate">{date ? format(date, "MMM d, yyyy") : placeholder}</span>
                    <IconCalendar aria-hidden className="size-4 shrink-0 opacity-80" stroke={1.75} />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                        defaultMonth={date}
                        mode="single"
                        onSelect={(next) => {
                            setDate(next);
                            if (next) setOpen(false);
                        }}
                        selected={date}
                    />
                </PopoverContent>
            </Popover>
        </>
    );
}

type LlmUsageDateRangeFilterProps = {
    dateFrom?: string | null;
    dateTo?: string | null;
};

export function LlmUsageDateRangeFilter({ dateFrom, dateTo }: LlmUsageDateRangeFilterProps) {
    return (
        <Field className="min-w-[17.5rem]">
            <FieldLabel className={typography.statLabel}>Date range</FieldLabel>
            <Group className="w-full rounded-lg border border-input bg-background shadow-xs/5 dark:bg-input/32">
                <DatePickerControl name="date_from" placeholder="From" value={dateFrom} />
                <GroupSeparator />
                <DatePickerControl name="date_to" placeholder="To" value={dateTo} />
            </Group>
        </Field>
    );
}
