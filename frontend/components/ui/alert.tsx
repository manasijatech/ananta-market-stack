import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full border-l-2 px-4 py-3 text-sm", {
 variants: {
 variant: {
 default: "border-primary bg-[var(--accent-glow)] text-card-foreground",
 destructive: "border-destructive text-destructive bg-destructive/10",
 warning: "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text-secondary)]"
 }
 },
 defaultVariants: {
 variant: "default"
 }
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
 return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
 return <div data-slot="alert-title" className={cn("mb-1 font-medium", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
 return <div data-slot="alert-description" className={cn("text-sm", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
