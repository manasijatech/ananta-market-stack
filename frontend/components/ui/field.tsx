"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const fieldVariants = cva("flex w-full gap-2", {
  defaultVariants: {
    orientation: "vertical",
  },
  variants: {
    orientation: {
      horizontal: "flex-row items-center has-[>[data-slot=field-content]]:items-start",
      vertical: "flex-col items-start",
    },
  },
});

export function Field({
  className,
  orientation = "vertical",
  ...props
}: FieldPrimitive.Root.Props &
  VariantProps<typeof fieldVariants>): React.ReactElement {
  return (
    <FieldPrimitive.Root
      className={cn(fieldVariants({ orientation }), className)}
      data-orientation={orientation}
      data-slot="field"
      {...props}
    />
  );
}

export function FieldLabel({
  className,
  ...props
}: FieldPrimitive.Label.Props): React.ReactElement {
  return (
    <FieldPrimitive.Label
      className={cn(
        "inline-flex items-center gap-2 font-medium text-base/4.5 text-foreground data-disabled:opacity-64 sm:text-sm/4",
        className,
      )}
      data-slot="field-label"
      {...props}
    />
  );
}

export function FieldItem({
  className,
  ...props
}: FieldPrimitive.Item.Props): React.ReactElement {
  return (
    <FieldPrimitive.Item
      className={cn("flex", className)}
      data-slot="field-item"
      {...props}
    />
  );
}

export function FieldContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex flex-1 flex-col gap-1 leading-snug", className)}
      data-slot="field-content"
      {...props}
    />
  );
}

export function FieldTitle({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex w-fit items-center gap-2 font-medium text-sm", className)}
      data-slot="field-title"
      {...props}
    />
  );
}

export function FieldDescription({
  className,
  ...props
}: FieldPrimitive.Description.Props): React.ReactElement {
  return (
    <FieldPrimitive.Description
      className={cn("text-muted-foreground text-xs", className)}
      data-slot="field-description"
      {...props}
    />
  );
}

export function FieldError({
  className,
  ...props
}: FieldPrimitive.Error.Props): React.ReactElement {
  return (
    <FieldPrimitive.Error
      className={cn("text-destructive-foreground text-xs", className)}
      data-slot="field-error"
      {...props}
    />
  );
}

export function FieldGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div className={cn("flex flex-col gap-4", className)} data-slot="field-group" {...props} />
  );
}

export function FieldSeparator({
  className,
  children,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("relative flex items-center gap-3", className)}
      data-slot="field-separator"
      {...props}
    >
      <Separator className="flex-1" />
      {children ? (
        <span className="shrink-0 text-muted-foreground text-xs" data-slot="field-separator-content">
          {children}
        </span>
      ) : null}
      <Separator className="flex-1" />
    </div>
  );
}

export const FieldControl: typeof FieldPrimitive.Control =
  FieldPrimitive.Control;
export const FieldValidity: typeof FieldPrimitive.Validity =
  FieldPrimitive.Validity;

export { FieldPrimitive };
