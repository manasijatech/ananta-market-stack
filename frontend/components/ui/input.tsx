import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
 return (
 <input
 data-slot="input"
 type={type}
 className={cn(
 "border-input bg-transparent placeholder:text-muted-foreground flex h-10 w-full min-w-0 border-0 border-b px-0 py-1 text-sm transition-colors duration-100 ease-out outline-none focus-visible:border-ring focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive",
 className
 )}
 {...props}
 />
 );
}

export { Input };
