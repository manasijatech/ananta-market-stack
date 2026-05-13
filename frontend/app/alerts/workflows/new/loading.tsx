import { AlertsNavSkeleton, HeaderSkeleton, LoadingShell, WorkflowEditorSkeleton } from "@/components/ui/loading-skeletons";

export default function NewWorkflowLoading() {
  return (
    <LoadingShell header={<HeaderSkeleton action titleWidth="w-96" />}>
      <AlertsNavSkeleton />
      <WorkflowEditorSkeleton />
    </LoadingShell>
  );
}
