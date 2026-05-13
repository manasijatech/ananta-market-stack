import { AlertsNavSkeleton, HeaderSkeleton, LoadingShell, WorkflowEditorSkeleton } from "@/components/ui/loading-skeletons";

export default function WorkflowDetailLoading() {
  return (
    <LoadingShell header={<HeaderSkeleton action titleWidth="w-96" />}>
      <AlertsNavSkeleton />
      <WorkflowEditorSkeleton />
    </LoadingShell>
  );
}
