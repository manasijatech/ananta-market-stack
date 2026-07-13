import { StatGridSkeleton, TableSkeleton } from "@/components/ui/loading-skeletons";

export default function StreamManagerLoading() {
    return (
        <>
            <StatGridSkeleton count={3} />
            <TableSkeleton columns={4} rows={5} />
        </>
    );
}
