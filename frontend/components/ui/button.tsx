import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
 "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border text-sm font-semibold whitespace-nowrap uppercase tracking-[0.08em] transition-colors duration-100 ease-out outline-none focus-visible:border-ring focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
 {
 variants: {
 variant: {
 default: "border-primary bg-primary text-primary-foreground hover:bg-primary/85",
 destructive: "border-destructive bg-transparent text-destructive hover:bg-destructive/10",
 outline: "border-input bg-transparent text-foreground hover:border-primary hover:text-primary",
 secondary: "border-border bg-secondary text-secondary-foreground hover:border-primary/60",
 ghost: "border-border bg-transparent text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground",
 link: "border-transparent bg-transparent px-0 text-primary underline-offset-4 hover:underline"
 },
 size: {
  default: "h-10 px-4 py-2",
  sm: "h-9 px-3 text-sm",
  lg: "h-11 px-6",
  icon: "size-10"
 }
 },
 defaultVariants: {
 variant: "default",
 size: "default"
 }
 }
);

function Button({
 className,
 variant,
 size,
 asChild = false,
 ...props
}: React.ComponentProps<"button"> &
 VariantProps<typeof buttonVariants> & {
 asChild?: boolean;
 }) {
 const Comp = asChild ? Slot : "button";

 return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
