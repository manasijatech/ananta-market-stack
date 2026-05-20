import { PageHeader, Shell } from "@/components/brokers/ui";
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
                <div className="border border-border p-4" key={index}>
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
                <div className="border border-border bg-card p-5" key={index}>
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
                <div className="border border-border bg-card p-6" key={index}>
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
        <section className="grid gap-5 border border-border bg-card p-6">
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
            <section className="border border-border p-5">
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
                    <div className="border border-border p-4" key={index}>
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
                <div className="border border-border p-5">
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
                    <div className="border border-border p-5" key={index}>
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
            <section className="border border-border p-5">
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
                <section className="border border-border p-5" key={index}>
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
            <section className="grid gap-4 border border-border p-5">
                <Skeleton className="h-5 w-40" />
                <div className="grid gap-4 min-[900px]:grid-cols-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                </div>
                <Skeleton className="h-28 w-full" />
            </section>
            <section className="grid gap-4 border border-border p-5">
                <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-9 w-32" />
                    <Skeleton className="h-9 w-32" />
                    <Skeleton className="h-9 w-32" />
                </div>
                {Array.from({ length: 3 }).map((_, index) => (
                    <div
                        className="grid gap-3 border border-border p-4 min-[900px]:grid-cols-[1fr_1fr_1fr_auto]"
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
        <section className="-mx-5 -my-8 h-[calc(100vh-73px)] overflow-hidden bg-background text-foreground min-[760px]:-mx-8 min-[980px]:-mx-10 min-[980px]:-my-10 min-[980px]:h-[calc(100vh-80px)]">
            <div className="flex h-full min-h-0 flex-col px-5 py-5 min-[760px]:px-8 min-[980px]:px-10">
                <header className="mb-7 flex flex-col gap-3 border-b border-border pb-5 min-[760px]:flex-row min-[760px]:items-end min-[760px]:justify-between">
                    <div>
                        <Skeleton className="h-3 w-36" />
                        <Skeleton className="mt-3 h-12 w-64" />
                    </div>
                    <div className="w-full max-w-xl">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="mt-2 h-4 w-5/6" />
                    </div>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-8 min-[980px]:grid min-[980px]:grid-cols-[260px_320px_minmax(0,1fr)] min-[980px]:gap-8">
                    <aside className="w-full shrink-0 border-b border-border pb-6 min-[980px]:border-b-0 min-[980px]:border-r min-[980px]:pb-0 min-[980px]:pr-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <Skeleton className="h-3 w-36" />
                            <Skeleton className="size-8" />
                        </div>
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div className="border-l-2 border-transparent px-3 py-3" key={index}>
                                <Skeleton className="h-4 w-40" />
                                <Skeleton className="mt-2 h-3 w-20" />
                            </div>
                        ))}
                    </aside>
                    <aside className="w-full shrink-0 border-b border-border pb-6 min-[980px]:border-b-0 min-[980px]:border-r min-[980px]:pb-0 min-[980px]:pr-5">
                        <Skeleton className="mb-2 h-3 w-32" />
                        <Skeleton className="h-9 w-full" />
                        <div className="mt-3 grid gap-2">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <div className="border-l-2 border-transparent px-3 py-3" key={index}>
                                    <Skeleton className="h-4 w-48" />
                                    <Skeleton className="mt-2 h-3 w-32" />
                                </div>
                            ))}
                        </div>
                    </aside>
                    <main className="min-w-0 flex-1 overflow-hidden">
                        <div className="mb-7 flex flex-col gap-4 border-b border-border pb-5 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
                            <div>
                                <Skeleton className="h-10 w-72" />
                                <Skeleton className="mt-3 h-3 w-44" />
                            </div>
                            <div className="flex gap-2">
                                <Skeleton className="size-9" />
                                <Skeleton className="size-9" />
                            </div>
                        </div>
                        <div className="mb-7 grid gap-3 min-[760px]:grid-cols-[1fr_8rem]">
                            <div>
                                <Skeleton className="mb-2 h-3 w-24" />
                                <Skeleton className="h-11 w-full" />
                            </div>
                            <div>
                                <Skeleton className="mb-2 h-3 w-20" />
                                <Skeleton className="h-11 w-full" />
                            </div>
                        </div>
                        <TableSkeleton columns={8} rows={6} />
                    </main>
                </div>
            </div>
        </section>
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
        <Shell>
            {header}
            {children}
        </Shell>
    );
}

export function GenericDashboardLoading() {
    return (
        <Shell>
            <PageHeader eyebrow="Workspace" title="Loading" description="Preparing your workspace view." />
            <CardGridSkeleton count={4} columns="min-[960px]:grid-cols-3" />
        </Shell>
    );
}
