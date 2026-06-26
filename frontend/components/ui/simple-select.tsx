"use client";

import type * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const SIMPLE_SELECT_EMPTY_VALUE = "__simple_select_empty__";

export type SimpleSelectOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SimpleSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SimpleSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  size?: "default" | "sm" | "lg";
  "aria-label"?: string;
  id?: string;
  name?: string;
  contentClassName?: string;
};

function toItemValue(value: string): string {
  return value === "" ? SIMPLE_SELECT_EMPTY_VALUE : value;
}

function fromItemValue(value: string | null): string {
  if (value === SIMPLE_SELECT_EMPTY_VALUE) {
    return "";
  }
  return value ?? "";
}

export function SimpleSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  disabled,
  className,
  triggerClassName,
  size = "default",
  "aria-label": ariaLabel,
  id,
  name,
  contentClassName,
}: SimpleSelectProps): React.ReactElement {
  const selectedLabel = options.find((option) => option.value === value)?.label;
  const selectValue = value === "" ? SIMPLE_SELECT_EMPTY_VALUE : value || undefined;

  return (
    <Select
      disabled={disabled}
      name={name}
      onValueChange={(next) => onValueChange(fromItemValue(next))}
      value={selectValue}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "min-w-0 border border-input bg-background px-3 text-sm",
          triggerClassName ?? className,
        )}
        id={id}
        size={size}
      >
        <SelectValue placeholder={placeholder}>
          {selectedLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        className={cn("min-w-[var(--anchor-width)]", contentClassName)}
      >
        {options.map((option) => (
          <SelectItem
            disabled={option.disabled}
            key={`${toItemValue(option.value)}-${String(option.label)}`}
            value={toItemValue(option.value)}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
