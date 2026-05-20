import * as React from "react";
import { cn } from "@/lib/utils";

function Select({ className, ...props }: React.ComponentProps<"select">) {
    return (
        <select
            data-slot="select"
            className={cn(
                "border-input bg-background text-foreground focus-visible:border-ring h-10 w-full rounded-md border px-3 text-[15px] leading-5 outline-none disabled:cursor-not-allowed disabled:opacity-40",
                className
            )}
            {...props}
        />
    );
}

export { Select };
