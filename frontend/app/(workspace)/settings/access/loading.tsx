import { AccessSettingsSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function SettingsAccessLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton titleWidth="w-72" />}>
            <AccessSettingsSkeleton />
        </LoadingShell>
    );
}
