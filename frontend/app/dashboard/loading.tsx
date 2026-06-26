import { HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function DashboardCardSkeleton() {
    return (
        <Card className="h-full [--card-spacing:--spacing(6)]">
            <CardHeader className="gap-3 pb-0">
                <div className="flex items-start justify-between gap-4">
                    <div className="w-full max-w-md">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="mt-3 h-4 w-full" />
                    </div>
                    <Skeleton className="size-10 rounded-lg" />
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-4">
                <Skeleton className="h-10 w-full rounded-full" />
                <div className="grid gap-3 min-[480px]:grid-cols-2">
                    <Skeleton className="h-20 w-full rounded-lg" />
                    <Skeleton className="h-20 w-full rounded-lg" />
                </div>
            </CardContent>
        </Card>
    );
}

export default function DashboardLoading() {
    return (
        <LoadingShell
            header={<HeaderSkeleton eyebrowWidth="w-24" titleWidth="w-72" descriptionWidth="w-full max-w-3xl" />}
        >
            <Card className="[--card-spacing:--spacing(6)]">
                <CardHeader className="gap-4">
                    <Skeleton className="h-7 w-56" />
                    <Skeleton className="h-4 w-full max-w-2xl" />
                    <Skeleton className="h-10 w-full rounded-full" />
                </CardHeader>
                <CardContent className="flex flex-col gap-1 pt-0">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <Skeleton className="h-16 w-full rounded-lg" key={index} />
                    ))}
                </CardContent>
            </Card>
        </LoadingShell>
    );
}
