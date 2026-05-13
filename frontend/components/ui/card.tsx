import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
 return (
 <div
 data-slot="card"
 className={cn("bg-[var(--bg-surface)] text-card-foreground flex flex-col gap-6 border border-[var(--border-subtle)] py-6 ", className)}
 {...props}
 />
 );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
 return <div data-slot="card-header" className={cn("grid auto-rows-min grid-rows-[auto_auto] gap-1.5 px-6", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
 return <div data-slot="card-title" className={cn("leading-none font-semibold tracking-normal", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
 return <div data-slot="card-description" className={cn("text-muted-foreground text-sm leading-6", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
 return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
 return <div data-slot="card-footer" className={cn("flex items-center px-6", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
