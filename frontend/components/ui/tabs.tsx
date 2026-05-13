"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
 return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
 return (
 <TabsPrimitive.List
 data-slot="tabs-list"
 className={cn("border-b border-border text-muted-foreground inline-flex h-10 w-fit items-center justify-center", className)}
 {...props}
 />
 );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
 return (
 <TabsPrimitive.Trigger
 data-slot="tabs-trigger"
 className={cn(
 "data-[state=active]:border-primary data-[state=active]:bg-[var(--accent-glow)] data-[state=active]:text-primary focus-visible:border-ring inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 border-b-2 border-transparent px-3 py-1 text-sm font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors duration-100 ease-out disabled:cursor-not-allowed disabled:opacity-40",
 className
 )}
 {...props}
 />
 );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
 return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
