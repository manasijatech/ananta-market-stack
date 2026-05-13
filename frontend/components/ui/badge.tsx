import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
 "inline-flex w-fit shrink-0 items-center justify-center border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap transition-colors",
 {
 variants: {
 variant: {
 default: "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]",
 secondary: "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
 destructive: "border-[var(--danger)] bg-[var(--danger-subtle)] text-[var(--danger)]",
 outline: "border-border bg-transparent text-foreground"
 }
 },
 defaultVariants: {
 variant: "default"
 }
 }
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
 return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
