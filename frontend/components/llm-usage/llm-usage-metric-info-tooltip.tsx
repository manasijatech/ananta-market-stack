"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import {
    Tooltip,
    TooltipPopup,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";

export function MetricInfoTooltip({ content }: { content: ReactNode }) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <button
                            aria-label="More information"
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            type="button"
                        >
                            <IconInfoCircle aria-hidden className="size-3.5" />
                        </button>
                    }
                />
                <TooltipPopup className="max-w-xs">{content}</TooltipPopup>
            </Tooltip>
        </TooltipProvider>
    );
}
