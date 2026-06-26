"use client";

import Link from "next/link";
import { IconArrowUpRight, IconInfoCircle } from "@tabler/icons-react";
import {
    Collapsible,
    CollapsiblePanel,
    CollapsibleTrigger
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function AccessSetupNotice() {
    return (
        <Collapsible className="rounded-lg border-l-[3px] border-l-blue-400 bg-card py-2.5 pr-3.5 pl-3.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <IconInfoCircle aria-hidden className="size-4 shrink-0 text-blue-400" />
                    <p className="truncate text-[13px] text-foreground">
                        Shared config (API key, LLM, MCP) lives in Settings — role changes control access.
                    </p>
                </div>
                <CollapsibleTrigger
                    className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-sm text-[13px] text-muted-foreground",
                        "underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                >
                    Learn more
                    <IconArrowUpRight aria-hidden className="size-3.5" />
                </CollapsibleTrigger>
            </div>
            <CollapsiblePanel>
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    Admins configure the shared Drishti API key in{" "}
                    <Link className="text-foreground underline underline-offset-2 hover:text-primary" href="/settings#alpha">
                        Settings → Drishti
                    </Link>
                    , LLM providers in{" "}
                    <Link className="text-foreground underline underline-offset-2 hover:text-primary" href="/settings#llm">
                        Settings → LLM
                    </Link>
                    , MCP servers in{" "}
                    <Link className="text-foreground underline underline-offset-2 hover:text-primary" href="/settings#mcp">
                        Settings → MCP
                    </Link>
                    , and usage visibility in{" "}
                    <Link className="text-foreground underline underline-offset-2 hover:text-primary" href="/llm-usage">
                        LLM Usage
                    </Link>
                    . Role changes below control who can open or use those features.
                </p>
            </CollapsiblePanel>
        </Collapsible>
    );
}
