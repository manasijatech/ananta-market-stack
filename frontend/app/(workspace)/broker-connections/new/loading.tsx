import { FormSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function NewBrokerLoading() {
    return (
        <LoadingShell header={<HeaderSkeleton action titleWidth="w-96" />}>
            <FormSkeleton fields={8} />
        </LoadingShell>
    );
}
