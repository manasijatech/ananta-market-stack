import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

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
