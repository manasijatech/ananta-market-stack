import { PageHeader } from "@/components/brokers/ui";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardHeader,
    CardPanel
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function HeaderSkeleton({
    titleWidth = "w-72",
    descriptionWidth = "w-full max-w-2xl",
    action = false
}: {
    titleWidth?: string;
    descriptionWidth?: string;
    action?: boolean;
}) {
    return (
        <header className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-6 min-[860px]:flex-row min-[860px]:items-end">
            <div className="w-full">
                <Skeleton className={`h-14 ${titleWidth}`} />
                <Skeleton className={`mt-4 h-4 ${descriptionWidth}`} />
                <Skeleton className="mt-2 h-4 w-full max-w-lg" />
            </div>
            {action ? <Skeleton className="h-11 w-36 shrink-0" /> : null}
        </header>
    );
}

export function AlertsNavSkeleton() {
    return (
        <nav className="mb-8 flex flex-wrap gap-2" aria-label="Loading alerts workspace navigation">
            {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton className="h-9 w-32" key={index} />
            ))}
        </nav>
    );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
    return (
        <section className="mb-8 grid gap-4 min-[960px]:grid-cols-4">
            {Array.from({ length: count }).map((_, index) => (
                <div className="app-card-surface bg-card p-4" key={index}>
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-9 w-16" />
                </div>
            ))}
        </section>
    );
}

export function BrokerCardsSkeleton({ count = 6 }: { count?: number }) {
    return (
        <section className="grid gap-4 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {Array.from({ length: count }).map((_, index) => (
                <div className="app-card-surface bg-card p-5" key={index}>
                    <div className="mb-5 flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                            <Skeleton className="size-12 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <Skeleton className="h-3 w-20" />
                                <Skeleton className="mt-2 h-7 w-40" />
                            </div>
                        </div>
                        <Skeleton className="h-7 w-24" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-7 w-24" />
                        <Skeleton className="h-7 w-28" />
                    </div>
                    <Skeleton className="mt-5 h-4 w-44" />
                </div>
            ))}
        </section>
    );
}

export function BrokerConnectionsSkeleton() {
    return (
        <div className="grid gap-5">
            <section className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-44" />
                        <Skeleton className="mt-2 h-3 w-full max-w-2xl" />
                    </div>
                    <Skeleton className="h-8 w-28 shrink-0" />
                </div>
            </section>
            <section className="app-card-surface bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="mt-2 h-3 w-full max-w-lg" />
                    </div>
                    <Skeleton className="h-10 w-36" />
                </div>
                <div className="mt-5 grid gap-3 min-[760px]:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div className="rounded-lg border border-border bg-background p-4" key={index}>
                            <div className="flex items-center gap-3">
                                <Skeleton className="size-10 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <Skeleton className="h-4 w-28" />
                                    <Skeleton className="mt-2 h-3 w-20" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
            <BrokerCardsSkeleton />
        </div>
    );
}

export function CardGridSkeleton({
    count = 4,
    columns = "min-[960px]:grid-cols-2"
}: {
    count?: number;
    columns?: string;
}) {
    return (
        <section className={`grid gap-4 ${columns}`}>
            {Array.from({ length: count }).map((_, index) => (
                <div className="app-card-surface bg-card p-6" key={index}>
                    <Skeleton className="h-6 w-2/3" />
                    <Skeleton className="mt-4 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-5/6" />
                    <Skeleton className="mt-5 h-10 w-32" />
                </div>
            ))}
        </section>
    );
}

export function AlertsOverviewSkeleton() {
    return (
        <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
            <div className="min-w-0 space-y-5 lg:pr-6">
                <section className="grid min-w-0 gap-3 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <div className="min-w-0 rounded-lg bg-muted/50 px-4 py-3" key={index}>
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="mt-3 h-7 w-16" />
                            <Skeleton className="mt-2 h-3 w-32" />
                        </div>
                    ))}
                </section>
                <section className="rounded-lg border border-border bg-card p-5">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="mt-2 h-3 w-72" />
                    <div className="mt-5 grid gap-4">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div className="flex gap-3" key={index}>
                                <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Skeleton className="h-3 w-5" />
                                        <Skeleton className="h-4 w-44" />
                                        <Skeleton className="h-3 w-24" />
                                    </div>
                                    <Skeleton className="mt-2 h-3 w-full max-w-xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
                <section className="min-w-0">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                    <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-2 min-[1500px]:grid-cols-3">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div className="rounded-lg border border-border bg-card p-3" key={index}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <Skeleton className="h-5 w-40" />
                                        <Skeleton className="mt-2 h-3 w-24" />
                                    </div>
                                    <Skeleton className="h-6 w-16" />
                                </div>
                                <div className="mt-4 grid gap-2">
                                    {Array.from({ length: 3 }).map((__, rowIndex) => (
                                        <div className="flex justify-between gap-3" key={rowIndex}>
                                            <Skeleton className="h-3 w-16" />
                                            <Skeleton className="h-3 w-32" />
                                        </div>
                                    ))}
                                </div>
                                <Skeleton className="mt-4 h-3 w-36" />
                            </div>
                        ))}
                    </div>
                </section>
                <FeedSkeleton rows={5} />
            </div>
            <aside className="mt-6 min-w-0 space-y-5 border-border pt-6 lg:mt-0 lg:max-w-[300px] lg:border-l lg:pl-6 lg:pt-0">
                {Array.from({ length: 3 }).map((_, index) => (
                    <section className="border-b border-border/50 pb-5 last:border-b-0 last:pb-0" key={index}>
                        <Skeleton className="h-3 w-28" />
                        <div className="mt-3 grid gap-3">
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-3 w-4/5" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                    </section>
                ))}
            </aside>
        </div>
    );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
    return (
        <div className="border-y border-border">
            <Table className="min-w-[760px] border-collapse text-left text-sm">
                <TableHeader>
                    <TableRow className="border-b border-border">
                        {Array.from({ length: columns }).map((_, index) => (
                            <TableHead className="px-4 py-3" key={index}>
                                <Skeleton className="h-3 w-24" />
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Array.from({ length: rows }).map((_, rowIndex) => (
                        <TableRow className="border-b border-border" key={rowIndex}>
                            {Array.from({ length: columns }).map((_, columnIndex) => (
                                <TableCell className="px-4 py-4" key={columnIndex}>
                                    <Skeleton className={columnIndex === 0 ? "h-5 w-32" : "h-4 w-24"} />
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export function WorkflowListSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <section className="grid gap-4">
            {Array.from({ length: rows }).map((_, index) => (
                <div className="border border-border p-5" key={index}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <Skeleton className="h-5 w-56" />
                            <Skeleton className="mt-2 h-3 w-full max-w-lg" />
                        </div>
                        <Skeleton className="h-7 w-28" />
                    </div>
                    <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Skeleton className="h-8 w-24" />
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-8 w-20" />
                    </div>
                </div>
            ))}
        </section>
    );
}

export function FormSkeleton({ fields = 6 }: { fields?: number }) {
    return (
        <section className="app-card-surface grid gap-5 bg-card p-6">
            {Array.from({ length: fields }).map((_, index) => (
                <div key={index}>
                    <Skeleton className="mb-2 h-3 w-28" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ))}
            <Skeleton className="mt-2 h-11 w-full" />
        </section>
    );
}

export function HeatmapSkeleton() {
    return (
        <div className="flex min-h-[calc(100dvh-8.25rem)] min-w-0 flex-1 flex-col overflow-hidden">
            <HeaderSkeleton descriptionWidth="w-full max-w-lg" titleWidth="w-40" />
            <CardFrame className="mb-4 shrink-0">
                <CardFrameHeader>
                    <CardFrameTitle>
                        <Skeleton className="h-5 w-32" />
                    </CardFrameTitle>
                    <CardFrameDescription>
                        <Skeleton className="h-3 w-72" />
                    </CardFrameDescription>
                    <CardFrameAction>
                        <Skeleton className="h-6 w-20" />
                    </CardFrameAction>
                </CardFrameHeader>
                <Card>
                    <CardPanel className="grid min-w-0 gap-3 p-3">
                        <div className="grid gap-2 min-[760px]:grid-cols-[1.2fr_1fr_1fr_auto]">
                            <Skeleton className="h-9" />
                            <Skeleton className="h-9" />
                            <Skeleton className="h-9" />
                            <Skeleton className="h-9 w-24" />
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <Skeleton className="h-3 w-24" />
                                <Skeleton className="h-6 w-28" />
                                <Skeleton className="h-6 w-24" />
                            </div>
                            <Skeleton className="h-3 w-40" />
                        </div>
                        <div className="grid overflow-hidden rounded-lg border border-border/70 min-[700px]:grid-cols-3">
                            {Array.from({ length: 3 }).map((_, index) => (
                                <div className="border-border/70 px-3 py-2 min-[700px]:border-r last:border-r-0" key={index}>
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="mt-2 h-3 w-14" />
                                </div>
                            ))}
                        </div>
                    </CardPanel>
                </Card>
            </CardFrame>
            <Card className="min-h-0 flex-1 border-border/80 bg-card/95 shadow-xs">
                <CardPanel className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Skeleton className="h-3 w-20" />
                            {Array.from({ length: 5 }).map((_, index) => (
                                <Skeleton className="h-3 w-10" key={index} />
                            ))}
                        </div>
                        <Skeleton className="h-3 w-56" />
                    </div>
                    <div className="grid min-h-0 flex-1 auto-rows-[minmax(4.5rem,1fr)] grid-cols-2 gap-1.5 overflow-hidden min-[700px]:grid-cols-4 min-[1180px]:grid-cols-6">
                        {Array.from({ length: 36 }).map((_, index) => (
                            <Skeleton
                                className={
                                    index === 0
                                        ? "min-h-28 rounded-lg min-[700px]:col-span-2 min-[700px]:row-span-2"
                                        : index === 1 || index === 2
                                          ? "min-h-20 rounded-lg min-[1180px]:col-span-2"
                                          : "min-h-20 rounded-lg"
                                }
                                key={index}
                            />
                        ))}
                    </div>
                </CardPanel>
            </Card>
        </div>
    );
}

export function SystemConfigSkeleton() {
    return (
        <div className="grid gap-8">
            <section className="app-card-surface bg-card p-5">
                <Skeleton className="h-5 w-52" />
                <Skeleton className="mt-3 h-4 w-full max-w-3xl" />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Skeleton className="h-10 w-72" />
                    <Skeleton className="h-10 w-20" />
                </div>
            </section>
            <section className="grid gap-3">
                <Skeleton className="h-5 w-40" />
                {Array.from({ length: 3 }).map((_, index) => (
                    <div className="app-card-surface bg-card p-4" key={index}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <Skeleton className="h-5 w-40" />
                                <Skeleton className="mt-2 h-3 w-64" />
                            </div>
                            <Skeleton className="h-4 w-20" />
                        </div>
                        <Skeleton className="mt-4 h-3 w-full max-w-xl" />
                        <Skeleton className="mt-2 h-3 w-full max-w-lg" />
                    </div>
                ))}
            </section>
            <section className="grid gap-4">
                <div>
                    <Skeleton className="h-5 w-44" />
                    <Skeleton className="mt-2 h-4 w-full max-w-3xl" />
                </div>
                <div className="app-card-surface bg-card p-5">
                    <div>
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="mt-2 h-3 w-72" />
                        <Skeleton className="mt-2 h-3 w-44" />
                    </div>
                    <div className="mt-5 flex flex-col gap-3 min-[760px]:flex-row">
                        <Skeleton className="h-10 w-full min-[760px]:max-w-xl" />
                        <Skeleton className="h-10 w-24" />
                        <Skeleton className="h-10 w-28" />
                        <Skeleton className="h-10 w-24" />
                    </div>
                </div>
            </section>
            <section className="grid gap-4">
                <div>
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="mt-2 h-4 w-full max-w-3xl" />
                </div>
                {Array.from({ length: 3 }).map((_, index) => (
                    <div className="app-card-surface bg-card p-5" key={index}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <Skeleton className="h-5 w-32" />
                                <Skeleton className="mt-2 h-3 w-72" />
                                <Skeleton className="mt-2 h-3 w-44" />
                            </div>
                            <Skeleton className="h-4 w-12" />
                        </div>
                        <div className="mt-4 grid gap-3 min-[900px]:grid-cols-[1.4fr_auto_auto_auto]">
                            <Skeleton className="h-10" />
                            <Skeleton className="h-10 w-24" />
                            <Skeleton className="h-10 w-28" />
                            <Skeleton className="h-10 w-24" />
                        </div>
                        <div className="mt-5 grid gap-3 min-[900px]:grid-cols-[1.1fr_1fr_auto]">
                            <Skeleton className="h-10" />
                            <Skeleton className="h-10" />
                            <Skeleton className="h-10 w-28" />
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
}

export function SettingsPageSkeleton() {
    const groups = [
        { label: "Workspace", items: 2 },
        { label: "Live Data", items: 3 },
        { label: "Developer", items: 2 }
    ];

    return (
        <div className="settings-neutral-surface -mx-3 -mb-8 -mt-[calc(3.75rem+0.75rem+env(safe-area-inset-top))] flex min-h-[calc(100vh-3.75rem)] min-w-0 flex-col overflow-hidden bg-muted/30 sm:-mx-4 sm:-mb-10 sm:-mt-[calc(4.5rem+0.75rem+env(safe-area-inset-top))] sm:min-h-[calc(100vh-4.5rem)] min-[760px]:-mx-8 min-[980px]:my-0 min-[980px]:h-full min-[980px]:min-h-0">
            <div className="flex h-16 shrink-0 items-center border-b border-border bg-muted px-5 min-[760px]:px-10">
                <Skeleton className="h-8 w-28" />
            </div>

            <div className="grid min-h-0 min-w-0 flex-1 min-[1040px]:grid-cols-[20rem_minmax(0,1fr)]">
                <aside className="min-h-full self-stretch border-b border-border bg-muted/60 min-[1040px]:border-b-0 min-[1040px]:border-r">
                    <div className="flex min-h-full flex-col px-5 py-8 min-[760px]:px-10 min-[1040px]:h-full min-[1040px]:overflow-y-auto">
                        <div className="hidden w-full flex-col items-stretch justify-start gap-5 min-[1040px]:flex">
                            {groups.map((group) => (
                                <div className="flex w-full flex-col gap-1" key={group.label}>
                                    <Skeleton className="mb-1 h-4 w-24" />
                                    {Array.from({ length: group.items }).map((_, index) => (
                                        <div className="flex h-9 items-center gap-2 rounded-md px-2" key={index}>
                                            <Skeleton className="size-4 shrink-0" />
                                            <Skeleton className="h-4 w-28" />
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>

                        <div className="flex max-w-full justify-start gap-2 overflow-hidden min-[1040px]:hidden">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <Skeleton className="h-9 w-28 shrink-0" key={index} />
                            ))}
                        </div>
                    </div>
                </aside>

                <section className="min-h-0 min-w-0 overflow-y-auto bg-accent/20">
                    <div className="min-w-0 px-5 py-8 min-[760px]:px-10">
                        <div className="mx-0 grid max-w-7xl gap-7">
                            <div>
                                <Skeleton className="h-8 w-40" />
                                <Skeleton className="mt-3 h-4 w-full max-w-3xl" />
                                <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
                            </div>

                            <section className="@container grid gap-4">
                                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                                    <Skeleton className="h-4 w-full max-w-3xl" />
                                </div>

                                <div className="grid gap-4">
                                    <section className="rounded-lg border border-border bg-card p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <Skeleton className="h-5 w-48" />
                                                <Skeleton className="mt-2 h-3 w-full max-w-xl" />
                                            </div>
                                            <Skeleton className="h-8 w-28" />
                                        </div>
                                        <div className="mt-5 grid gap-3 min-[860px]:grid-cols-[minmax(0,1fr)_auto]">
                                            <Skeleton className="h-10" />
                                            <Skeleton className="h-10 w-32" />
                                        </div>
                                    </section>

                                    <section className="rounded-lg border border-border bg-card p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <Skeleton className="h-5 w-44" />
                                                <Skeleton className="mt-2 h-3 w-full max-w-2xl" />
                                            </div>
                                            <Skeleton className="h-6 w-24" />
                                        </div>
                                        <div className="mt-5 grid gap-3">
                                            {Array.from({ length: 4 }).map((_, index) => (
                                                <div className="rounded-lg border border-border bg-background p-3" key={index}>
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <div className="flex min-w-0 items-center gap-3">
                                                            <Skeleton className="size-8 shrink-0" />
                                                            <div className="min-w-0">
                                                                <Skeleton className="h-4 w-40" />
                                                                <Skeleton className="mt-2 h-3 w-56 max-w-full" />
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <Skeleton className="h-8 w-20" />
                                                            <Skeleton className="h-8 w-24" />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                </div>
                            </section>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

export function AccessSettingsSkeleton() {
    return (
        <div className="grid gap-6">
            <section className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-44" />
                        <Skeleton className="mt-2 h-3 w-full max-w-2xl" />
                    </div>
                    <Skeleton className="h-7 w-24" />
                </div>
            </section>
            <div className="grid items-start gap-6 lg:grid-cols-2">
                {Array.from({ length: 2 }).map((_, panelIndex) => (
                    <section className="grid gap-4 rounded-lg bg-card p-5" key={panelIndex}>
                        <div className="grid gap-2">
                            <Skeleton className="h-3 w-32" />
                            <Skeleton className="h-6 w-56" />
                            <Skeleton className="h-4 w-full max-w-xl" />
                            <Skeleton className="h-4 w-5/6" />
                        </div>
                        <div className="grid gap-3 rounded-lg bg-card">
                            {Array.from({ length: panelIndex === 0 ? 4 : 5 }).map((_, rowIndex) => (
                                <div className="rounded-lg border border-border bg-background p-4" key={rowIndex}>
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <Skeleton className="h-4 w-44" />
                                            <Skeleton className="mt-2 h-3 w-full max-w-md" />
                                        </div>
                                        <Skeleton className="h-8 w-28" />
                                    </div>
                                    {panelIndex === 0 ? (
                                        <div className="mt-4 grid gap-2 min-[760px]:grid-cols-3">
                                            <Skeleton className="h-8" />
                                            <Skeleton className="h-8" />
                                            <Skeleton className="h-8" />
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}

export function BrokerChatSkeleton() {
    return (
        <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-1 flex-col min-[980px]:h-auto">
            <section className="grid min-h-0 flex-1 gap-4 min-[980px]:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
                    <div className="border-b border-border p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <Skeleton className="h-5 w-28" />
                                <Skeleton className="mt-2 h-3 w-40" />
                            </div>
                            <Skeleton className="size-9" />
                        </div>
                        <Skeleton className="mt-4 h-9 w-full" />
                    </div>
                    <div className="grid min-h-0 gap-2 overflow-hidden p-3">
                        {Array.from({ length: 7 }).map((_, index) => (
                            <div className="rounded-lg border border-border bg-background p-3" key={index}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <Skeleton className="h-4 w-36" />
                                        <Skeleton className="mt-2 h-3 w-24" />
                                    </div>
                                    <Skeleton className="h-5 w-12" />
                                </div>
                            </div>
                        ))}
                    </div>
                </aside>
                <Card className="flex min-h-0 flex-col overflow-hidden">
                    <CardHeader className="border-b border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                                <Skeleton className="h-5 w-44" />
                                <Skeleton className="mt-2 h-3 w-64" />
                            </div>
                            <div className="flex gap-2">
                                <Skeleton className="h-8 w-24" />
                                <Skeleton className="h-8 w-9" />
                            </div>
                        </div>
                    </CardHeader>
                    <CardPanel className="min-h-0 flex-1 p-5">
                        <div className="grid gap-6">
                            {Array.from({ length: 3 }).map((_, index) => (
                                <div className="grid gap-3" key={index}>
                                    <div className="ml-auto max-w-[75%] rounded-lg border border-border bg-secondary/50 p-3">
                                        <Skeleton className="h-4 w-64 max-w-full" />
                                        <Skeleton className="mt-2 h-4 w-40 max-w-full" />
                                    </div>
                                    <div className="flex max-w-[82%] gap-3">
                                        <Skeleton className="size-8 shrink-0 rounded-full" />
                                        <div className="min-w-0 flex-1 rounded-lg border border-border bg-background p-3">
                                            <Skeleton className="h-4 w-full" />
                                            <Skeleton className="mt-2 h-4 w-5/6" />
                                            <Skeleton className="mt-2 h-4 w-2/3" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardPanel>
                    <CardPanel className="border-t border-border bg-secondary/20 p-4">
                        <div className="rounded-lg border border-border bg-background">
                            <div className="flex items-end gap-3 p-2">
                                <Skeleton className="min-h-16 flex-1" />
                                <Skeleton className="size-11" />
                            </div>
                            <div className="grid gap-2 border-t border-border bg-secondary/25 px-3 py-3 min-[720px]:grid-cols-[minmax(160px,220px)_minmax(260px,1fr)_auto]">
                                <Skeleton className="h-8" />
                                <Skeleton className="h-8" />
                                <div className="flex gap-3">
                                    <Skeleton className="h-5 w-14" />
                                    <Skeleton className="h-5 w-20" />
                                    <Skeleton className="h-5 w-14" />
                                </div>
                            </div>
                        </div>
                    </CardPanel>
                </Card>
            </section>
        </div>
    );
}

export function BrokerDetailSkeleton() {
    return (
        <div className="grid gap-8">
            <section className="grid gap-8 border-y border-border py-7 lg:grid-cols-[1fr_300px]">
                <div>
                    <div className="flex gap-2">
                        <Skeleton className="h-7 w-24" />
                        <Skeleton className="h-7 w-28" />
                    </div>
                    <dl className="mt-5 grid gap-x-10 gap-y-4 min-[720px]:grid-cols-2">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <div key={index}>
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="mt-2 h-5 w-48" />
                            </div>
                        ))}
                    </dl>
                </div>
                <div className="grid gap-3 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            </section>
            <section className="app-card-surface bg-card p-5">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
                <div className="mt-5 grid gap-3 min-[760px]:grid-cols-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                </div>
            </section>
            <section>
                <div className="mb-3 flex gap-2">
                    <Skeleton className="h-10 w-28" />
                    <Skeleton className="h-10 w-28" />
                    <Skeleton className="h-10 w-28" />
                </div>
                <TableSkeleton columns={5} rows={5} />
            </section>
        </div>
    );
}

export function LlmUsageSkeleton() {
    return (
        <div className="grid w-full gap-5">
            <section className="app-card-surface bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Skeleton className="size-8 shrink-0" />
                        <div className="min-w-0">
                            <Skeleton className="h-5 w-28" />
                            <Skeleton className="mt-2 h-3 w-36" />
                        </div>
                    </div>
                    <Skeleton className="h-6 w-36" />
                </div>
            </section>
            <section className="app-card-surface grid gap-4 bg-card p-4">
                <div className="grid gap-3 min-[760px]:grid-cols-2 min-[1180px]:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index}>
                            <Skeleton className="h-3 w-20" />
                            <Skeleton className="mt-2 h-9 w-full" />
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                    <Skeleton className="h-9 w-24" />
                    <Skeleton className="h-9 w-28" />
                </div>
            </section>
            <div className="grid gap-5">
                <div className="grid gap-3">
                    <Skeleton className="h-6 w-28" />
                    <section className="grid gap-3 lg:grid-cols-2">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div className="app-card-surface bg-card p-4" key={index}>
                                <div className="flex min-h-20 flex-col justify-between gap-4">
                                    <Skeleton className="h-3 w-24" />
                                    <Skeleton className="h-7 w-32" />
                                    <Skeleton className="h-3 w-48" />
                                </div>
                            </div>
                        ))}
                    </section>
                </div>
                <section className="app-card-surface bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <Skeleton className="h-5 w-28" />
                            <Skeleton className="mt-2 h-3 w-56" />
                        </div>
                        <Skeleton className="size-5" />
                    </div>
                    <div className="mt-5 flex h-36 items-end gap-2 overflow-hidden border-t pt-4">
                        {Array.from({ length: 18 }).map((_, index) => (
                            <div className="flex min-w-8 flex-1 flex-col items-center gap-2" key={index}>
                                <Skeleton className={`w-7 rounded-t ${index % 3 === 0 ? "h-20" : index % 3 === 1 ? "h-14" : "h-24"}`} />
                                <Skeleton className="h-3 w-8" />
                            </div>
                        ))}
                    </div>
                </section>
                <TableSkeleton columns={4} rows={6} />
                <TableSkeleton columns={5} rows={8} />
            </div>
        </div>
    );
}

export function DataTestSkeleton() {
    return (
        <div className="grid gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
                <section className="app-card-surface bg-card p-5" key={index}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <Skeleton className="h-6 w-44" />
                            <Skeleton className="mt-2 h-4 w-full max-w-xl" />
                        </div>
                        <Skeleton className="h-10 w-32" />
                    </div>
                    <div className="mt-5 grid gap-3 min-[760px]:grid-cols-3">
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10" />
                    </div>
                    <Skeleton className="mt-5 h-32 w-full" />
                </section>
            ))}
        </div>
    );
}

export function WorkflowEditorSkeleton() {
    return (
        <div className="grid gap-6">
            <section className="app-card-surface grid gap-4 bg-card p-5">
                <Skeleton className="h-5 w-40" />
                <div className="grid gap-4 min-[900px]:grid-cols-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                </div>
                <Skeleton className="h-28 w-full" />
            </section>
            <section className="app-card-surface grid gap-4 bg-card p-5">
                <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-9 w-32" />
                    <Skeleton className="h-9 w-32" />
                    <Skeleton className="h-9 w-32" />
                </div>
                {Array.from({ length: 3 }).map((_, index) => (
                    <div
                        className="app-card-surface grid gap-3 bg-card p-4 min-[900px]:grid-cols-[1fr_1fr_1fr_auto]"
                        key={index}
                    >
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10 w-24" />
                    </div>
                ))}
            </section>
            <div className="flex flex-wrap justify-end gap-3">
                <Skeleton className="h-10 w-28" />
                <Skeleton className="h-10 w-36" />
            </div>
        </div>
    );
}

export function WatchlistsSkeleton() {
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 min-[980px]:overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-4 min-[1080px]:grid min-[1080px]:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] min-[1080px]:overflow-hidden">
                <aside className="min-h-0 min-w-0">
                    <CardFrame>
                        <CardFrameHeader className="border-b px-4 py-3">
                            <CardFrameTitle>
                                <Skeleton className="h-4 w-28" />
                            </CardFrameTitle>
                            <CardFrameDescription>
                                <Skeleton className="h-3 w-40" />
                            </CardFrameDescription>
                            <CardFrameAction>
                                <Skeleton className="size-8" />
                            </CardFrameAction>
                        </CardFrameHeader>
                        <Card>
                            <CardPanel className="flex flex-col gap-2 p-3 max-[1079px]:max-h-72">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <div
                                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
                                        key={index}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <Skeleton className="h-4 w-36" />
                                            <Skeleton className="mt-2 h-3 w-20" />
                                        </div>
                                        <Skeleton className="h-5 w-10" />
                                    </div>
                                ))}
                            </CardPanel>
                        </Card>
                    </CardFrame>
                </aside>

                <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
                    <CardFrame className="shrink-0">
                        <CardFrameHeader>
                            <CardFrameTitle>
                                <Skeleton className="h-5 w-48" />
                            </CardFrameTitle>
                            <CardFrameDescription>
                                <Skeleton className="h-3 w-56" />
                            </CardFrameDescription>
                            <CardFrameAction>
                                <div className="flex gap-2">
                                    <Skeleton className="size-8" />
                                    <Skeleton className="size-8" />
                                </div>
                            </CardFrameAction>
                        </CardFrameHeader>
                        <Card>
                            <CardPanel className="grid gap-3 p-4 min-[760px]:grid-cols-[minmax(0,1fr)_5.5rem_auto]">
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-9 w-24" />
                            </CardPanel>
                        </Card>
                    </CardFrame>

                    <CardFrame className="hidden min-h-0 min-[760px]:flex min-[760px]:flex-1 min-[760px]:flex-col">
                        <Card>
                            <CardPanel className="p-0">
                                <div className="border-b border-border px-4 py-3">
                                    <div className="flex gap-6">
                                        {Array.from({ length: 6 }).map((_, index) => (
                                            <Skeleton className="h-3 w-16" key={index} />
                                        ))}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-0">
                                    {Array.from({ length: 7 }).map((_, index) => (
                                        <div
                                            className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
                                            key={index}
                                        >
                                            <Skeleton className="size-8 shrink-0 rounded-full" />
                                            <Skeleton className="h-4 w-20" />
                                            <Skeleton className="h-4 w-40 flex-1" />
                                            <Skeleton className="h-4 w-14" />
                                            <Skeleton className="h-4 w-16" />
                                            <Skeleton className="size-8 shrink-0" />
                                        </div>
                                    ))}
                                </div>
                            </CardPanel>
                        </Card>
                    </CardFrame>

                    <div className="grid gap-3 min-[760px]:hidden">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <Card key={index}>
                                <CardPanel className="flex items-center gap-3 p-3">
                                    <Skeleton className="size-9 shrink-0 rounded-full" />
                                    <div className="min-w-0 flex-1">
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="mt-2 h-3 w-40" />
                                    </div>
                                    <Skeleton className="size-8 shrink-0" />
                                </CardPanel>
                            </Card>
                        ))}
                    </div>
                </main>
            </div>
        </div>
    );
}

export function FeedSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <div className="grid gap-3">
            {Array.from({ length: rows }).map((_, index) => (
                <div className="border-l-2 border-border pl-3" key={index}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <Skeleton className="h-5 w-3/4" />
                            <Skeleton className="mt-2 h-3 w-1/2" />
                        </div>
                        <Skeleton className="h-6 w-20" />
                    </div>
                    <Skeleton className="mt-3 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-4/5" />
                </div>
            ))}
        </div>
    );
}

export function LoadingShell({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex min-h-0 w-full flex-1 flex-col">
            {header}
            {children}
        </div>
    );
}

export function GenericDashboardLoading() {
    return (
        <>
            <PageHeader title="Loading" description="Preparing your workspace view." />
            <CardGridSkeleton count={4} columns="min-[960px]:grid-cols-3" />
        </>
    );
}
