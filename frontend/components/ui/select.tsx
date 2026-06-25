"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { Select as SelectPrimitiveImport } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const SelectPrimitive = SelectPrimitiveImport;

type NativeSelectProps = React.ComponentProps<"select"> & {
  onValueChange?: never;
};

type CossSelectProps<Value = string, Multiple extends boolean | undefined = false> =
  SelectPrimitiveImport.Root.Props<Value, Multiple> & {
    onChange?: never;
  };

export function Select(props: NativeSelectProps): React.ReactElement;
export function Select<Value = string, Multiple extends boolean | undefined = false>(
  props: CossSelectProps<Value, Multiple>,
): React.ReactElement;
export function Select(
  props: CossSelectProps | NativeSelectProps,
): React.ReactElement {
  if ("onChange" in props) {
    const { className, children, ...rest } = props as NativeSelectProps;
    return (
      <select
        className={cn(selectTriggerVariants(), className)}
        data-slot="select-native"
        {...rest}
      >
        {children}
      </select>
    );
  }

  return <SelectPrimitiveImport.Root {...(props as CossSelectProps)} />;
}

export const selectTriggerVariants = cva(
  "relative inline-flex min-h-9 w-full min-w-36 select-none items-center justify-between gap-2 rounded-lg border border-input bg-background not-dark:bg-clip-padding px-[calc(--spacing(3)-1px)] text-left text-base text-foreground shadow-xs/5 outline-none ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 data-disabled:pointer-events-none data-disabled:opacity-64 sm:min-h-8 sm:text-sm dark:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [[data-disabled],:focus-visible,[aria-invalid],[data-pressed]]:shadow-none",
  {
    defaultVariants: {
      size: "default",
    },
    variants: {
      size: {
        default: "",
        lg: "min-h-10 sm:min-h-9",
        sm: "min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:min-h-7",
      },
    },
  },
);

export const selectTriggerIconClassName = "-me-1 size-4.5 opacity-80 sm:size-4";

export interface SelectButtonProps extends useRender.ComponentProps<"button"> {
  size?: VariantProps<typeof selectTriggerVariants>["size"];
}

export function SelectButton({
  className,
  size,
  render,
  children,
  ...props
}: SelectButtonProps): React.ReactElement {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        <span className="flex-1 truncate in-data-placeholder:text-muted-foreground/72">
          {children}
        </span>
        <ChevronsUpDownIcon className={selectTriggerIconClassName} />
      </>
    ),
    className: cn(selectTriggerVariants({ size }), "min-w-0", className),
    "data-slot": "select-button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitiveImport.Trigger.Props &
  VariantProps<typeof selectTriggerVariants>): React.ReactElement {
  return (
    <SelectPrimitiveImport.Trigger
      className={cn(selectTriggerVariants({ size }), className)}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitiveImport.Icon data-slot="select-icon">
        <ChevronsUpDownIcon className={selectTriggerIconClassName} />
      </SelectPrimitiveImport.Icon>
    </SelectPrimitiveImport.Trigger>
  );
}

export function SelectValue({
  className,
  ...props
}: SelectPrimitiveImport.Value.Props): React.ReactElement {
  return (
    <SelectPrimitiveImport.Value
      className={cn(
        "flex-1 truncate data-placeholder:text-muted-foreground",
        className,
      )}
      data-slot="select-value"
      {...props}
    />
  );
}

export function SelectPopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  anchor,
  portalProps,
  ...props
}: SelectPrimitiveImport.Popup.Props & {
  portalProps?: SelectPrimitiveImport.Portal.Props;
  side?: SelectPrimitiveImport.Positioner.Props["side"];
  sideOffset?: SelectPrimitiveImport.Positioner.Props["sideOffset"];
  align?: SelectPrimitiveImport.Positioner.Props["align"];
  alignOffset?: SelectPrimitiveImport.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitiveImport.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitiveImport.Positioner.Props["anchor"];
}): React.ReactElement {
  return (
    <SelectPrimitiveImport.Portal {...portalProps}>
      <SelectPrimitiveImport.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-[90] select-none"
        data-slot="select-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitiveImport.Popup
          className="origin-(--transform-origin) text-foreground outline-none"
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitiveImport.ScrollUpArrow
            className="top-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:top-px before:h-[200%] before:rounded-t-[calc(var(--radius-lg)-1px)] before:bg-linear-to-b before:from-50% before:from-popover"
            data-slot="select-scroll-up-arrow"
          >
            <ChevronUpIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitiveImport.ScrollUpArrow>
          <div className="relative h-full min-w-(--anchor-width) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
            <SelectPrimitiveImport.List
              className={cn(
                "max-h-(--available-height) overflow-y-auto p-1",
                className,
              )}
              data-slot="select-list"
            >
              {children}
            </SelectPrimitiveImport.List>
          </div>
          <SelectPrimitiveImport.ScrollDownArrow
            className="bottom-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:bottom-px before:h-[200%] before:rounded-b-[calc(var(--radius-lg)-1px)] before:bg-linear-to-t before:from-50% before:from-popover"
            data-slot="select-scroll-down-arrow"
          >
            <ChevronDownIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitiveImport.ScrollDownArrow>
        </SelectPrimitiveImport.Popup>
      </SelectPrimitiveImport.Positioner>
    </SelectPrimitiveImport.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitiveImport.Item.Props): React.ReactElement {
  return (
    <SelectPrimitiveImport.Item
      className={cn(
        "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm py-1 ps-2 pe-4 text-base outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitiveImport.ItemIndicator className="col-start-1">
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
        </svg>
      </SelectPrimitiveImport.ItemIndicator>
      <SelectPrimitiveImport.ItemText className="col-start-2 min-w-0">
        {children}
      </SelectPrimitiveImport.ItemText>
    </SelectPrimitiveImport.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: SelectPrimitiveImport.Separator.Props): React.ReactElement {
  return (
    <SelectPrimitiveImport.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

export function SelectGroup(
  props: SelectPrimitiveImport.Group.Props,
): React.ReactElement {
  return <SelectPrimitiveImport.Group data-slot="select-group" {...props} />;
}

export function SelectLabel({
  className,
  ...props
}: SelectPrimitiveImport.Label.Props): React.ReactElement {
  return (
    <SelectPrimitiveImport.Label
      className={cn(
        "not-in-data-[slot=field]:mb-2 inline-flex cursor-default items-center gap-2 font-medium text-base/4.5 text-foreground sm:text-sm/4",
        className,
      )}
      data-slot="select-label"
      {...props}
    />
  );
}

export function SelectGroupLabel(
  props: SelectPrimitiveImport.GroupLabel.Props,
): React.ReactElement {
  return (
    <SelectPrimitiveImport.GroupLabel
      className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
      data-slot="select-group-label"
      {...props}
    />
  );
}

export { SelectPopup as SelectContent };

export {
  SimpleSelect,
  SIMPLE_SELECT_EMPTY_VALUE,
  type SimpleSelectOption,
  type SimpleSelectProps,
} from "@/components/ui/simple-select";
