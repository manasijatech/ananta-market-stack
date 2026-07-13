import { CardGridSkeleton, HeaderSkeleton } from "@/components/ui/loading-skeletons";

export default function BrokerDocsLoading() {
    return (
        <>
            <HeaderSkeleton action={false} titleWidth="w-80" />
            <CardGridSkeleton count={6} columns="min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3" />
        </>
    );
}
