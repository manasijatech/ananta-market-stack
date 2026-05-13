import { AlertsNavSkeleton, HeaderSkeleton, LoadingShell, StatGridSkeleton, TableSkeleton } from "@/components/ui/loading-skeletons";

export default function StreamManagerLoading() {
  return (
    <LoadingShell header={<HeaderSkeleton titleWidth="w-80" />}>
      <AlertsNavSkeleton />
      <StatGridSkeleton count={3} />
      <TableSkeleton columns={4} rows={5} />
    </LoadingShell>
  );
}
