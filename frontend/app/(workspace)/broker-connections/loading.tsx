import { BrokerConnectionsSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function BrokersLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton titleWidth="w-96" />}>
            <BrokerConnectionsSkeleton />
        </LoadingShell>
    );
}
