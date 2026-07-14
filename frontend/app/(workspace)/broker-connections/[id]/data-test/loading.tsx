import { DataTestSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function BrokerDataTestLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton action titleWidth="w-96" />}>
            <DataTestSkeleton />
        </LoadingShell>
    );
}
