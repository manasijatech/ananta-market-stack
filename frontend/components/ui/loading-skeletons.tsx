import { PageHeader } from "@/components/brokers/ui";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardPanel
} from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function HeaderSkeleton({
    eyebrowWidth = "w-32",
    titleWidth = "w-72",
    descriptionWidth = "w-full max-w-2xl",
    action = false
}: {
    eyebrowWidth?: string;
    titleWidth?: string;
    descriptionWidth?: string;
    action?: boolean;
}) {
    return (
        <header className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-6 min-[860px]:flex-row min-[860px]:items-end">
            <div className="w-full">
                <Skeleton className={`mb-3 h-3 ${eyebrowWidth}`} />
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
        <div className="flex min-h-0 flex-col gap-4 min-[980px]:h-[calc(100dvh-8rem)] min-[980px]:overflow-hidden">
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
        <PageContainer>
            {header}
            {children}
        </PageContainer>
    );
}

export function GenericDashboardLoading() {
    return (
        <>
            <PageHeader eyebrow="Workspace" title="Loading" description="Preparing your workspace view." />
            <CardGridSkeleton count={4} columns="min-[960px]:grid-cols-3" />
        </>
    );
}
