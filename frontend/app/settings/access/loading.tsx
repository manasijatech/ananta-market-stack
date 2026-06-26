import { CardGridSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function SettingsAccessLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton titleWidth="w-72" />}>
            <CardGridSkeleton count={3} columns="grid-cols-1" />
        </LoadingShell>
    );
}
