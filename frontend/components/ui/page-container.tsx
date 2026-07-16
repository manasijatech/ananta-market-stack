import type * as React from "react";
import { cn } from "@/lib/utils";

export function PageContainer({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}): React.ReactElement {
    return <div className={cn("mx-auto w-full max-w-6xl", className)}>{children}</div>;
}
