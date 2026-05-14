import { TableSkeleton } from "@/components/ui/loading-skeletons";

export default function WorkflowsLoading() {
  return <TableSkeleton columns={5} rows={7} />;
}
