import Link from "next/link";
import type { ReactNode } from "react";
import type { TablerIcon } from "@tabler/icons-react";
import { IconArrowRight, IconCircleCheck } from "@tabler/icons-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardPanel
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";

export type DashboardTone = "good" | "warn" | "danger" | "muted";

export type SetupChecklistItem = {
    id: string;
    label: string;
    description: string;
    href: string;
    complete: boolean;
    icon: TablerIcon;
};

export function dashboardToneClasses(tone: DashboardTone) {
    if (tone === "good") return "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]";
    if (tone === "danger") return "border-[var(--danger)] bg-[var(--danger-subtle)] text-[var(--danger)]";
    if (tone === "warn") {
        return "border-primary bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]";
    }
    return "border-border bg-secondary text-muted-foreground";
}

function dashboardToneBadgeVariant(tone: DashboardTone): NonNullable<BadgeProps["variant"]> {
    if (tone === "good") return "success";
    if (tone === "danger") return "error";
    if (tone === "warn") return "warning";
    return "secondary";
}

export function EmptyStateLine({ children }: { children: ReactNode }) {
    return <p className={typography.muted}>{children}</p>;
}

export function MetricPanel({
    label,
    value,
    hint,
    className
}: {
    label: string;
    value: string;
    hint?: string;
    className?: string;
}) {
    return (
        <Card className={cn("border-border/80 bg-background/40 shadow-none", className)}>
            <CardPanel className="p-4">
                <p className={typography.muted}>{label}</p>
                <p className={cn(typography.h3, "mt-2")}>{value}</p>
                {hint ? <p className={cn(typography.muted, "mt-1 leading-5")}>{hint}</p> : null}
            </CardPanel>
        </Card>
    );
}

export function ProgressTrack({
    label,
    detail,
    value
}: {
    label: string;
    detail: string;
    value: number;
}) {
    const clamped = Math.min(100, Math.max(0, value));

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-3">
                <p className={typography.small}>{label}</p>
                <p className={typography.muted}>{detail}</p>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${clamped}%` }}
                />
            </div>
        </div>
    );
}

export function ActivityRow({
    icon: Icon,
    title,
    subtitle,
    meta,
    value,
    valueClassName
}: {
    icon: TablerIcon;
    title: string;
    subtitle: string;
    meta: string;
    value: string;
    valueClassName?: string;
}) {
    return (
        <div className="flex items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-muted/30">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                <Icon stroke={1.8} />
            </span>
            <div className="min-w-0 flex-1">
                <p className={cn(typography.small, "truncate")}>{title}</p>
                <p className={cn(typography.muted, "truncate")}>{subtitle}</p>
            </div>
            <div className="shrink-0 text-right">
                <p className={typography.muted}>{meta}</p>
                <p className={cn(typography.small, valueClassName)}>{value}</p>
            </div>
        </div>
    );
}

export function DashboardModuleCard({
    href,
    title,
    description,
    tone,
    icon: Icon,
    error,
    children
}: {
    href: string;
    title: string;
    description: string;
    tone: DashboardTone;
    icon: TablerIcon;
    error?: string;
    children: ReactNode;
}) {
    return (
        <CardFrame className="group/card h-full">
            <CardFrameHeader>
                <CardFrameTitle className={typography.h4}>
                    <Link
                        className="inline-flex items-center gap-2 outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                        href={href}
                    >
                        <span className="truncate">{title}</span>
                        <IconArrowRight
                            className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100"
                            stroke={1.8}
                        />
                    </Link>
                </CardFrameTitle>
                <CardFrameDescription className="leading-7">{description}</CardFrameDescription>
                <CardFrameAction>
                    <span
                        className={cn(
                            "flex size-10 items-center justify-center rounded-lg border",
                            dashboardToneClasses(tone)
                        )}
                    >
                        <Icon stroke={1.8} />
                    </span>
                </CardFrameAction>
            </CardFrameHeader>
            <Card>
                <CardPanel className="flex flex-col gap-4">
                    {children}
                    {error ? (
                        <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--danger)]">
                            {error}
                        </p>
                    ) : null}
                </CardPanel>
            </Card>
        </CardFrame>
    );
}

export function SetupChecklist({
    items,
    completedCount,
    totalCount
}: {
    items: SetupChecklistItem[];
    completedCount: number;
    totalCount: number;
}) {
    const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

    return (
        <CardFrame>
            <CardFrameHeader>
                <CardFrameTitle className={typography.h4}>
                    Complete setup ({completedCount}/{totalCount})
                </CardFrameTitle>
                <CardFrameDescription className="leading-7">
                    Finish these steps to unlock broker data, market intelligence, alerts, and LLM workflows.
                </CardFrameDescription>
            </CardFrameHeader>
            <Card>
                <CardPanel className="flex flex-col gap-4">
                    <ProgressTrack
                        detail={`${completedCount} of ${totalCount} done`}
                        label="Workspace readiness"
                        value={progress}
                    />
                    <div className="flex flex-col gap-1">
                        {items.map((item, index) => (
                            <div key={item.id}>
                                <Link
                                    className="group/setup-item flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-muted/30"
                                    href={item.href}
                                >
                                    <span
                                        className={cn(
                                            "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                                            item.complete
                                                ? dashboardToneClasses("good")
                                                : dashboardToneClasses("muted")
                                        )}
                                    >
                                        {item.complete ? (
                                            <IconCircleCheck stroke={1.8} />
                                        ) : (
                                            <item.icon stroke={1.8} />
                                        )}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className={typography.small}>{item.label}</p>
                                        <p className={cn(typography.muted, "mt-0.5")}>{item.description}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <Badge variant={item.complete ? "success" : "secondary"}>
                                            {item.complete ? "Done" : "Pending"}
                                        </Badge>
                                        <IconArrowRight
                                            className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover/setup-item:opacity-100"
                                            stroke={1.8}
                                        />
                                    </div>
                                </Link>
                                {index < items.length - 1 ? <Separator /> : null}
                            </div>
                        ))}
                    </div>
                </CardPanel>
            </Card>
        </CardFrame>
    );
}

export function IntegrationRow({
    label,
    value,
    tone
}: {
    label: string;
    value: string;
    tone: DashboardTone;
}) {
    return (
        <>
            <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <Badge variant={dashboardToneBadgeVariant(tone)}>{value}</Badge>
            </div>
            <Separator />
        </>
    );
}
