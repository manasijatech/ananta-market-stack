import { CardGridSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function HeatmapLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton titleWidth="w-56" />}>
            <CardGridSkeleton count={12} columns="grid-cols-2 min-[700px]:grid-cols-3 min-[1100px]:grid-cols-4" />
        </LoadingShell>
    );
}
