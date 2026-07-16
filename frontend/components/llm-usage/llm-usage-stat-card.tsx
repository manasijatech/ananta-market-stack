import type { TablerIcon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";

export const statLabelClassName = typography.statLabel;

export function StatCard({
    label,
    value,
    valueNode,
    detail,
    icon: Icon,
    mutedIcon = true,
    infoTooltip
}: {
    label: string;
    value?: string;
    valueNode?: ReactNode;
    detail: string;
    icon: TablerIcon;
    mutedIcon?: boolean;
    infoTooltip?: ReactNode;
}) {
    return (
        <div className="app-card-surface min-w-0 bg-card p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
                <p className={statLabelClassName}>{label}</p>
                <div className="flex items-center gap-1">
                    {infoTooltip}
                    <Icon
                        aria-hidden
                        className={cn("size-4 shrink-0", mutedIcon ? "text-muted-foreground" : "text-muted-foreground")}
                        stroke={1.75}
                    />
                </div>
            </div>
            <div className="break-words text-[28px] font-medium leading-none tracking-normal">
                {valueNode ?? value}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
        </div>
    );
}

export function StatValueMuted({ children }: { children: ReactNode }) {
    return <span className="text-[15px] font-normal italic text-muted-foreground">{children}</span>;
}

export function tableHeadClassName(className?: string) {
    return cn("h-9 border-b border-border/50", typography.statLabel, className);
}
