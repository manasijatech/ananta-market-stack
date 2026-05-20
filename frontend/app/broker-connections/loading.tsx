import { BrokerCardsSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function BrokersLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton action titleWidth="w-96" />}>
            <BrokerCardsSkeleton />
        </LoadingShell>
    );
}
