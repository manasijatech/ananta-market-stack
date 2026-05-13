import { AlertsNavSkeleton, HeaderSkeleton, LoadingShell, TableSkeleton } from "@/components/ui/loading-skeletons";

export default function WorkflowsLoading() {
  return (
    <LoadingShell header={<HeaderSkeleton action titleWidth="w-96" />}>
      <AlertsNavSkeleton />
      <TableSkeleton columns={5} rows={7} />
    </LoadingShell>
  );
}
