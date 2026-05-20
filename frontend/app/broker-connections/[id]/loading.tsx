import { BrokerDetailSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function BrokerDetailLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton action titleWidth="w-80" />}>
            <BrokerDetailSkeleton />
        </LoadingShell>
    );
}
