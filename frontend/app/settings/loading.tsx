import { HeaderSkeleton, LoadingShell, SystemConfigSkeleton } from "@/components/ui/loading-skeletons";

export default function SettingsLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton titleWidth="w-80" />}>
            <SystemConfigSkeleton />
        </LoadingShell>
    );
}
